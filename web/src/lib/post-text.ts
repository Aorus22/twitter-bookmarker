/**
 * Controlled text clamp for post cards (PRD-2 §23, COLL-08).
 *
 * Tweet text is never cut aggressively; long text collapses to a fixed number
 * of lines and a `Show more` affordance expands it **in place**. Whether the
 * affordance is needed is decided by a character threshold rather than a
 * measured overflow: jsdom (and any pre-render pass) has no layout engine, so a
 * pure deterministic rule is the only testable one. Short tweets therefore
 * never show a dead `Show more`.
 *
 * The clamp classes are spelled out as literals (not built from a number) so
 * Tailwind's class scanner always emits them.
 */

/** Text longer than this collapses and offers `Show more`. */
export const POST_TEXT_CLAMP_CHARS = 200

/** Lines shown for the body paragraph of a media post (5). */
export const BODY_TEXT_CLAMP_CLASS = "line-clamp-5"

/** Lines shown inside the text-only gradient quote panel (5). */
export const QUOTE_TEXT_CLAMP_CLASS = "line-clamp-5"

/** True when the tweet text is long enough to need the clamp affordance. */
export function isLongPostText(text: string): boolean {
  return text.trim().length > POST_TEXT_CLAMP_CHARS
}

/** The clamp class for a variant, or `""` once the text is expanded. */
export function clampClassName(
  variant: "body" | "quote",
  expanded: boolean
): string {
  if (expanded) {
    return ""
  }
  return variant === "quote" ? QUOTE_TEXT_CLAMP_CLASS : BODY_TEXT_CLAMP_CLASS
}
