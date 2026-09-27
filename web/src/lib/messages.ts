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
