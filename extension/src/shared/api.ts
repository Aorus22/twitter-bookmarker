/**
 * Backend HTTP client (PRD §17–§21, §25, §50).
 *
 * This is the extension's **only** network surface. The content script sends
 * messages and never performs a backend `fetch` itself (SAVE-01/SAVE-02); the
 * service worker calls these functions, and the popup reuses {@link checkHealth}
 * for its status probe.
 *
 * Every function takes the base URL to call, and the token to present. Callers
 * resolve both from settings — `shared/backend-url.ts` and
 * `shared/backend-token.ts` respectively — and the defaults keep the loopback
 * address with no credential for callers (and tests) that do not care about the
 * custom-target settings.
 *
 * Every failure is normalized onto the {@link BgError} union so the service
 * worker can answer with the documented response shapes and never throw:
 *
 *  - network failure / abort / timeout → `backend_unavailable` (BackendUnavailableError)
 *  - HTTP `400`                        → `invalid_request`   (BackendRequestError)
 *  - HTTP `404`                        → `not_found`         (BackendRequestError)
 *  - HTTP `409`                        → `conflict`          (BackendRequestError)
 *  - any other non-2xx                 → `internal`          (BackendRequestError)
 */

import { DEFAULT_BACKEND_BASE_URL, HEALTH_PATH, HEALTH_TIMEOUT_MS } from "./constants.ts";
import { authHeaders } from "./backend-token.ts";
import { toCategories } from "./collections.ts";
import type { BgError } from "./messages.ts";
import type {
  Category,
  Collection,
  CollectionListResponse,
  CollectionResponse,
  CreateCollectionRequest,
  DuplicateResult,
  HealthResponse,
  ReorderCollectionsResponse,
  SavedIndex,
  SaveRequest,
  SaveResult,
  UpdateCollectionRequest,
} from "./types.ts";

/** Path of the global saved-index endpoint. */
export const INDEX_PATH = "/v1/index";
/** Path of the bookmark-create endpoint. */
export const BOOKMARKS_PATH = "/v1/bookmarks";
/** Path of the collection resource (list and create). */
export const COLLECTIONS_PATH = "/v1/collections";
/** Path of the collection-order endpoint. */
export const COLLECTIONS_ORDER_PATH = "/v1/collections/order";

/**
 * Ceiling for a non-health request. The backend is loopback-only, so a request
 * that outlives this is treated as unreachable rather than left hanging with the
 * tweet's controls disabled.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** The request code for "the backend could not be reached at all". */
export const BACKEND_UNAVAILABLE: BgError = "backend_unavailable";

/** Raised when the backend is unreachable (connection refused, abort, timeout). */
export class BackendUnavailableError extends Error {
  /** {@link BgError} discriminant for this failure. */
  readonly code = "backend_unavailable" as const;

  constructor(message = "backend_unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "BackendUnavailableError";
  }
}

/** Raised when the backend answered, but with a non-2xx status. */
export class BackendRequestError extends Error {
  /** The {@link BgError} discriminant for this status. */
  readonly code: Exclude<BgError, "backend_unavailable">;
  /** The HTTP status the backend returned. */
  readonly status: number;

  constructor(code: Exclude<BgError, "backend_unavailable">, status: number, message?: string) {
    super(message ?? code);
    this.name = "BackendRequestError";
    this.code = code;
    this.status = status;
  }
}

/** Map any thrown value onto the {@link BgError} the worker may return. */
export function bgErrorFrom(error: unknown): BgError {
  if (error instanceof BackendRequestError) return error.code;
  return "backend_unavailable";
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * One fetch with a hard timeout. Any transport-level failure — including the
 * abort this function itself raises — becomes {@link BackendUnavailableError}.
 *
 * The token travels as `Authorization: Bearer …`, and only when there is one, so
 * the default loopback target sends no credential at all. Callers pass a plain
 * object for `init.headers` (a JSON content type, when there is a body), so the
 * credential is merged in that same shape.
 */
async function request(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    ...authHeaders(token),
  };
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
  } catch (error) {
    throw new BackendUnavailableError("backend_unavailable", { cause: error });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** Map a non-2xx response onto the documented error code. */
function errorFor(response: Response): BackendRequestError {
  switch (response.status) {
    case 400:
      return new BackendRequestError("invalid_request", response.status);
    case 404:
      return new BackendRequestError("not_found", response.status);
    case 409:
      return new BackendRequestError("conflict", response.status);
    default:
      return new BackendRequestError("internal", response.status);
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value) && typeof value.status === "string";
}

function isSavedIndex(value: unknown): value is SavedIndex {
  return isRecord(value) && isRecord(value.items);
}

function isSaveResult(value: unknown): value is SaveResult {
  return (
    isRecord(value) &&
    value.status === "saved" &&
    typeof value.tweet_id === "string" &&
    typeof value.url === "string" &&
    typeof value.slug === "string" &&
    typeof value.saved_at === "string"
  );
}

function isDuplicateResult(value: unknown): value is DuplicateResult {
  return isRecord(value) && value.status === "duplicate" && typeof value.tweet_id === "string";
}

/** Narrow a collection list body. The entries themselves are validated by the mapper. */
function isCollectionList(value: unknown): value is CollectionListResponse {
  return isRecord(value) && Array.isArray(value.collections);
}

function isCollectionResponse(value: unknown): value is CollectionResponse {
  return isRecord(value) && isRecord(value.collection);
}

function isReorderResponse(value: unknown): value is ReorderCollectionsResponse {
  return isRecord(value) && Array.isArray(value.collections);
}

/** POST/PUT with a JSON body and a decoded response, sharing one error path. */
async function sendJson(
  baseUrl: string,
  token: string,
  path: string,
  method: "POST" | "PUT",
  payload: unknown,
): Promise<unknown> {
  const response = await request(
    baseUrl,
    token,
    path,
    { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw errorFor(response);
  return readJson(response);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Probe `GET /health` (PRD §44). Resolves `false` for any non-`200`, any body
 * that is not `{"status":"ok"}`, and any transport failure — never throws, since
 * "connected" is a status, not an error. The response is never cached, so a
 * Retry always re-probes the backend.
 */
export async function checkHealth(
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<boolean> {
  try {
    const response = await request(
      baseUrl,
      token,
      HEALTH_PATH,
      { method: "GET", cache: "no-store" },
      HEALTH_TIMEOUT_MS,
    );
    if (!response.ok) return false;
    const body = await readJson(response);
    return isHealthResponse(body) && body.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Fetch the global saved index (`GET /v1/index`, PRD §18, §34). Callers take
 * `Object.keys(index.items)` as the O(1) saved-tweet Set.
 */
export async function fetchSavedIndex(
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<SavedIndex> {
  const response = await request(baseUrl, token, INDEX_PATH, { method: "GET" }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw errorFor(response);
  const body = await readJson(response);
  if (!isSavedIndex(body)) throw new BackendRequestError("internal", response.status, "malformed_index");
  return body;
}

/** Discriminated outcome of a successful `POST /v1/bookmarks`. */
export type PostBookmarkOutcome =
  | { kind: "saved"; body: SaveResult }
  | { kind: "duplicate"; body: DuplicateResult };

/**
 * Persist one tweet (`POST /v1/bookmarks`, PRD §19, §20).
 *
 * `201` → `{ kind: "saved" }`; `409` → `{ kind: "duplicate" }`. `400` and every
 * other failure reject with the matching {@link BackendUnavailableError} /
 * {@link BackendRequestError}.
 */
export async function postBookmark(
  payload: SaveRequest,
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<PostBookmarkOutcome> {
  const response = await request(
    baseUrl,
    token,
    BOOKMARKS_PATH,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS,
  );

  if (response.status === 409) {
    const body = await readJson(response);
    if (!isDuplicateResult(body)) {
      throw new BackendRequestError("internal", response.status, "malformed_duplicate");
    }
    return { kind: "duplicate", body };
  }

  if (!response.ok) throw errorFor(response);

  const body = await readJson(response);
  if (!isSaveResult(body)) throw new BackendRequestError("internal", response.status, "malformed_result");
  return { kind: "saved", body };
}

/* -------------------------------------------------------------------------- */
/* Collections (the backend-owned category list)                              */
/* -------------------------------------------------------------------------- */

/**
 * List every collection (`GET /v1/collections`), mapped to the rows the UI
 * renders.
 *
 * The mapping happens here rather than in the worker so every caller — the popup,
 * the content script, the service worker's own cache write — gets the same
 * validated `Category[]`, including the drop of an unusable slug.
 */
export async function fetchCollections(
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<Category[]> {
  const response = await request(baseUrl, token, COLLECTIONS_PATH, { method: "GET" }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw errorFor(response);
  const body = await readJson(response);
  if (!isCollectionList(body)) throw new BackendRequestError("internal", response.status, "malformed_collections");
  return toCategories(body.collections);
}

/**
 * Create a category (`POST /v1/collections`).
 *
 * Only the name and the colour are sent: the backend derives the slug, so there
 * is one implementation of those rules and the browser cannot drift from the
 * phone. A name whose slug is taken rejects with `conflict` (409).
 *
 * It resolves with the created collection, and **does not** re-read the list: the
 * caller decides whether it needs the whole list, so one user action is not
 * silently two requests.
 */
export async function createCollection(
  payload: CreateCollectionRequest,
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<Collection> {
  const body = await sendJson(baseUrl, token, COLLECTIONS_PATH, "POST", payload);
  if (!isCollectionResponse(body)) throw new BackendRequestError("internal", 0, "malformed_collection");
  return body.collection;
}

/**
 * Rename, recolour or move one category (`PUT /v1/collections/{slug}`).
 *
 * Absent fields are left alone; an empty `color` clears the colour. A rename can
 * change the slug — the backend recomputes it from the name — so the caller must
 * re-read the list rather than assume the slug it sent still exists.
 */
export async function updateCollection(
  slug: string,
  patch: UpdateCollectionRequest,
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<Collection> {
  const body = await sendJson(baseUrl, token, `${COLLECTIONS_PATH}/${encodeURIComponent(slug)}`, "PUT", patch);
  if (!isCollectionResponse(body)) throw new BackendRequestError("internal", 0, "malformed_collection");
  return body.collection;
}

/**
 * Write the whole order (`PUT /v1/collections/order`).
 *
 * The body is every slug the caller knows, in the order it just drew: a partial
 * list would let two clients interleave their intent, and the whole list is what
 * makes the operation atomic.
 *
 * Unlike create and update, the answer already *is* the full renumbered list, so
 * this returns it and no follow-up read is needed.
 */
export async function reorderCollections(
  slugs: string[],
  baseUrl: string = DEFAULT_BACKEND_BASE_URL,
  token = "",
): Promise<Category[]> {
  const body = await sendJson(baseUrl, token, COLLECTIONS_ORDER_PATH, "PUT", { slugs });
  if (!isReorderResponse(body)) throw new BackendRequestError("internal", 0, "malformed_collections");
  return toCategories(body.collections);
}
