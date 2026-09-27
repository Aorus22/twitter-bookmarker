import { describe, expect, it } from "vitest"

import {
  findSlotIndex,
  flattenMediaSlots,
  isFirstSlot,
  isLastSlot,
  slotAt,
  stepSlotIndex,
  type MediaSlot,
} from "./lightbox"

/**
 * LIGHT-03 pure contract (PRD-2 §27): the lightbox walks one flattened
 * `(postIndex, mediaIndex)` sequence, text-only posts contribute nothing,
 * navigation crosses tweet boundaries, and the two loaded edges are honest
 * clamps — never a wrap.
 */

/** `[2 media, 0 media (text-only), 1 media]` — the canonical mixed dataset. */
const MIXED = [
  { media: ["a1", "a2"] },
  { media: [] },
  { media: ["c1"] },
]

describe("flattenMediaSlots — the flattened sequence (LIGHT-03)", () => {
  it("walks a post's media in order then continues into the next post", () => {
    expect(flattenMediaSlots(MIXED)).toEqual<MediaSlot[]>([
      { postIndex: 0, mediaIndex: 0 },
      { postIndex: 0, mediaIndex: 1 },
      { postIndex: 2, mediaIndex: 0 },
    ])
  })

  it("skips text-only posts without shifting later positions", () => {
    const slots = flattenMediaSlots(MIXED)

    expect(slots).toHaveLength(3)
    // The text-only post (index 1) produced no slot at all.
    expect(slots.some((slot) => slot.postIndex === 1)).toBe(false)
    // The post after it kept its own index.
    expect(slots[2]).toEqual({ postIndex: 2, mediaIndex: 0 })
  })

  it("handles a dataset with no media at all", () => {
    expect(flattenMediaSlots([{ media: [] }, { media: [] }])).toEqual([])
    expect(flattenMediaSlots([])).toEqual([])
  })

  it("never truncates a post with more than four media", () => {
    const slots = flattenMediaSlots([{ media: ["1", "2", "3", "4", "5", "6"] }])

    expect(slots).toHaveLength(6)
    expect(slots[5]).toEqual({ postIndex: 0, mediaIndex: 5 })
  })

  it("survives a malformed media field from the backend", () => {
    const slots = flattenMediaSlots([
      { media: undefined as unknown as string[] },
      { media: ["ok"] },
    ])

    expect(slots).toEqual([{ postIndex: 1, mediaIndex: 0 }])
  })
})

describe("findSlotIndex / slotAt — position lookup (LIGHT-03)", () => {
  const slots = flattenMediaSlots(MIXED)

  it("maps a clicked (post, media) pair to its flattened position", () => {
    expect(findSlotIndex(slots, 0, 0)).toBe(0)
    expect(findSlotIndex(slots, 0, 1)).toBe(1)
    expect(findSlotIndex(slots, 2, 0)).toBe(2)
  })

  it("returns -1 for a text-only post, an out-of-range media index, or an unknown post", () => {
    expect(findSlotIndex(slots, 1, 0)).toBe(-1)
    expect(findSlotIndex(slots, 0, 2)).toBe(-1)
    expect(findSlotIndex(slots, 9, 0)).toBe(-1)
  })

  it("returns the slot at an index and nothing outside the sequence", () => {
    expect(slotAt(slots, 1)).toEqual({ postIndex: 0, mediaIndex: 1 })
    expect(slotAt(slots, 3)).toBeUndefined()
    expect(slotAt(slots, -1)).toBeUndefined()
    expect(slotAt(slots, Number.NaN)).toBeUndefined()
  })
})

describe("stepSlotIndex — boundaries are clamps, not wraps (LIGHT-03)", () => {
  it("steps forward and backward inside the sequence", () => {
    expect(stepSlotIndex(0, 3, "next")).toBe(1)
    expect(stepSlotIndex(2, 3, "prev")).toBe(1)
  })

  it("stops at the very last loaded item instead of wrapping", () => {
    expect(stepSlotIndex(2, 3, "next")).toBe(2)
    expect(stepSlotIndex(0, 1, "next")).toBe(0)
  })

  it("stops at the very first loaded item instead of wrapping", () => {
    expect(stepSlotIndex(0, 3, "prev")).toBe(0)
    expect(stepSlotIndex(0, 1, "prev")).toBe(0)
  })

  it("clamps a nonsense index into range rather than returning an invalid slot", () => {
    expect(stepSlotIndex(99, 3, "next")).toBe(2)
    expect(stepSlotIndex(-5, 3, "prev")).toBe(0)
  })

  it("has nothing to step to when no media is loaded", () => {
    expect(stepSlotIndex(0, 0, "next")).toBe(-1)
    expect(stepSlotIndex(0, 0, "prev")).toBe(-1)
    expect(stepSlotIndex(Number.NaN, 3, "next")).toBe(-1)
  })

  it("crosses into the next tweet's media at a post boundary (PRD-2 §27)", () => {
    const slots = flattenMediaSlots(MIXED)
    const lastOfFirstPost = findSlotIndex(slots, 0, 1)

    // One step forward leaves post 0 and, skipping the text-only post 1,
    // lands on post 2's only image.
    const next = stepSlotIndex(lastOfFirstPost, slots.length, "next")
    expect(slotAt(slots, next)).toEqual({ postIndex: 2, mediaIndex: 0 })

    // And back again.
    expect(slotAt(slots, stepSlotIndex(next, slots.length, "prev"))).toEqual({
      postIndex: 0,
      mediaIndex: 1,
    })
  })
})

describe("isFirstSlot / isLastSlot (LIGHT-03)", () => {
  it("detects the two loaded edges", () => {
    expect(isFirstSlot(0, 3)).toBe(true)
    expect(isFirstSlot(1, 3)).toBe(false)
    expect(isLastSlot(2, 3)).toBe(true)
    expect(isLastSlot(1, 3)).toBe(false)
  })

  it("is false for every index when nothing is loaded", () => {
    expect(isFirstSlot(0, 0)).toBe(false)
    expect(isLastSlot(0, 0)).toBe(false)
  })
})
