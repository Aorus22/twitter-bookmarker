/**
 * Typed message contract between the content script / popup and the service
 * worker (PRD §25).
 *
 * The content script never talks to the backend directly: it sends one of these
 * messages and the service worker performs the HTTP call. That is also true of
 * categories now — the popup asks the worker to create, rename, recolour or
 * reorder a collection, so `chrome.storage.local` and the HTTP client stay in one
 * place.
 */

import type {
  Category,
  DuplicateResult,
  SavedIndex,
  SavedIndexEntry,
  SaveRequest,
  SaveResult,
} from "./types.ts";

/** Discriminant of every extension message. */
export type MessageType =
  | "HEALTH_CHECK"
  | "GET_SAVED_INDEX"
  | "SAVE_TWEET"
  | "LIST_COLLECTIONS"
  | "CREATE_COLLECTION"
  | "UPDATE_COLLECTION"
  | "REORDER_COLLECTIONS";

/**
 * Machine-readable failure codes the service worker resolves a request to
 * (PRD §39, §21). Network failure and timeouts collapse to
 * `backend_unavailable`; `400` maps to `invalid_request`; `404` to `not_found`;
 * `409` to `conflict`; every other non-2xx maps to `internal`.
 */
export type BgError =
  | "backend_unavailable"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "internal";

/** Ask the service worker to probe `GET /health`. */
export interface HealthCheckMessage {
  type: "HEALTH_CHECK";
}

/** Ask the service worker for the global saved-tweet index (`GET /v1/index`). */
export interface GetSavedIndexMessage {
  type: "GET_SAVED_INDEX";
}

/** Ask the service worker to persist one tweet (`POST /v1/bookmarks`). */
export interface SaveTweetMessage {
  type: "SAVE_TWEET";
  payload: SaveRequest;
}

/** Ask the service worker for the collection list (`GET /v1/collections`). */
export interface ListCollectionsMessage {
  type: "LIST_COLLECTIONS";
}

/** Ask the service worker to create a category (`POST /v1/collections`). */
export interface CreateCollectionMessage {
  type: "CREATE_COLLECTION";
  name: string;
  /** Optional `#rrggbb`; omitted or empty means "no colour chosen". */
  color?: string;
}

/**
 * Ask the service worker to change one category
 * (`PUT /v1/collections/{slug}`). Absent fields are left alone.
 */
export interface UpdateCollectionMessage {
  type: "UPDATE_COLLECTION";
  slug: string;
  name?: string;
  color?: string;
  order?: number;
}

/** Ask the service worker to write the whole order (`PUT /v1/collections/order`). */
export interface ReorderCollectionsMessage {
  type: "REORDER_COLLECTIONS";
  slugs: string[];
}

/** Every message the extension may send. */
export type ExtensionMessage =
  | HealthCheckMessage
  | GetSavedIndexMessage
  | SaveTweetMessage
  | ListCollectionsMessage
  | CreateCollectionMessage
  | UpdateCollectionMessage
  | ReorderCollectionsMessage;

/** Response to {@link HealthCheckMessage}. */
export interface HealthCheckResponse {
  ok: boolean;
  /** True when the backend answered 200 with `{"status":"ok"}`. */
  connected: boolean;
}

/** Response to {@link GetSavedIndexMessage}. */
export interface GetSavedIndexResponse {
  ok: boolean;
  index: SavedIndex | null;
  error?: string;
}

/** Response to {@link SaveTweetMessage}. */
export interface SaveTweetResponse {
  ok: boolean;
  /** Present when the backend answered 201. */
  result?: SaveResult;
  /** Present when the backend answered 409 — the tweet already exists globally. */
  duplicate?: DuplicateResult;
  /** Human-readable failure reason (`backend_unavailable`, `invalid_request`, ...). */
  error?: string;
}

/**
 * Response to every collection message.
 *
 * `collections` is the list as the backend holds it *after* the operation — the
 * service worker refetches and re-caches before answering. It is `null` only when
 * the change was applied but the follow-up read failed, which the popup reports as
 * "saved, but the list could not be refreshed" rather than as a failed change.
 */
export interface CollectionsResponse {
  ok: boolean;
  collections: Category[] | null;
  error?: string;
}

/** Union of every response the service worker may send. */
export type ExtensionResponse =
  | HealthCheckResponse
  | GetSavedIndexResponse
  | SaveTweetResponse
  | CollectionsResponse;

/** Convenience alias for the index entry shape used by {@link SavedIndex}. */
export type IndexEntry = SavedIndexEntry;

/**
 * Convert a `GET_SAVED_INDEX` response into the O(1) lookup `Set<TweetID>` the
 * content script keeps for the current entry (PRD §34, §54). A failed or empty
 * index degrades to an empty Set — never to a throw.
 */
export function savedIndexToSet(response: GetSavedIndexResponse): Set<string> {
  if (!response.ok || response.index === null) return new Set<string>();
  return new Set<string>(Object.keys(response.index.items));
}

const MESSAGE_TYPES: readonly string[] = [
  "HEALTH_CHECK",
  "GET_SAVED_INDEX",
  "SAVE_TWEET",
  "LIST_COLLECTIONS",
  "CREATE_COLLECTION",
  "UPDATE_COLLECTION",
  "REORDER_COLLECTIONS",
];

/** Runtime narrowing for messages that cross the untrusted messaging boundary. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && MESSAGE_TYPES.includes(type);
}

/**
 * Send one typed message to the service worker and resolve with its response.
 *
 * The returned promise **rejects** when the worker returns nothing (no worker,
 * closed channel, crashed worker). Callers must `try/catch` and treat a throw as
 * `backend_unavailable` — the worker never rejects on a backend failure, it
 * resolves `{ ok: false, error }` instead.
 */
export async function sendExtensionMessage<T extends ExtensionResponse>(message: ExtensionMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | undefined;
  if (response === undefined || response === null) {
    throw new Error("no_response_from_service_worker");
  }
  return response;
}
