/**
 * Typed message contract between the content script / popup and the service
 * worker (PRD §25).
 *
 * The content script never talks to the backend directly: it sends one of these
 * messages and the service worker performs the HTTP call. Phase 2 defines the
 * contract so it is stable for Phases 3–4; the service worker only scaffolds it.
 */

import type {
  DuplicateResult,
  SavedIndex,
  SavedIndexEntry,
  SaveRequest,
  SaveResult,
} from "./types.ts";

/** Discriminant of every extension message. */
export type MessageType = "HEALTH_CHECK" | "GET_SAVED_INDEX" | "SAVE_TWEET";

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

/** Every message the extension may send. */
export type ExtensionMessage = HealthCheckMessage | GetSavedIndexMessage | SaveTweetMessage;

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

/** Union of every response the service worker may send. */
export type ExtensionResponse = HealthCheckResponse | GetSavedIndexResponse | SaveTweetResponse;

/** Convenience alias for the index entry shape used by {@link SavedIndex}. */
export type IndexEntry = SavedIndexEntry;

/** Runtime narrowing for messages that cross the untrusted messaging boundary. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "HEALTH_CHECK" || type === "GET_SAVED_INDEX" || type === "SAVE_TWEET";
}

/**
 * Send one typed message to the service worker and resolve with its response.
 * The caller inspects `ok` and must handle a rejected promise (no worker /
 * closed channel) itself.
 */
export async function sendExtensionMessage<T extends ExtensionResponse>(message: ExtensionMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | undefined;
  if (response === undefined || response === null) {
    throw new Error("no_response_from_service_worker");
  }
  return response;
}
