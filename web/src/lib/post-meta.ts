import type { GalleryPost } from "@/types"

import {
  formatLocalDate,
  formatLocalFullDate,
  type DateFormatOptions,
} from "./date"

/**
 * The post-card meta row (PRD-2 §23, design spec §3.3):
 *
 *   `Mar 12, 2026 · Saved Apr 3`
 *
 * Both dates the PRD requires are present: the tweet date with its year (the
 * mockup's literal form) and the bookmark date in the short year-aware form.
 * A missing date simply drops its segment instead of printing `Invalid Date`.
 */

/** The subset of a post the meta row needs. */
export type PostMetaSource = Pick<GalleryPost, "tweet_date" | "saved_at">

export function formatPostMeta(
  post: PostMetaSource,
  options: DateFormatOptions = {}
): string {
  const posted = formatLocalFullDate(post.tweet_date, options)
  const saved = formatLocalDate(post.saved_at, options)

  const parts: string[] = []
  if (posted !== "") {
    parts.push(posted)
  }
  if (saved !== "") {
    parts.push(`Saved ${saved}`)
  }

  return parts.join(" · ")
}
