import type { GalleryPost } from "@/types"

/**
 * Flattened lightbox navigation (LIGHT-03, PRD-2 §27).
 *
 * The lightbox is modelled over a single ordered sequence of media slots rather
 * than a tree of posts: `posts[i].media[j]` becomes slot `k`. Walking `k`
 * forwards therefore walks the rest of the current tweet and then continues
 * into the next loaded tweet's media, which is exactly PRD-2 §27's behaviour.
 *
 * Everything here is pure and free of React so the whole navigation contract —
 * text-only posts contributing no slots, first/last boundary detection, and the
 * clamp that makes `next`/`prev` a no-op (never a wrap) at the loaded edges — is
 * unit-testable without a DOM.
 */

/** One media item's position in the accumulated gallery. */
export interface MediaSlot {
  /** Index into the `posts` array the sequence was flattened from. */
  postIndex: number
  /** Index into that post's `media` array. */
  mediaIndex: number
}

/** The minimal post shape flattening needs (a `GalleryPost` satisfies it). */
export type MediaSlotSource = Pick<GalleryPost, "media">

/** The two directions the lightbox can step in. */
export type LightboxDirection = "next" | "prev"

/** True when `count` is a usable non-negative integer length. */
function normalizeCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}

/**
 * Flatten posts into their media slots, in gallery order.
 *
 * A post with no media (a text-only tweet, PRD-2 §22) contributes **zero**
 * entries, so it can never produce a slot that points at a non-existent image
 * or shift the positions of later media. The result is the exact sequence the
 * `n / total` counter and the prev/next buttons are expressed in.
 */
export function flattenMediaSlots(
  posts: readonly MediaSlotSource[]
): MediaSlot[] {
  const slots: MediaSlot[] = []

  posts.forEach((post, postIndex) => {
    const media = Array.isArray(post.media) ? post.media : []
    for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex += 1) {
      slots.push({ postIndex, mediaIndex })
    }
  })

  return slots
}

/** The flattened position of `(postIndex, mediaIndex)`, or `-1` if absent. */
export function findSlotIndex(
  slots: readonly MediaSlot[],
  postIndex: number,
  mediaIndex: number
): number {
  return slots.findIndex(
    (slot) => slot.postIndex === postIndex && slot.mediaIndex === mediaIndex
  )
}

/** The slot at `index`, or `undefined` for any out-of-range/NaN index. */
export function slotAt(
  slots: readonly MediaSlot[],
  index: number
): MediaSlot | undefined {
  if (!Number.isFinite(index)) {
    return undefined
  }
  const normalized = Math.trunc(index)
  if (normalized < 0 || normalized >= slots.length) {
    return undefined
  }
  return slots[normalized]
}

/**
 * The target index one step in `direction`, **clamped** to the loaded sequence.
 *
 * Stepping past the end returns the end and stepping before the start returns
 * the start: with `total === 0` (or a non-finite `index`) it returns `-1`, the
 * "nothing active" value. There is deliberately no modulo/wrap behaviour, so
 * the first/last item's disabled control and this function can never disagree.
 */
export function stepSlotIndex(
  index: number,
  total: number,
  direction: LightboxDirection
): number {
  const count = normalizeCount(total)
  if (count === 0 || !Number.isFinite(index)) {
    return -1
  }

  const current = Math.min(Math.max(Math.trunc(index), 0), count - 1)
  if (direction === "next") {
    return Math.min(current + 1, count - 1)
  }
  return Math.max(current - 1, 0)
}

/** True when `index` is the first slot of a non-empty sequence. */
export function isFirstSlot(index: number, total: number): boolean {
  const count = normalizeCount(total)
  return count > 0 && Number.isFinite(index) && Math.trunc(index) === 0
}

/** True when `index` is the last slot of a non-empty sequence. */
export function isLastSlot(index: number, total: number): boolean {
  const count = normalizeCount(total)
  return (
    count > 0 && Number.isFinite(index) && Math.trunc(index) === count - 1
  )
}
