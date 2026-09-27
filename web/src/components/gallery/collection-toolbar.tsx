import { ListFilter } from "lucide-react"
import type { ReactNode } from "react"

import { SORT_OPTIONS } from "@/lib/collection-sort"
import {
  COLLECTION_SEARCH_PLACEHOLDER,
  FILTER_LABEL,
} from "@/lib/messages"
import { cn } from "@/lib/utils"
import type { GallerySort } from "@/types"

/**
 * Collection toolbar shell (COLL-01, design spec §3.3).
 *
 * Controls, all 40 tall, exactly as Figma measures them:
 *   - search `440×40` `r12` (`surface` + border),
 *   - `Filter` `86×40` `r12`,
 *   - sort `150×40` `r12`.
 *
 * **Phase 6 seam.** Phase 5 left this component presentational and owns no
 * behaviour: the page passes controlled values and change callbacks. Phase 6
 * supplies the real handlers (debounced search, `FilterControl`,
 * `useGalleryQuery` for the URL-synced sort) against this exact prop contract:
 *
 *   search: string            onSearchChange: (value: string) => void
 *   filterActive: boolean     onFilterClick?: () => void
 *   sort: GallerySort         onSortChange: (value: GallerySort) => void
 *   filterControl?: ReactNode
 *
 * `filterControl` is how Phase 6 swaps the built-in `Filter` button for the
 * popover/sheet **trigger** while keeping the button in the toolbar (and keeping
 * this component's default button, and its tests, intact).
 *
 * `filterActive` renders the active dot only; the popover's `aria-expanded` /
 * `aria-haspopup` semantics belong to the trigger Phase 6 supplies.
 *
 * The mockup's media-type pills and topic pills are deliberately omitted
 * (design spec §7) and a test asserts their absence.
 */

export interface CollectionToolbarProps {
  /** Current search text (Phase 6: the immediate pre-debounce echo). */
  search: string
  onSearchChange: (value: string) => void
  /** True when a date filter is applied. */
  filterActive?: boolean
  /** Invoked by the built-in button when no `filterControl` is supplied. */
  onFilterClick?: () => void
  /** Replaces the built-in Filter button (the Phase 6 popover/sheet trigger). */
  filterControl?: ReactNode
  /** Current sort mode. */
  sort: GallerySort
  onSortChange: (value: GallerySort) => void
  className?: string
}

export function CollectionToolbar({
  search,
  onSearchChange,
  filterActive = false,
  onFilterClick,
  filterControl,
  sort,
  onSortChange,
  className,
}: CollectionToolbarProps) {
  return (
    <div
      data-testid="collection-toolbar"
      className={cn(
        "flex flex-wrap items-center gap-3",
        className
      )}
    >
      <input
        type="search"
        data-testid="collection-search"
        value={search}
        onChange={(event) => {
          onSearchChange(event.target.value)
        }}
        placeholder={COLLECTION_SEARCH_PLACEHOLDER}
        aria-label={COLLECTION_SEARCH_PLACEHOLDER}
        className="h-10 w-full max-w-[440px] shrink-0 rounded-sm border border-border bg-surface px-3 text-[12px] leading-[1.4] font-medium text-ink outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-[440px]"
      />

      {filterControl ?? (
        <button
          type="button"
          data-testid="collection-filter"
          data-filter-active={filterActive}
          onClick={onFilterClick}
          className="flex h-10 w-[86px] shrink-0 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface text-[11px] leading-[1.4] font-medium text-ink outline-none transition-colors hover:bg-surface-warm focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ListFilter className="size-3.5" aria-hidden="true" />
          {FILTER_LABEL}
          {filterActive ? (
            <span
              aria-hidden="true"
              data-testid="collection-filter-dot"
              className="size-1.5 rounded-full bg-accent"
            />
          ) : null}
        </button>
      )}

      <label className="flex h-10 w-[150px] shrink-0 items-center rounded-sm border border-border bg-surface px-2">
        <span className="sr-only">Sort</span>
        <select
          data-testid="collection-sort"
          value={sort}
          onChange={(event) => {
            onSortChange(event.target.value as GallerySort)
          }}
          className="h-full w-full appearance-none bg-transparent text-[11px] leading-[1.4] font-medium text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
