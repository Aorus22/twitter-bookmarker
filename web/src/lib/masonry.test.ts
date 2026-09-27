import { describe, expect, it } from "vitest"

import {
  columnsForWidth,
  MASONRY_CARD_WIDTH,
  MASONRY_COLUMN_GAP,
  MASONRY_MAX_COLUMNS,
  MASONRY_MIN_COLUMNS,
  MASONRY_ROW_GAP,
  masonryContainerWidth,
} from "./masonry"

/**
 * The masonry mapping is pure so every breakpoint is testable without a layout
 * engine: jsdom has no real `clientWidth`, so the alternative — asserting on a
 * rendered component — could not distinguish the breakpoints at all.
 */
describe("masonry constants (design spec §3.3, Figma-validated)", () => {
  it("uses the measured card width and gaps", () => {
    expect(MASONRY_CARD_WIDTH).toBe(292)
    expect(MASONRY_COLUMN_GAP).toBe(32)
    expect(MASONRY_ROW_GAP).toBe(22)
    expect(MASONRY_MIN_COLUMNS).toBe(1)
    expect(MASONRY_MAX_COLUMNS).toBe(5)
  })
})

describe("masonryContainerWidth", () => {
  it("fits n cards plus the gaps between them", () => {
    expect(masonryContainerWidth(1)).toBe(292)
    expect(masonryContainerWidth(2)).toBe(616)
    expect(masonryContainerWidth(3)).toBe(940)
    expect(masonryContainerWidth(4)).toBe(1264)
    expect(masonryContainerWidth(5)).toBe(1588)
  })

  it("clamps nonsense column counts into the supported range", () => {
    expect(masonryContainerWidth(0)).toBe(292)
    expect(masonryContainerWidth(-3)).toBe(292)
    expect(masonryContainerWidth(99)).toBe(1588)
    expect(masonryContainerWidth(Number.NaN)).toBe(292)
  })
})

describe("columnsForWidth (PRD-2 §21/§66)", () => {
  it("returns 1 column on small viewports", () => {
    expect(columnsForWidth(320)).toBe(1)
    expect(columnsForWidth(390)).toBe(1)
    expect(columnsForWidth(615)).toBe(1)
  })

  it("returns 2–3 columns on medium viewports", () => {
    expect(columnsForWidth(616)).toBe(2)
    expect(columnsForWidth(768)).toBe(2)
    expect(columnsForWidth(939)).toBe(2)
    expect(columnsForWidth(940)).toBe(3)
    expect(columnsForWidth(1100)).toBe(3)
    expect(columnsForWidth(1263)).toBe(3)
  })

  it("returns 4–5 columns on desktop viewports", () => {
    expect(columnsForWidth(1264)).toBe(4)
    expect(columnsForWidth(1312)).toBe(4)
    expect(columnsForWidth(1440)).toBe(4)
    expect(columnsForWidth(1587)).toBe(4)
    expect(columnsForWidth(1588)).toBe(5)
    expect(columnsForWidth(1920)).toBe(5)
  })

  it("gives 4 columns at the 1440px frame's 1312px content column", () => {
    // The shell caps the content column at 1312 (1440 − 2×64), which is the
    // width the masonry actually measures.
    expect(columnsForWidth(1440 - 128)).toBe(4)
  })

  it("never returns a count whose cards would overflow the available width", () => {
    for (const width of [300, 500, 700, 900, 1000, 1200, 1300, 1400, 1600, 2000]) {
      const columns = columnsForWidth(width)
      if (width >= MASONRY_CARD_WIDTH) {
        expect(masonryContainerWidth(columns)).toBeLessThanOrEqual(width)
      }
    }
  })

  it("degrades to a single column for nonsense widths", () => {
    expect(columnsForWidth(0)).toBe(1)
    expect(columnsForWidth(-100)).toBe(1)
    expect(columnsForWidth(Number.NaN)).toBe(1)
    expect(columnsForWidth(Number.POSITIVE_INFINITY)).toBe(1)
  })
})
