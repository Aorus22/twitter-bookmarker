import type { GalleryCollection } from "@/types"

import { formatLastSaved, type DateFormatOptions } from "./date"

/**
 * The homepage card meta row (PRD-2 §16, design spec §3.2):
 *
 *   `83 posts · 126 media · Last saved Sep 27`
 *
 * The mockup omits the date and shows a description instead; the date is
 * required by the PRD and the description has no CSV field, so the date wins.
 */

/** `1 post` / `83 posts` — never `1 posts`. */
export function formatCount(
  count: number,
  singular: string,
  plural: string = `${singular}s`
): string {
  const value = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  return `${value} ${value === 1 ? singular : plural}`
}

/** The subset of a collection the meta row needs. */
export type CollectionMetaSource = Pick<
  GalleryCollection,
  "post_count" | "media_count" | "last_saved_at"
>

export function formatCollectionMeta(
  collection: CollectionMetaSource,
  options: DateFormatOptions = {}
): string {
  return [
    formatCount(collection.post_count, "post"),
    // "media" is invariant in the product copy (`126 media`, not `medias`).
    formatCount(collection.media_count, "media", "media"),
    formatLastSaved(collection.last_saved_at, options),
  ].join(" · ")
}
