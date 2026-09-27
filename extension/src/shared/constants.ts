/**
 * Extension-wide constants.
 *
 * Storage policy (PRD §7): every bit of extension configuration lives in
 * `chrome.storage.local` under the single key below. `chrome.storage.sync` is
 * never used.
 */

import type { Settings, Store } from "./types.ts";

/** The single `chrome.storage.local` key that holds the whole extension store. */
export const STORAGE_KEY = "twitterBookmarker";

/** Current storage schema version. */
export const SCHEMA_VERSION = 1;

/** Backend base URL (PRD §5). Loopback only; never configurable from the UI. */
export const BACKEND_BASE_URL = "http://127.0.0.1:43121";

/** Path of the backend health endpoint. */
export const HEALTH_PATH = "/health";

/** AbortController timeout for the popup's health probe (PRD §44). */
export const HEALTH_TIMEOUT_MS = 1500;

/** Default settings (PRD §50). */
export const DEFAULT_SETTINGS: Settings = {
  unbookmarkAfterSave: false,
  displayMode: "popover",
};

/** Colour used when a category has no (or an invalid) colour. */
export const DEFAULT_CATEGORY_COLOR = "#4f46e5";

/** Minimal palette offered in the add-category form. */
export const CATEGORY_COLOR_PALETTE = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
] as const;

/** A fresh empty store. Always return a new object so callers cannot mutate a shared default. */
export function createDefaultStore(): Store {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    categories: [],
  };
}

/** Frozen reference to the default store, for documentation and equality checks. */
export const DEFAULT_STORE: Readonly<Store> = Object.freeze(createDefaultStore());
