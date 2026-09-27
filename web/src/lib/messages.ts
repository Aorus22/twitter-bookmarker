/**
 * Exact user-facing copy prescribed by PRD-2 §59/§61.
 *
 * These strings are contract, not styling: the acceptance harness and the
 * product requirements both match them literally. Keep every consumer importing
 * from here so there is exactly one source of truth.
 */

/** PRD-2 §61 — the backend is unreachable (transport failure). */
export const COULD_NOT_CONNECT_MESSAGE =
  "Could not connect to Twitter Bookmarker backend"

/** PRD-2 §61 — the gallery API failed for any other reason. */
export const COULD_NOT_LOAD_COLLECTION_MESSAGE =
  "Could not load this collection"

/** PRD-2 §59 — no CSV files exist yet. */
export const NO_COLLECTIONS_TITLE = "No collections yet"

/** PRD-2 §59 — the supporting line for the empty gallery state. */
export const NO_COLLECTIONS_MESSAGE =
  "Saved tweets will appear here after you organize them with the extension."

/** PRD-2 §61 — the retry action label. */
export const RETRY_LABEL = "Retry"

/** PRD-2 §60 — a valid collection that contains no posts. */
export const EMPTY_COLLECTION_TITLE = "This collection is empty"

/** Design spec §3.6 — the supporting line for the empty-collection state. */
export const EMPTY_COLLECTION_MESSAGE =
  "This folder is quiet. The next bookmark will bring it to life."

/** PRD-2 §60 — zero results because the active filters match nothing. */
export const NO_FILTER_MATCH_TITLE = "No posts match your filters"

/** PRD-2 §60 — the action that clears the active filters. */
export const CLEAR_FILTERS_LABEL = "Clear filters"

/** Design spec §3.3 — the collection page back link. */
export const BACK_TO_COLLECTIONS_LABEL = "← Collections"

/** Design spec §3.3 — the collection toolbar search placeholder. */
export const COLLECTION_SEARCH_PLACEHOLDER = "⌕ Search this collection…"

/** Design spec §3.3 — the filter control label. */
export const FILTER_LABEL = "Filter"

/** PRD-2 §24 — the link that opens the original post on X. */
export const OPEN_ON_X_LABEL = "Open on X ↗"

/** PRD-2 §23 — the controlled-clamp affordance. */
export const SHOW_MORE_LABEL = "Show more"

/** The inverse of {@link SHOW_MORE_LABEL}, once the text is expanded. */
export const SHOW_LESS_LABEL = "Show less"
