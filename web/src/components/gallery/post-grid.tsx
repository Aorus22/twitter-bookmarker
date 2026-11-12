import { Children, isValidElement, type ReactNode } from "react"

import {
  MASONRY_COLUMN_GAP,
  MASONRY_ROW_GAP,
  clampMasonryColumns,
} from "@/lib/masonry"
import { cn } from "@/lib/utils"

/**
 * Aligned grid of uniform post tiles (owner request, Nov 2026).
 *
 * Unlike {@link GalleryMasonry}, rows are aligned: cards in a row stretch to the
 * tallest tile and share a baseline, which is what makes the mode read as a
 * grid. The uniform height itself comes from `PostCard`'s `grid` variant, whose
 * media region is a square thumbnail.
 *
 * The column count comes from the same measured breakpoints as the masonry, so
 * switching modes never changes how many cards fit across the page.
 */
export interface PostGridProps {
  children: ReactNode
  columns: number
  className?: string
}

export function PostGrid({ children, columns, className }: PostGridProps) {
  const count = clampMasonryColumns(columns)
  const items = Children.toArray(children)

  return (
    <ul
      data-testid="post-grid"
      data-columns={count}
      style={{
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        columnGap: `${MASONRY_COLUMN_GAP}px`,
        rowGap: `${MASONRY_ROW_GAP}px`,
      }}
      className={cn("grid w-full list-none items-stretch", className)}
    >
      {items.map((child, index) => (
        <li
          key={isValidElement(child) && child.key !== null ? child.key : index}
          className="flex min-w-0"
        >
          {child}
        </li>
      ))}
    </ul>
  )
}
