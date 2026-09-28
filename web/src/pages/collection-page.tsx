import { Images } from "lucide-react"
import { useEffect, useRef } from "react"
import { Link, useParams } from "react-router-dom"

import {
  CollectionEmptyState,
  CollectionFilterEmptyState,
  CollectionToolbar,
  FilterControl,
  GalleryBottomLoader,
  GalleryErrorState,
  GalleryMasonry,
  InfiniteSentinel,
  MasonrySkeleton,
  MediaLightbox,
  PostCard,
} from "@/components/gallery"
import { useGalleryQuery, useMasonryColumns, useMediaLightbox, usePosts } from "@/hooks"
import { formatCollectionCounts } from "@/lib/collection-meta"
import { masonryContainerWidth } from "@/lib/masonry"
import {
  BACK_TO_COLLECTIONS_LABEL,
  LOADING_POSTS_LABEL,
} from "@/lib/messages"
import { pickPlaceholderGradient } from "@/lib/placeholder"
import { selectPostsViewState } from "@/lib/posts-state"
import { scrollNearTop } from "@/lib/scroll"

/**
 * Collection route `/collections/:filename` (design spec §3.3, frame `6:121`).
 *
 * Header: `← Collections` back link, a `96×96` `r24` gradient icon seeded
 * deterministically from the filename, the title Playfair Bold 38 and the meta
 * `186 posts ◫ 220 media` at x=184. The mockup's description line (y=198) is
 * omitted (spec §7 — the CSV has no description field) and so are the
 * media-type (y=350) and topic (y=394) pills.
 *
 * Column: the hero, the toolbar and the masonry share one content column that
 * is capped to `masonryContainerWidth(count)` and centred in the shell's rail
 * (see the note on `columnProbeRef` below). That keeps the page gutters even —
 * the exact-fit cap is what stops the cards leaving a hole on the right at the
 * widths between two column thresholds.
 *
 * Discovery (Phase 6): `useGalleryQuery` owns search/filter/sort in the URL and
 * derives the exact request params, `usePosts` resets pages/cursor the moment
 * the query key changes, and a query-change effect scrolls near the top
 * (PRD-2 §76/§77).
 *
 * Paging (Phase 7): `usePosts` accumulates pages of 30 and exposes
 * `loadMore`/`hasMore`/`isLoadingMore`. An `InfiniteSentinel` after the masonry
 * requests the next page ~600px before the bottom; the already-loaded cards stay
 * mounted while a page loads and only the small `GalleryBottomLoader` appears
 * below them (never a full-page skeleton). `loadMore` never scrolls.
 *
 * Exactly one content state renders:
 *   loading          → `MasonrySkeleton` (never a blank page, PRD-2 §35)
 *   error            → `GalleryErrorState` with the PRD-2 §61 copy + Retry
 *   empty collection → `This collection is empty` (PRD-2 §60)
 *   empty filters    → `No posts match your filters` + a working `Clear filters`
 *   posts            → `GalleryMasonry` of `PostCard`s, the bottom loader while
 *                      a page is in flight, and the sentinel
 *
 * Lightbox (Phase 8, LIGHT-01…LIGHT-06): media tiles are focusable triggers
 * whose click hands `(postIndex, mediaIndex)` to `useMediaLightbox`, which holds
 * the position in the flattened media sequence of the **accumulated** `posts`
 * array. Navigation therefore walks within a tweet and on into the next loaded
 * tweet, and is bounded by what is loaded (no fetch is triggered by the
 * lightbox). One `MediaLightbox` renders the active post beside its media.
 */
export function CollectionPage() {
  const { filename } = useParams<{ filename: string }>()
  const {
    query,
    search,
    setSearch,
    setSort,
    applyFilters,
    clearFilters,
    filterActive,
    hasActiveQuery,
    queryKey,
    requestParams,
  } = useGalleryQuery()

  const {
    posts,
    status,
    errorMessage,
    collection,
    hasMore,
    isLoadingMore,
    loadMore,
    refetch,
  } = usePosts(filename, requestParams)

  // The lightbox is driven entirely by the accumulated loaded list: its
  // flattened media sequence is derived from `posts`, so it can never request a
  // page of its own (LIGHT-03).
  const lightbox = useMediaLightbox(posts)

  // PRD-2 §21 / design spec §3.3: the hero, the toolbar and the masonry share
  // one content column, capped to exactly what the current column count needs
  // and centred inside the shell's rail.
  //
  // The cap is what keeps the page gutters honest. `masonryContainerWidth` is
  // the exact-fit width of `count` cards, so without it a 3-column grid leaves
  // 292px of dead space on the right at a 1360px window (the cards are 940, the
  // rail is 1232); capping the column to the grid's own width makes the cards
  // fill it edge to edge, so the space left over is split evenly instead of
  // piling up on one side.
  //
  // The probe measured here is the **uncapped** outer wrapper, and that is
  // load-bearing: a capped element measured against its own cap can never grow.
  // Widen the window and the column would stay at its old width, no resize would
  // fire, and the extra columns would never appear until a reload — the same
  // deadlock `GalleryMasonry` documents for its own list.
  const columnProbeRef = useRef<HTMLDivElement>(null)
  const columnCount = useMasonryColumns(columnProbeRef)

  // PRD-2 §77: on any search/filter/sort change the loaded pages and cursor are
  // already reset by `usePosts`' request key; this adds the "scroll near the
  // top" half. Mount is skipped — the page starts at the top anyway.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    scrollNearTop()
  }, [queryKey])

  // `filtersActive` here means "the query narrows the result set" (search *or*
  // dates), which is what makes a zero-result view the filter-no-match state
  // rather than an empty collection (COLL-10).
  const viewState = selectPostsViewState(status, posts.length, hasActiveQuery)
  const displayName =
    collection !== undefined && collection.name.trim() !== ""
      ? collection.name
      : (filename ?? "Collection")
  const icon = pickPlaceholderGradient(filename ?? "collection")

  return (
    <div ref={columnProbeRef} className="w-full">
      <div
        data-testid="collection-column"
        className="mx-auto flex w-full flex-col pb-10"
        style={{ maxWidth: `${masonryContainerWidth(columnCount)}px` }}
      >
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
                className="text-base leading-[1.4] font-medium text-muted"
              >
                {formatCollectionCounts(collection)}
              </p>
            )}
          </div>
        </header>

        <CollectionToolbar
          className="mt-[52px]"
          search={search}
          onSearchChange={setSearch}
          filterActive={filterActive}
          filterControl={
            <FilterControl
              active={filterActive}
              query={query}
              onApply={applyFilters}
            />
          }
          sort={query.sort}
          onSortChange={setSort}
        />

        <div
          className="mt-6"
          data-testid="collection-content"
          data-view-state={viewState}
        >
          {viewState === "loading" ? (
            <MasonrySkeleton label={LOADING_POSTS_LABEL} />
          ) : null}

          {viewState === "error" ? (
            <GalleryErrorState message={errorMessage} onRetry={refetch} />
          ) : null}

          {viewState === "empty-collection" ? <CollectionEmptyState /> : null}

          {viewState === "empty-filters" ? (
            <CollectionFilterEmptyState onClearFilters={clearFilters} />
          ) : null}

          {viewState === "posts" ? (
            <>
              <GalleryMasonry columns={columnCount}>
                {posts.map((post, postIndex) => (
                  <PostCard
                    key={post.tweet_id}
                    post={post}
                    onOpenMedia={(mediaIndex, trigger) => {
                      lightbox.open(postIndex, mediaIndex, trigger)
                    }}
                  />
                ))}
              </GalleryMasonry>
              {/* A page load never hides the cards above: only this compact row
                  appears (PRD-2 §35). */}
              {isLoadingMore ? <GalleryBottomLoader /> : null}
              {/* Decorative scroll trigger; disconnects once `has_more` is false. */}
              <InfiniteSentinel onIntersect={loadMore} disabled={!hasMore} />
            </>
          ) : null}
        </div>

        {/* Rendered from the page so it survives the masonry's re-renders, and
            closed (unmounted) whenever no media slot is active. */}
        <MediaLightbox
          posts={posts}
          index={lightbox.index}
          collectionName={displayName}
          onPrevMedia={lightbox.goPrevMedia}
          onNextMedia={lightbox.goNextMedia}
          onPrevPost={lightbox.goPrevPost}
          onNextPost={lightbox.goNextPost}
          onClose={lightbox.close}
        />
      </div>
    </div>
  )
}
