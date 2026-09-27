/**
 * Query-change scroll behaviour (PRD-2 §77, DISC-08).
 *
 * When search/filter/sort changes, the page clears the loaded pages, resets the
 * cursor, scrolls **near the top** and fetches page 1. Keeping the scroll in a
 * tiny module makes it a documented, testable behaviour rather than an inline
 * side effect.
 */

/** The target the query-change scroll moves to. */
export const QUERY_CHANGE_SCROLL_TOP = 0

/**
 * Scroll the window near the top. Guarded so a non-browser or layout-less
 * environment (jsdom) without `scrollTo` cannot throw.
 */
export function scrollNearTop(): void {
  if (typeof window === "undefined" || typeof window.scrollTo !== "function") {
    return
  }

  window.scrollTo({ top: QUERY_CHANGE_SCROLL_TOP, left: 0, behavior: "auto" })
}
