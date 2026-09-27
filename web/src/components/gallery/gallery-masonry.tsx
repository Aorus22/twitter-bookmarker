import { Children, useRef, type ReactNode } from "react"

import { useMasonryColumns } from "@/hooks/use-masonry-columns"
import {
  MASONRY_COLUMN_GAP,
  MASONRY_ROW_GAP,
  masonryContainerWidth,
} from "@/lib/masonry"
import { cn } from "@/lib/utils"

/**
 * Pinterest-style post masonry (PRD-2 §21, design spec §3.3).
 *
 * CSS multi-column: the browser balances the cards across `columnCount`
 * columns, and `break-inside: avoid` keeps every card whole so a card can never
 * split across a column break. Card heights are the **natural** height of their
 * content (media aspect + text), never a fixed row height — this is masonry,
 * not a grid with equalised rows.
 *
 * The container is capped at `n*292 + (n-1)*32` so a column is exactly the
 * design's 292-wide card instead of flexing wider on a large viewport. Each
 * child is wrapped in a `<li>` (the element must be a list child) carrying the
 * 22px vertical rhythm.
 *
 * `columns` exists so a test can pin the count; production always measures the
 * container via {@link useMasonryColumns}.
 */

export interface GalleryMasonryProps {
  children: ReactNode
  /** Force a column count (tests / Phase 7); defaults to the measured count. */
  columns?: number
  className?: string
}

export function GalleryMasonry({
  children,
  columns,
  className,
}: GalleryMasonryProps) {
  const containerRef = useRef<HTMLUListElement>(null)
  const measured = useMasonryColumns(containerRef)
  const count = columns ?? measured

  return (
    <ul
      ref={containerRef}
      data-testid="gallery-masonry"
      data-columns={count}
      style={{
        columnCount: count,
        columnGap: `${MASONRY_COLUMN_GAP}px`,
        maxWidth: `${masonryContainerWidth(count)}px`,
      }}
      className={cn("w-full list-none", className)}
    >
      {Children.map(children, (child) =>
        child === null || child === undefined ? null : (
          <li
            className="w-full break-inside-avoid"
            style={{ marginBottom: `${MASONRY_ROW_GAP}px` }}
          >
            {child}
          </li>
        )
      )}
    </ul>
  )
}
