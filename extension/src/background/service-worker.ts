/**
 * Extension service worker (Manifest V3).
 *
 * The worker is the extension's single backend HTTP client (PRD §25, §53): every
 * message is answered here and the corresponding request is issued through
 * `shared/api.ts`. It is also the only writer of the collection cache, so the
 * list the popup and the injected controls render has one origin.
 *
 * The target base URL is resolved from `chrome.storage.local` on every message
 * (PRD §50): the popup can switch between the loopback default and a custom URL
 * while the worker holds no state between messages.
 *
 * Invariants:
 *  - the listener always resolves to one of the documented response shapes and
 *    never throws out of `chrome.runtime.onMessage` (XI/PRD §39);
 *  - the worker holds **no** state between messages — the per-page saved cache
 *    lives in the content script (PRD §34), and the collection cache lives in
 *    `chrome.storage.local`;
 *  - network failure is reported as `{ ok: false, error: "backend_unavailable" }`,
 *    never as a rejected message channel;
 *  - a collection mutation that succeeded but could not be re-read answers
 *    `ok: true` with `collections: null`: the change happened, and saying
 *    otherwise would invite the user to repeat it.
 */

import {
  bgErrorFrom,
  checkHealth,
  createCollection,
  fetchCollections,
  fetchSavedIndex,
  postBookmark,
  reorderCollections,
  updateCollection,
} from "../shared/api.ts";
import { resolveBackendBaseUrl } from "../shared/backend-url.ts";
import { resolveBackendToken } from "../shared/backend-token.ts";
import { isExtensionMessage } from "../shared/messages.ts";
import type { CollectionsResponse, ExtensionMessage, ExtensionResponse } from "../shared/messages.ts";
import { getSettings, writeCollectionsCache } from "../shared/storage.ts";

chrome.runtime.onInstalled.addListener(() => {
  console.info("[twitter-bookmarker] service worker installed");
});

/**
 * The configured backend for this message: where to call, and what to present.
 * `getSettings` never rejects and already applies the defaults, so a storage
 * hiccup simply falls back to the loopback address with no credential — which is
 * what that address needs anyway.
 */
async function activeTarget(): Promise<{ baseUrl: string; token: string }> {
  const settings = await getSettings();
  return { baseUrl: resolveBackendBaseUrl(settings), token: resolveBackendToken(settings) };
}

/** Fetch the list and refresh the cache; the answer every collection message carries. */
async function listAndCache(baseUrl: string, token: string): Promise<CollectionsResponse> {
  try {
    const collections = await fetchCollections(baseUrl, token);
    await writeCollectionsCache(collections);
    return { ok: true, collections };
  } catch (error) {
    return { ok: false, collections: null, error: bgErrorFrom(error) };
  }
}

/**
 * Apply one collection mutation, then re-read the list.
 *
 * The follow-up read is not optional politeness: a create appends to the order and
 * a rename changes the slug, so the only honest answer is the list the backend now
 * holds — and the cache every open surface renders from.
 */
async function mutateThenList(
  baseUrl: string,
  token: string,
  mutate: () => Promise<unknown>,
): Promise<CollectionsResponse> {
  try {
    await mutate();
  } catch (error) {
    return { ok: false, collections: null, error: bgErrorFrom(error) };
  }

  try {
    const collections = await fetchCollections(baseUrl, token);
    await writeCollectionsCache(collections);
    return { ok: true, collections };
  } catch (error) {
    // The change stands; only the refresh failed. `collections: null` says so
    // without pretending the mutation did not happen.
    console.warn("[twitter-bookmarker] collection change applied but the list could not be refreshed", error);
    return { ok: true, collections: null };
  }
}

/**
 * Write a new order and cache the renumbered list the backend answers with.
 *
 * No follow-up read: the reorder response *is* the whole list, already in the
 * order that was just written.
 */
async function reorderThenCache(
  baseUrl: string,
  token: string,
  slugs: string[],
): Promise<CollectionsResponse> {
  try {
    const collections = await reorderCollections(slugs, baseUrl, token);
    await writeCollectionsCache(collections);
    return { ok: true, collections };
  } catch (error) {
    return { ok: false, collections: null, error: bgErrorFrom(error) };
  }
}

/** Resolve one validated message to a response. Never rejects. */
async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  const { baseUrl, token } = await activeTarget();

  switch (message.type) {
    case "HEALTH_CHECK":
      return { ok: true, connected: await checkHealth(baseUrl, token) };

    case "GET_SAVED_INDEX":
      try {
        return { ok: true, index: await fetchSavedIndex(baseUrl, token) };
      } catch (error) {
        return { ok: false, index: null, error: bgErrorFrom(error) };
      }

    case "SAVE_TWEET":
      try {
        const outcome = await postBookmark(message.payload, baseUrl, token);
        return outcome.kind === "saved"
          ? { ok: true, result: outcome.body }
          : { ok: true, duplicate: outcome.body };
      } catch (error) {
        return { ok: false, error: bgErrorFrom(error) };
      }

    case "LIST_COLLECTIONS":
      return listAndCache(baseUrl, token);

    case "CREATE_COLLECTION":
      return mutateThenList(baseUrl, token, () =>
        createCollection({ name: message.name, color: message.color }, baseUrl, token),
      );

    case "UPDATE_COLLECTION":
      return mutateThenList(baseUrl, token, () =>
        updateCollection(
          message.slug,
          { name: message.name, color: message.color, order: message.order },
          baseUrl,
          token,
        ),
      );

    case "REORDER_COLLECTIONS":
      return reorderThenCache(baseUrl, token, message.slugs);

    default:
      // `isExtensionMessage` guarantees this is unreachable, but a response is
      // still required if `ExtensionMessage` ever grows a variant.
      return { ok: false, error: "internal" };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void,
  ): boolean => {
    if (!isExtensionMessage(message)) return false;

    void handleMessage(message).then(
      (response) => {
        try {
          sendResponse(response);
        } catch {
          /* The page/port went away before the answer could be delivered. */
        }
      },
      () => {
        // Defensive: `handleMessage` must not reject, but the listener still
        // owes the caller a typed response instead of a broken channel.
        try {
          sendResponse({ ok: false, index: null, error: "internal" });
        } catch {
          /* The page/port went away before the answer could be delivered. */
        }
      },
    );

    // Keep the message channel open for the async response.
    return true;
  },
);
