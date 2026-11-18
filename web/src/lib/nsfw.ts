import type { GalleryCollection } from "@/types"

/**
 * NSFW detection for the homepage (owner request, Nov 2026).
 *
 * There is no dedicated `nsfw` flag on a collection (the wire contract is
 * `{slug, name, …}`), so the marker lives in the **title**: any collection whose
 * name carries `nsfw` — case-insensitive, anywhere in the string, so `NSFW`,
 * `nsfw art` and `Gifs (NSFW)` all count — has its imagery blurred on the
 * homepage. Matching is deliberately a plain substring, not a word-boundary
 * regex: underscores and punctuation in real titles (`nsfw_art`, `(nsfw)`)
 * would otherwise slip through the guard.
 */

/** The title marker that marks a collection as NSFW. */
export const NSFW_MARKER = "nsfw"

/** The subset of a collection the guard needs. */
export type NsfwSource = Pick<GalleryCollection, "name" | "slug">

/** True when a collection title carries the NSFW marker. */
export function isNsfwTitle(title: string): boolean {
  return title.toLowerCase().includes(NSFW_MARKER)
}

/**
 * True when a collection should be treated as NSFW. An empty name falls back to
 * the slug, which is the same substitution the card uses for its heading.
 */
export function isNsfwCollection(collection: NsfwSource): boolean {
  const title =
    collection.name.trim() === "" ? collection.slug : collection.name
  return isNsfwTitle(title)
}
