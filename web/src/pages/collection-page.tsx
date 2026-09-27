import { Images } from "lucide-react"
import { useCallback, useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  CollectionEmptyState,
  CollectionFilterEmptyState,
  CollectionToolbar,
  GalleryErrorState,
  GalleryMasonry,
  MasonrySkeleton,
  PostCard,
} from "@/components/gallery"
import { usePosts } from "@/hooks"
import { DEFAULT_SORT } from "@/lib/collection-sort"
import { formatCollectionCounts } from "@/lib/collection-meta"
import { BACK_TO_COLLECTIONS_LABEL } from "@/lib/messages"
import { pickPlaceholderGradient } from "@/lib/placeholder"
import { selectPostsViewState } from "@/lib/posts-state"
import type { GallerySort } from "@/types"

/**
 * Collection route `/collections/:filename` (design spec §3.3, frame `6:121`).
 *
 * Header: `← Collections` back link, a `96×96` `r24` gradient icon seeded
 * deterministically from the filename, the title Playfair Bold 38 and the meta
 * `186 posts ◫ 220 media` at x=184. The mockup's description line (y=198) is
 * omitted (spec §7 — the CSV has no description field) and so are the
 * media-type (y=350) and topic (y=394) pills.
 *
 * Then one toolbar (search / Filter / Sort) and exactly one content state:
 *   loading          → `MasonrySkeleton` (never a blank page, PRD-2 §35)
 *   error            → `GalleryErrorState` with the PRD-2 §61 copy + Retry
 *   empty collection → `This collection is empty` (PRD-2 §60)
 *   empty filters    → `No posts match your filters` + `Clear filters` (§60)
 *   posts            → `GalleryMasonry` of `PostCard`s
 *
 * **Phase 6 seam, documented:** the toolbar is wired to local controlled state
 * (`searchText`, `sort`) that renders the typed value and the selected mode but
 * does **not** alter the request — no debouncing, no date logic, no URL sync and
 * no filtering is faked. The *applied* query is a separate piece of state that
 * can never become non-default in Phase 5, so the filter-no-match branch is
 * unreachable from the UI while still being rendered, unit-tested and ready;
 * Phase 6 supplies the real handlers and makes `Clear filters` reset the query.
 */
export function CollectionPage() {
  const { filename } = useParams<{ filename: string }>()
  const {
    posts,
    status,
    errorMessage,
    collection,
    refetch,
  } = usePosts(filename)

  // --- Phase 6 seam: draft toolbar state (does not change the request) ------
  const [searchText, setSearchText] = useState("")
  const [sort, setSort] = useState<GallerySort>(DEFAULT_SORT)
  // The *applied* query is what makes "zero results because of filters" honest.
  // Phase 5 never sets it, so an empty collection keeps its own copy; Phase 6
  // replaces this with the debounced/URL-synced value and the branch lights up.
  const [appliedQuery] = useState("")
  const filtersActive = appliedQuery.trim() !== ""

  const handleFilterClick = useCallback(() => {
    // Phase 6 attaches the FilterPopover / FilterSheet here.
  }, [])

  const handleClearFilters = useCallback(() => {
    // Phase 5 resets the draft controls it owns; Phase 6 also resets the
    // applied query and the URL.
    setSearchText("")
  }, [])

  const viewState = selectPostsViewState(status, posts.length, filtersActive)
  const displayName =
    collection !== undefined && collection.name.trim() !== ""
      ? collection.name
      : (filename ?? "Collection")
  const icon = pickPlaceholderGradient(filename ?? "collection")

  return (
    <div className="flex flex-col pb-10">
      <Link
        to="/"
        className="w-fit text-[11px] leading-[1.4] font-medium text-muted outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {BACK_TO_COLLECTIONS_LABEL}
      </Link>

      <header className="mt-4 flex items-start gap-6">
        <span
          aria-hidden="true"
          data-testid="collection-icon"
          style={{ backgroundImage: icon.value }}
          className="flex size-24 shrink-0 items-center justify-center rounded-2xl text-white/80"
        >
          <Images className="size-9" />
        </span>
        <div className="flex h-24 min-w-0 flex-col justify-between py-0.5">
          <h1
            id="collection-heading"
            className="text-[28px] leading-[1.1] font-bold break-words text-ink md:text-[38px]"
          >
            {displayName}
          </h1>
          {collection === undefined ? null : (
            <p
              data-testid="collection-counts"
              className="text-[11px] leading-[1.4] font-medium text-muted"
            >
              {formatCollectionCounts(collection)}
            </p>
          )}
        </div>
      </header>

      <CollectionToolbar
        className="mt-[52px]"
        search={searchText}
        onSearchChange={setSearchText}
        filterActive={filtersActive}
        onFilterClick={handleFilterClick}
        sort={sort}
        onSortChange={setSort}
      />

      <div className="mt-6" data-testid="collection-content" data-view-state={viewState}>
        {viewState === "loading" ? <MasonrySkeleton label="Loading posts" /> : null}

        {viewState === "error" ? (
          <GalleryErrorState message={errorMessage} onRetry={refetch} />
        ) : null}

        {viewState === "empty-collection" ? <CollectionEmptyState /> : null}

        {viewState === "empty-filters" ? (
          <CollectionFilterEmptyState onClearFilters={handleClearFilters} />
        ) : null}

        {viewState === "posts" ? (
          <GalleryMasonry>
            {posts.map((post) => (
              <PostCard key={post.tweet_id} post={post} />
            ))}
          </GalleryMasonry>
        ) : null}
      </div>
    </div>
  )
}
