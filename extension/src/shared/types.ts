/**
 * Shared domain types for the Twitter Bookmarker extension.
 *
 * The extension is the sole owner of category configuration and settings; the
 * backend only ever receives a `filename` plus tweet metadata (PRD §4.3, §16).
 */

/** How category controls are rendered on an X bookmark tweet (PRD §32, §33). */
export type DisplayMode = "popover" | "inline";

/** A user-defined bookmark category, persisted in `chrome.storage.local` (PRD §7). */
export interface Category {
  /** Stable internal identifier; never changes across renames. */
  id: string;
  /** Human-readable name, e.g. "AI & LLM". */
  name: string;
  /** Derived CSV filename, e.g. "ai-llm.csv". Recomputed only on rename. */
  filename: string;
  /** UI-only colour (hex). Never sent to the backend or written to CSV. */
  color: string;
  /** Position, always normalized to 0..n-1 in storage order. */
  order: number;
}

/** Persisted extension settings (PRD §50). */
export interface Settings {
  /** When true, remove the tweet from X Bookmarks after a confirmed CSV write. */
  unbookmarkAfterSave: boolean;
  /** How category controls are rendered on the X bookmarks page. */
  displayMode: DisplayMode;
}

/** The whole `chrome.storage.local` payload, under a single documented key. */
export interface Store {
  version: 1;
  settings: Settings;
  categories: Category[];
}

/** Metadata extracted from a single tweet container by the Phase 3 content script (PRD §28). */
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
  filename: string;
  tweet: SaveTweetPayload;
}

/** Successful (201) response body from `POST /v1/bookmarks`. */
export interface SaveResult {
  status: "saved";
  tweet_id: string;
  url: string;
  filename: string;
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
  filename: string;
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
