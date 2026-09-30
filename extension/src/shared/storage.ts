/**
 * Extension persistence: the user's settings, and the cached copy of the
 * backend's collection list.
 *
 * Two `chrome.storage.local` keys with two different owners:
 *
 *  - {@link STORAGE_KEY} holds `Settings`, which the extension owns and only the
 *    popup writes.
 *  - {@link COLLECTIONS_CACHE_KEY} holds a snapshot of the backend's collection
 *    list plus the time it was fetched. The service worker writes it after every
 *    successful list or mutation; everyone else only reads it.
 *
 * Invariants enforced here:
 *  - `chrome.storage.sync` is never used (PRD §7);
 *  - no function in this module performs any network request;
 *  - a malformed stored value degrades to a default instead of throwing;
 *  - reading never touches the network, so a render is always synchronous with
 *    respect to storage.
 */

import { normalizeBackendMode, normalizeBackendUrl } from "./backend-url.ts";
import { normalizeBackendToken } from "./backend-token.ts";
import {
  COLLECTIONS_CACHE_KEY,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from "./constants.ts";
import {
  emptyCollectionsCache,
  normalizeCollectionsCache,
} from "./collections.ts";
import type { CollectionsCache } from "./collections.ts";
import type { Category, DisplayMode, Settings, Store } from "./types.ts";

const DISPLAY_MODES: readonly DisplayMode[] = ["popover", "inline"];

/* -------------------------------------------------------------------------- */
/* Pure helpers (exported for unit testing; they never touch chrome APIs)      */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coerce an unknown value into a valid display mode. */
export function normalizeDisplayMode(value: unknown): DisplayMode {
  return DISPLAY_MODES.includes(value as DisplayMode) ? (value as DisplayMode) : DEFAULT_SETTINGS.displayMode;
}

/**
 * Read the settings half of a stored record, dropping anything malformed.
 *
 * The `categories` array a v1/v2 record carries is deliberately ignored: the
 * backend owns the list now, and the extension's copy is fetched rather than
 * trusted. Nothing is migrated out of it, because the backend already holds every
 * category a save ever created.
 */
export function normalizeSettings(raw: unknown): Settings {
  const rawSettings = isRecord(raw) && isRecord(raw.settings) ? raw.settings : {};
  return {
    unbookmarkAfterSave:
      typeof rawSettings.unbookmarkAfterSave === "boolean"
        ? rawSettings.unbookmarkAfterSave
        : DEFAULT_SETTINGS.unbookmarkAfterSave,
    displayMode: normalizeDisplayMode(rawSettings.displayMode),
    backendMode: normalizeBackendMode(rawSettings.backendMode),
    // A record without a custom URL falls back to the loopback default rather
    // than leaving the Custom field blank.
    backendUrl: normalizeBackendUrl(rawSettings.backendUrl) ?? DEFAULT_SETTINGS.backendUrl,
    // Free-form, so it is only trimmed; a record that predates the field, or one
    // holding rubbish, simply means "no credential".
    backendToken: normalizeBackendToken(rawSettings.backendToken),
  };
}

/**
 * Build the runtime store from the two stored records: the user's settings and
 * the cached backend list.
 */
export function combineStore(rawSettings: unknown, rawCache: unknown): Store {
  const cache = normalizeCollectionsCache(rawCache);
  return { version: SCHEMA_VERSION, settings: normalizeSettings(rawSettings), categories: cache.categories };
}

/* -------------------------------------------------------------------------- */
/* chrome.storage.local access                                                */
/* -------------------------------------------------------------------------- */

async function readKeys(): Promise<{ settings: unknown; cache: unknown }> {
  const result = await chrome.storage.local.get([STORAGE_KEY, COLLECTIONS_CACHE_KEY]);
  return { settings: result[STORAGE_KEY], cache: result[COLLECTIONS_CACHE_KEY] };
}

/**
 * Read and normalize settings from storage. Never rejects on malformed data.
 */
export async function getSettings(): Promise<Settings> {
  try {
    const { settings } = await readKeys();
    return normalizeSettings(settings);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Read the cached collection list.
 *
 * The timestamp is part of the answer, because the caller — not this module —
 * decides whether a refetch is warranted ({@link isCollectionsCacheStale}).
 */
export async function getCollectionsCache(): Promise<CollectionsCache> {
  try {
    const { cache } = await readKeys();
    return normalizeCollectionsCache(cache);
  } catch {
    return emptyCollectionsCache();
  }
}

/** The settings the last write persisted, plus the cached categories. */
export async function getStore(): Promise<Store> {
  try {
    const { settings, cache } = await readKeys();
    return combineStore(settings, cache);
  } catch {
    return combineStore(undefined, undefined);
  }
}

/** All categories, in the backend's order, from the cache. */
export async function getCategories(): Promise<Category[]> {
  return (await getStore()).categories;
}

/**
 * Replace the cached collection list. Called by the service worker after a
 * successful list or mutation — never by a reader.
 */
export async function writeCollectionsCache(categories: Category[], fetchedAt: number = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [COLLECTIONS_CACHE_KEY]: { collections: categories, fetchedAt } });
}

/** Merge a partial settings update and persist it (PRD §50). */
export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const settings: Settings = {
    unbookmarkAfterSave:
      typeof partial.unbookmarkAfterSave === "boolean"
        ? partial.unbookmarkAfterSave
        : current.unbookmarkAfterSave,
    displayMode: partial.displayMode === undefined ? current.displayMode : normalizeDisplayMode(partial.displayMode),
    backendMode: partial.backendMode === undefined ? current.backendMode : normalizeBackendMode(partial.backendMode),
    // An unparseable URL keeps the previously saved one instead of clobbering it;
    // the popup validates before calling, so this is only a safety net.
    backendUrl:
      partial.backendUrl === undefined ? current.backendUrl : (normalizeBackendUrl(partial.backendUrl) ?? current.backendUrl),
    // A token is free-form, so it is only trimmed (and a pasted `Bearer ` prefix
    // dropped). An empty string is a valid value: it means "send no
    // Authorization header".
    backendToken:
      partial.backendToken === undefined ? current.backendToken : normalizeBackendToken(partial.backendToken),
  };

  // Only the settings key is written: the `version` stamp travels with it, and
  // the collections cache is left exactly as the worker last wrote it.
  await chrome.storage.local.set({ [STORAGE_KEY]: { version: SCHEMA_VERSION, settings } });
  return settings;
}

/**
 * Subscribe to changes in the `local` area only (PRD §51), for either key.
 *
 * Both keys matter: a settings change re-renders the popup's controls, and a
 * refreshed collection list has to re-render the injected category buttons on an
 * open timeline without a page reload. The callback receives the whole store, so
 * a subscriber never has to merge the two records itself.
 *
 * Returns an unsubscribe function.
 */
export function onStoreChanged(callback: (store: Store) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== "local") return;
    const relevant =
      Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY) ||
      Object.prototype.hasOwnProperty.call(changes, COLLECTIONS_CACHE_KEY);
    if (!relevant) return;
    void getStore()
      .then((store) => callback(store))
      .catch(() => {
        /* Defensive: a subscriber must never produce an unhandled rejection. */
      });
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
