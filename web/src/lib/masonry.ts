/**
 * Pinterest-masonry geometry (PRD-2 §21, design spec §3.3 frame `6:121`).
 *
 * The layout is CSS multi-column: `columnCount` with `break-inside: avoid` on
 * every card, so each card keeps its **natural** height and nothing is
 * equalised into a row grid. This module owns the numbers that the component
 * and the page share, and keeps the responsive decision a pure function so it
 * can be unit-tested at every breakpoint without a layout engine.
 *
 * Figma-validated numbers: card `292`, horizontal gap `32`, vertical gap `22`,
 * column pitch x = 64/388/712/1036 at 1440px.
 */

/** Post-card width; the masonry column is exactly this (design spec §3.3). */
export const MASONRY_CARD_WIDTH = 292

/** Horizontal gap between masonry columns (design spec §3.3: 388−64−292). */
export const MASONRY_COLUMN_GAP = 32

/** Vertical gap between cards in a column (design spec §3.3: 448→970→1035). */
export const MASONRY_ROW_GAP = 22

/** PRD-2 §21/§66 — small viewports get a single column. */
export const MASONRY_MIN_COLUMNS = 1

/** PRD-2 §21 — desktop targets 4–5 columns. */
export const MASONRY_MAX_COLUMNS = 5

function clampColumns(columns: number): number {
  const value = Number.isFinite(columns) ? Math.trunc(columns) : MASONRY_MIN_COLUMNS
  return Math.min(MASONRY_MAX_COLUMNS, Math.max(MASONRY_MIN_COLUMNS, value))
}

/**
 * The container width that fits exactly `columns` full-width cards plus the
 * gaps between them. Used as the masonry's `max-width` so a column is never
 * stretched past the Figma card width.
 */
export function masonryContainerWidth(columns: number): number {
  const count = clampColumns(columns)
  return count * MASONRY_CARD_WIDTH + (count - 1) * MASONRY_COLUMN_GAP
}

/**
 * Responsive column count for an **available content width**.
 *
 * Exact-fit thresholds, derived from {@link masonryContainerWidth}:
 *
 * | columns | width from |
 * |---------|-----------|
 * | 1       | 0         |
 * | 2       | 616       |
 * | 3       | 940       |
 * | 4       | 1264      |
 * | 5       | 1588      |
 *
 * Because the thresholds are the width 292-wide cards actually need, a 292-wide
 * card can never overflow its column at any viewport width. The shell caps its
 * content column at 1312px, so a 1440px viewport yields **4** columns (the
 * design spec's frame `6:121` layout); 5 is reachable only on a wider container
 * and is kept because PRD-2 §21 allows 4–5.
 *
 * Non-finite or negative widths degrade to one column.
 */
export function columnsForWidth(width: number): number {
  const available = Number.isFinite(width) ? Math.max(0, width) : 0

  for (let count = MASONRY_MAX_COLUMNS; count > MASONRY_MIN_COLUMNS; count -= 1) {
    if (available >= masonryContainerWidth(count)) {
      return count
    }
  }

  return MASONRY_MIN_COLUMNS
}
