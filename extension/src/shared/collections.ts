/**
 * The collection list: how a wire `Collection` becomes the row the UI renders,
 * and when a cached list is stale enough to refetch.
 *
 * Pure functions only — no `chrome.*`, no `fetch`. The persistence lives in
 * `storage.ts` and the requests in `api.ts`; this module is the shared policy
 * between them, which is also what makes it directly testable.
 */

import { COLLECTIONS_TTL_MS, DEFAULT_CATEGORY_COLOR } from "./constants.ts";
import { isValidSlug } from "./slug.ts";
import type { Category } from "./types.ts";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Coerce an unknown value into a valid hex colour, or `""` for "none".
 *
 * Note the difference from a *rendering* default: a category with no colour keeps
 * an empty string here so the UI can tell "the user chose nothing" from "the user
 * chose coral". {@link DEFAULT_CATEGORY_COLOR} is applied by the renderer.
 */
export function normalizeCollectionColor(value: unknown): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : "";
}

/**
 * The colour to paint for a category, falling back to the shared default.
 *
 * One helper rather than a `||` at each call site, so the messenger rows, the
 * popup dots and any future surface agree on what "no colour" looks like.
 */
export function displayColor(color: string): string {
  return color.length > 0 ? color : DEFAULT_CATEGORY_COLOR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Coerce one wire collection into a renderable category, or `null` when it cannot
 * be used.
 *
 * A category whose slug fails {@link isValidSlug} is dropped rather than repaired:
 * the slug lands in a request path, and inventing one would send a save to a
 * collection that does not exist. Dropping it also keeps a hand-edited cache from
 * inventing a row the backend never had.
 */
export function toCategory(value: unknown): Category | null {
  if (!isRecord(value)) return null;

  const slug = typeof value.slug === "string" ? value.slug : "";
  if (!isValidSlug(slug)) return null;

  // `name` is NOT NULL in the database, so an empty one can only come from a
  // mangled cache; falling back to the slug keeps the row identifiable.
  const name = typeof value.name === "string" && value.name.trim().length > 0 ? value.name.trim() : slug;
  const order = typeof value.order === "number" && Number.isFinite(value.order) ? value.order : 0;

  return { id: slug, slug, name, color: normalizeCollectionColor(value.color), order };
}

/**
 * Coerce a whole list. Never throws: a malformed entry is skipped, so one bad row
 * cannot blank the popup.
 */
export function toCategories(value: unknown): Category[] {
  const list = Array.isArray(value) ? value : [];
  const categories: Category[] = [];
  for (const entry of list) {
    const category = toCategory(entry);
    if (category !== null) categories.push(category);
  }
  return categories.sort(byOrder);
}

/**
 * Sort categories by the backend's order, with the slug as a deterministic
 * tie-break.
 *
 * The tie-break is defensive. The backend writes dense positions, so two rows
 * cannot share one; a cache assembled from two different responses could, and the
 * list must still render in a stable order rather than in whatever order the
 * array happened to hold.
 */
export function byOrder(a: Category, b: Category): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Locally reorder a cached list after the user drags or nudges a row, before (or
 * without) the backend's answer.
 *
 * It is the same operation the backend performs — place the named slugs first, in
 * the given order, and everything unnamed behind them in its previous order — so
 * the optimistic render and the server's list cannot disagree about the shape of
 * the change. Renumbering to 0..n-1 mirrors `ReorderCollections`.
 */
export function reorderCategories(categories: readonly Category[], orderedSlugs: readonly string[]): Category[] {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const ordered: Category[] = [];

  for (const slug of orderedSlugs) {
    const category = bySlug.get(slug);
    if (category) {
      ordered.push(category);
      bySlug.delete(slug);
    }
  }
  for (const category of categories) {
    if (bySlug.has(category.slug)) {
      ordered.push(category);
      bySlug.delete(category.slug);
    }
  }

  return ordered.map((category, index) => (category.order === index ? category : { ...category, order: index }));
}

/** Move one category one position earlier or later; returns the resulting slug order. */
export function moveSlug(categories: readonly Category[], slug: string, delta: number): string[] {
  const slugs = categories.map((category) => category.slug);
  const from = slugs.indexOf(slug);
  if (from < 0) return slugs;

  const to = from + delta;
  if (to < 0 || to >= slugs.length) return slugs;

  const next = [...slugs];
  next.splice(from, 1);
  next.splice(to, 0, slug);
  return next;
}

/** A cached collection list and when it was fetched. */
export interface CollectionsCache {
  /** The list as fetched, already mapped and ordered. */
  categories: Category[];
  /** Epoch milliseconds of the fetch that produced it. */
  fetchedAt: number;
}

/** An empty cache, for a fresh install or unreadable storage. */
export function emptyCollectionsCache(): CollectionsCache {
  return { categories: [], fetchedAt: 0 };
}

/**
 * Coerce a value read from `chrome.storage.local` into a cache.
 *
 * A missing timestamp reads as 0, which makes the cache stale — the safe
 * direction, since refetching an unchanged list costs one request while rendering
 * a month-old one silently hides a category.
 */
export function normalizeCollectionsCache(raw: unknown): CollectionsCache {
  if (!isRecord(raw)) return emptyCollectionsCache();
  const fetchedAt =
    typeof raw.fetchedAt === "number" && Number.isFinite(raw.fetchedAt) && raw.fetchedAt > 0 ? raw.fetchedAt : 0;
  return { categories: toCategories(raw.collections), fetchedAt };
}

/**
 * True when the cache is old enough (or empty enough) to refetch.
 *
 * An empty cache is always stale, even if it was written a second ago: "the
 * backend has no categories" and "the list was never fetched" render identically
 * but mean opposite things, and only a fetch can tell them apart.
 */
export function isCollectionsCacheStale(
  cache: CollectionsCache,
  now: number = Date.now(),
  ttlMs: number = COLLECTIONS_TTL_MS,
): boolean {
  if (cache.fetchedAt <= 0) return true;
  if (cache.categories.length === 0) return true;
  return now - cache.fetchedAt >= ttlMs;
}

/**
 * A human-readable message for a failed collection request, for the popup's
 * inline error line. Kept here so the popup and the content script phrase the
 * same failure the same way.
 */
export function collectionsErrorMessage(code: string | undefined): string {
  switch (code) {
    case "conflict":
      return "A category with that name already exists";
    case "not_found":
      return "That category no longer exists";
    case "invalid_request":
      return "The backend rejected that change";
    case "backend_unavailable":
      return "Backend unavailable — categories cannot be changed";
    default:
      return "Could not change categories";
  }
}
