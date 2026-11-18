/**
 * Gallery view modes (owner request, Nov 2026).
 *
 * The collection page can render its posts three ways, and the choice is a
 * **persisted preference** rather than URL state: it belongs to the person
 * browsing, not to a particular search/filter/sort, and it should survive
 * opening another collection. Kept in `localStorage` under a namespaced key.
 *
 *   - `masonry` — the original Pinterest-style natural-height columns;
 *   - `grid`    — uniform square-thumbnail tiles in aligned rows;
 *   - `rows`    — one horizontal card per post, thumbnail left, text right.
 *
 * Pure helpers so the parsing and storage degradation are unit-testable.
 */

export const VIEW_MODES = [
  { value: "masonry", label: "Masonry" },
  { value: "grid", label: "Grid" },
  { value: "rows", label: "Rows" },
] as const

export type GalleryViewMode = (typeof VIEW_MODES)[number]["value"]

/** The layout the collection page has always used; also the fallback. */
export const DEFAULT_VIEW_MODE: GalleryViewMode = "masonry"

/** `localStorage` key for the preference. */
export const VIEW_MODE_STORAGE_KEY = "twb.gallery.view-mode"

const VIEW_MODE_VALUES = new Set<string>(VIEW_MODES.map((mode) => mode.value))

/** True when `value` is a known view mode. */
export function isGalleryViewMode(value: unknown): value is GalleryViewMode {
  return typeof value === "string" && VIEW_MODE_VALUES.has(value)
}

/** Parse a stored/unknown value, degrading to the default instead of throwing. */
export function parseViewMode(value: unknown): GalleryViewMode {
  return isGalleryViewMode(value) ? value : DEFAULT_VIEW_MODE
}

/** The visible label for a mode. */
export function viewModeLabel(mode: GalleryViewMode): string {
  return VIEW_MODES.find((option) => option.value === mode)?.label ?? mode
}

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    // A blocked storage (private mode, disabled cookies) must never break the
    // gallery: the preference simply stops persisting.
    return undefined
  }
}

/** Read the persisted mode; the default when nothing valid is stored. */
export function readStoredViewMode(): GalleryViewMode {
  try {
    return parseViewMode(storage()?.getItem(VIEW_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_VIEW_MODE
  }
}

/** Persist the mode, ignoring a storage that refuses to write. */
export function writeStoredViewMode(mode: GalleryViewMode): void {
  try {
    storage()?.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // See `readStoredViewMode`: persistence is best-effort.
  }
}
