import type { GalleryPost } from "@/types"

import {
  COLLECTION_META_LABEL,
  POSTED_META_LABEL,
  SAVED_META_LABEL,
} from "./messages"

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

/** The three meta lines the lightbox info panel renders (design spec §3.5). */
export interface LightboxMetaLines {
  /** `Posted Mar 12, 2026` — the tweet's date, year always present. */
  posted: string
  /** `Saved Apr 3` — the bookmark date, year-aware like the card meta row. */
  saved: string
  /** `Collection Linux` — the backend `DisplayName`, never the filename. */
  collection: string
}

/**
 * Build the lightbox info panel's meta block as three separate lines.
 *
 * The design spec §3.5 pins the shape `Posted <date>` / `Saved <date>` /
 * `Collection <name>`; the collection name comes from the posts hook's
 * collection summary (the backend's `DisplayName`) so the filename is never
 * shown to the user. A missing/invalid date leaves its bare label rather than
 * printing `Invalid Date`.
 */
export function formatLightboxMeta(
  post: PostMetaSource,
  collectionName: string,
  options: DateFormatOptions = {}
): LightboxMetaLines {
  const posted = formatLocalFullDate(post.tweet_date, options)
  const saved = formatLocalDate(post.saved_at, options)
  const name = collectionName.trim()

  return {
    posted: `${POSTED_META_LABEL} ${posted}`.trim(),
    saved: `${SAVED_META_LABEL} ${saved}`.trim(),
    collection:
      name === ""
        ? COLLECTION_META_LABEL
        : `${COLLECTION_META_LABEL} ${name}`,
  }
}
