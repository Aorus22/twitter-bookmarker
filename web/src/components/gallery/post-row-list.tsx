import { Children, isValidElement, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Single-file list of horizontal post rows (owner request, Nov 2026).
 *
 * The reading-heavy mode: one tweet per line, in logical order, so a scrolled
 * page can be read top to bottom without the columns of the masonry. The rows
 * keep the full page width; each row's text is capped by `PostRow` itself.
 */
export interface PostRowListProps {
  children: ReactNode
  className?: string
}

export function PostRowList({ children, className }: PostRowListProps) {
  const items = Children.toArray(children)

  return (
    <ul
      data-testid="post-rows"
      className={cn("flex w-full list-none flex-col gap-3", className)}
    >
      {items.map((child, index) => (
        <li
          key={isValidElement(child) && child.key !== null ? child.key : index}
          className="min-w-0"
        >
          {child}
        </li>
      ))}
    </ul>
  )
}
