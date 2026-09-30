/**
 * Shared domain types for the Twitter Bookmarker extension.
 *
 * The backend owns categories: `collections` is its table, `/v1/collections` is
 * the resource that creates, renames, colours and orders them, and every client
 * reads the same list in the same order. The extension keeps a *cache* of that
 * list so a popup or a timeline can render without a round trip, but it never
 * invents a category, recomputes a slug, or decides an order (PRD §4.3, §16).
 */

/** How category controls are rendered on an X bookmark tweet (PRD §32, §33). */
export type DisplayMode = "popover" | "inline";

/**
 * Which backend the extension talks to (PRD §5, §50).
 *
 * - `localhost` uses the fixed loopback default (`DEFAULT_BACKEND_BASE_URL`);
 * - `custom` uses the user-saved `Settings.backendUrl`.
 */
export type BackendMode = "localhost" | "custom";

/**
 * A category as the extension renders it: one row of the backend's collection
 * list, in the backend's order, with the backend's colour.
 *
 * It is a *view*, not configuration. `id` carries the collection slug, which is
 * the backend's key and what a save sends; it is kept as a separate field only
 * because the injected controls and their DOM attributes were built around a
 * row identity, and the slug is exactly that.
 */
export interface Category {
  /** Row identity: the collection slug, e.g. "ai-llm". Never recomputed here. */
  id: string;
  /** Human-readable name, e.g. "AI & LLM". */
  name: string;
  /** The backend's key for this category, e.g. "ai-llm". Equal to `id`. */
  slug: string;
  /**
   * The category's colour as `#rrggbb`, or an empty string when none is set —
   * in which case the UI falls back to `DEFAULT_CATEGORY_COLOR`. The backend
   * validates the value, so anything else here is a cache from an older build.
   */
  color: string;
  /** Display position, exactly the backend's order. Clients never renumber it. */
  order: number;
}

/**
 * One collection as `GET /v1/collections` returns it.
 *
 * The counts and the cover are the gallery's own projection of a collection; the
 * extension ignores them today, and they are typed so a future popup row can show
 * "12 posts" without a second request.
 */
export interface Collection {
  slug: string;
  name: string;
  /** `#rrggbb` or `""` for "no colour chosen". */
  color: string;
  /** Display position; the list arrives already sorted by it. */
  order: number;
  post_count: number;
  media_count: number;
  last_saved_at: string | null;
  cover_media: string[];
}

/** Body of `GET /v1/collections`. */
export interface CollectionListResponse {
  collections: Collection[];
}

/** Body of `POST /v1/collections` (201) and `PUT /v1/collections/{slug}` (200). */
export interface CollectionResponse {
  status: string;
  collection: Collection;
}

/** Request body for `POST /v1/collections`. The backend derives the slug. */
export interface CreateCollectionRequest {
  name: string;
  /**
   * Optional `#rrggbb`; omitted or empty means "no colour chosen". `undefined` is
   * spelled out because this project compiles with `exactOptionalPropertyTypes`,
   * and a caller with a possibly-missing colour must be able to say "omit it".
   */
  color?: string | undefined;
}

/**
 * Request body for `PUT /v1/collections/{slug}`.
 *
 * Every field is optional and absent means "leave it alone", so a colour change
 * cannot accidentally rename a category. An empty `color` string is a real
 * instruction: it clears the colour back to the default.
 */
export interface UpdateCollectionRequest {
  name?: string | undefined;
  color?: string | undefined;
  order?: number | undefined;
}

/** Request body for `PUT /v1/collections/order`: the whole list, in order. */
export interface ReorderCollectionsRequest {
  slugs: string[];
}

/** Body of `PUT /v1/collections/order`. */
export interface ReorderCollectionsResponse {
  status: string;
  collections: Collection[];
}

/** Persisted extension settings (PRD §50). */
export interface Settings {
  /** When true, remove the tweet from X Bookmarks after a confirmed save. */
  unbookmarkAfterSave: boolean;
  /** How category controls are rendered on the X bookmarks page. */
  displayMode: DisplayMode;
  /** Which backend address the worker and the popup use. */
  backendMode: BackendMode;
  /**
   * The saved base URL used when `backendMode` is `custom` (e.g.
   * `http://192.168.1.10:43121` or `https://server.example/tw-bookmarker`):
   * a normalized http(s) origin plus an optional base path. A missing or
   * unparseable value falls back to the loopback default.
   */
  backendUrl: string;
  /**
   * Bearer token sent with every request while `backendMode` is `custom`, e.g.
   * the backend's `TWITTER_BOOKMARKER_TOKEN`. Empty means no `Authorization`
   * header is sent, which is all the loopback default ever needs: a request from
   * this machine is never challenged. It is ignored in `localhost` mode.
   */
  backendToken: string;
}

/**
 * The runtime snapshot the injected controls and the popup render from.
 *
 * `settings` is the only part the extension *owns* and persists. `categories` is
 * a snapshot of the backend's list, read from the collections cache so a render
 * never waits on the network; a refresh replaces it wholesale.
 */
export interface Store {
  version: 3;
  settings: Settings;
  categories: Category[];
}

/** Metadata extracted from a single tweet container by the content script (PRD §28). */
export interface ExtractedTweet {
  /** Absolute tweet URL (canonicalized by the backend). */
  url: string;
  /** Display name of the author. */
  author: string;
  /** Handle including the leading "@". */
  username: string;
  /** Original tweet time as ISO 8601 UTC. */
  tweetDate: string;
  /** Main tweet text only; empty for media-only tweets. */
  text: string;
  /** Canonical media URLs of the main tweet; `[]` when it has none (PRD §14). */
  media: string[];
  /** X status ID, used as the global duplicate key. */
  tweetId: string;
}

/** Wire format of the tweet object accepted by `POST /v1/bookmarks` (PRD §19). */
export interface SaveTweetPayload {
  url: string;
  media: string[];
  author: string;
  username: string;
  tweet_date: string;
  text: string;
}

/** Request body for `POST /v1/bookmarks`. */
export interface SaveRequest {
  slug: string;
  /**
   * Human display name for the collection, so the gallery shows what the user
   * typed rather than a name derived from the slug. Optional on the wire: the
   * backend derives one when it is missing or empty.
   */
  name: string;
  tweet: SaveTweetPayload;
}

/** Successful (201) response body from `POST /v1/bookmarks`. */
export interface SaveResult {
  status: "saved";
  tweet_id: string;
  url: string;
  slug: string;
  saved_at: string;
}

/** 409 response body for an already-saved tweet. */
export interface DuplicateResult {
  status: "duplicate";
  tweet_id: string;
}

/** One entry of `GET /v1/index` (PRD §18). */
export interface SavedIndexEntry {
  url: string;
  slug: string;
  saved_at: string;
}

/** Body of `GET /v1/index`. */
export interface SavedIndex {
  items: Record<string, SavedIndexEntry>;
}

/** Body of `GET /health`. */
export interface HealthResponse {
  status: string;
}
