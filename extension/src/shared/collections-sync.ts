/**
 * Keeping the cached collection list fresh.
 *
 * One function, called from the two places that need a current list without
 * blocking on one: the popup when it opens, and the content script when it enters
 * a route where it injects controls.
 *
 * It is deliberately *not* a subscription to the backend. A request per page entry
 * is fine because the answer is cached for {@link COLLECTIONS_TTL_MS}; anything
 * more frequent would turn every X navigation into a backend call, and anything
 * less would hide a category the user just added on the phone.
 */

import { isCollectionsCacheStale } from "./collections.ts";
import { sendExtensionMessage } from "./messages.ts";
import type { CollectionsResponse } from "./messages.ts";
import { getCollectionsCache } from "./storage.ts";

/**
 * Fetch the collection list if the cache is missing or old.
 *
 * Resolves `true` when a refresh happened (whether or not it succeeded), `false`
 * when the cache was fresh enough to leave alone. A failure is logged and
 * swallowed: the caller is a render path, and a render must not throw because the
 * backend is down. The worker writes the cache, so a successful refresh reaches
 * every open surface through `chrome.storage.onChanged`.
 */
export async function refreshCollectionsIfStale(now: number = Date.now()): Promise<boolean> {
  const cache = await getCollectionsCache();
  if (!isCollectionsCacheStale(cache, now)) return false;

  try {
    const response = await sendExtensionMessage<CollectionsResponse>({ type: "LIST_COLLECTIONS" });
    if (!response.ok) {
      console.warn(
        `[twitter-bookmarker] collection list unavailable (${response.error ?? "unknown"}); using the cached list`,
      );
    }
    return true;
  } catch (error) {
    console.warn("[twitter-bookmarker] collection list request failed; using the cached list", error);
    return true;
  }
}
