import { useCallback, useEffect, useRef, useState } from "react"

import { fetchCollections, fetchPosts } from "@/lib/api"
import { DEFAULT_SORT } from "@/lib/collection-sort"
import { describeGalleryError } from "@/lib/error-message"
import { COULD_NOT_LOAD_COLLECTION_MESSAGE } from "@/lib/messages"
import {
  clampPageLimit,
  mergeUniquePosts,
  resolveNextPage,
} from "@/lib/pagination"
import type { PostsStatus } from "@/lib/posts-state"
import type { GalleryCollection, GalleryPost, GallerySort } from "@/types"

/**
 * Collection posts hook — first page plus cursor paging (PRD-2 §34/§40/§44).
 *
 * - One page-1 `GET /api/gallery/collections/{filename}/posts?limit=30&sort=…`
 *   on mount and per `refetch()`; {@link UsePostsResult.loadMore} appends the
 *   next page with the **opaque** `next_cursor` echoed back verbatim.
 * - Pages accumulate in {@link UsePostsResult.posts}; an overlapping `tweet_id`
 *   is dropped by `mergeUniquePosts`, keeping the first-seen instance and
 *   position (PRD-2 §44's defensive dedupe).
 * - Paging stops when `has_more` is false and when `has_more` is true with no
 *   usable cursor (`resolveNextPage`); the same cursor is never requested twice
 *   in a row, and a second `loadMore` while one is in flight is a no-op — a
 *   sentinel can fire repeatedly without issuing duplicate requests.
 * - One `GET /api/gallery/collections` alongside the first page purely to join
 *   the header counts (the posts response carries no totals). **No new endpoint**
 *   is added. A summary-only failure leaves the posts intact.
 * - State is **keyed by the request signature**: the moment a search/filter/sort
 *   change alters the query, the hook returns `loading` with no posts and a null
 *   cursor (PRD-2 §77's "clear current pages, reset cursor") while a same-query
 *   refetch (focus, Retry) keeps the current posts on screen. A monotonic request
 *   *generation* additionally discards an in-flight page that a query change or
 *   refetch has superseded, so a stale page can never be appended to the new list.
 * - `window` `focus` refetches page 1 (PRD-2 §47/§78). Nothing polls: no timer
 *   is ever scheduled by this hook to drive a request.
 *
 * `options` is intentionally a set of primitive fields rather than a params
 * object: an object literal rebuilt on every render would either churn the
 * effect or force an eslint suppression.
 */

/** First-page size; PRD-2 §34's API default. */
export const POSTS_PAGE_LIMIT = 30

export interface UsePostsOptions {
  limit?: number
  sort?: GallerySort
  q?: string
  tweet_from?: string
  tweet_to?: string
  saved_from?: string
  saved_to?: string
}

export interface UsePostsResult {
  /** Every loaded page, in order, deduped by `tweet_id`. */
  posts: GalleryPost[]
  status: PostsStatus
  /** The raw failure, for logging/debugging; may be a non-`ApiError`. */
  error: unknown
  /** Exact user-facing copy for the error state (PRD-2 §61). */
  errorMessage: string
  /** The matching collection summary, when the list request succeeded. */
  collection: GalleryCollection | undefined
  /** Opaque cursor for the next page (Phase 7); `null` at the end. */
  nextCursor: string | null
  hasMore: boolean
  /** True while an additional page (never the first) is in flight. */
  isLoadingMore: boolean
  /** Append the next page. No-op at the end, while in flight, or after reset. */
  loadMore: () => void
  /** Re-run the first-page request and reset paging (focus, Retry). */
  refetch: () => void
}

interface PostsState {
  /** The request signature this state belongs to. */
  key: string
  posts: GalleryPost[]
  status: PostsStatus
  error: unknown
  nextCursor: string | null
  hasMore: boolean
  loadingMore: boolean
}

const EMPTY_POSTS_STATE = {
  posts: [] as GalleryPost[],
  status: "loading" as PostsStatus,
  error: null,
  nextCursor: null,
  hasMore: false,
  loadingMore: false,
}

export function usePosts(
  filename: string | undefined,
  options: UsePostsOptions = {}
): UsePostsResult {
  const {
    limit = POSTS_PAGE_LIMIT,
    sort = DEFAULT_SORT,
    q,
    tweet_from,
    tweet_to,
    saved_from,
    saved_to,
  } = options

  // PRD-2 §34: never ask the backend for more than its maximum page size.
  const effectiveLimit = clampPageLimit(limit)

  // The signature of the query this render wants. A change to any part of it
  // means the view's pages and cursor no longer belong to the current query.
  const requestKey = [
    filename ?? "",
    effectiveLimit,
    sort,
    q ?? "",
    tweet_from ?? "",
    tweet_to ?? "",
    saved_from ?? "",
    saved_to ?? "",
  ].join("\u0000")

  const [requestId, setRequestId] = useState(0)
  const [state, setState] = useState<PostsState>(() => ({
    ...EMPTY_POSTS_STATE,
    key: requestKey,
  }))
  const [collection, setCollection] = useState<GalleryCollection | undefined>(
    undefined
  )

  const hasFilename = filename !== undefined && filename !== ""

  // Mirrors the committed state so `loadMore` can read the current cursor
  // without re-creating itself on every page.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Bumped at the start of every page-1 request. A `loadMore` response whose
  // generation is stale (query changed, focus/Retry refetched) is discarded.
  const generationRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const lastRequestedCursorRef = useRef<string | null>(null)

  const refetch = useCallback(() => {
    setRequestId((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!hasFilename) {
      // No filename means no collection to load. This is derived into the
      // returned state below rather than set from the effect body.
      return
    }

    // A new page-1 request supersedes any in-flight page request and resets the
    // paging bookkeeping atomically with the query key.
    generationRef.current += 1
    const generation = generationRef.current
    loadingMoreRef.current = false
    lastRequestedCursorRef.current = null

    let cancelled = false

    fetchPosts(filename, {
      limit: effectiveLimit,
      sort,
      q,
      tweet_from,
      tweet_to,
      saved_from,
      saved_to,
    }).then(
      (response) => {
        if (cancelled || generationRef.current !== generation) {
          return
        }
        const { nextCursor, hasMore } = resolveNextPage(response)
        setState({
          key: requestKey,
          posts: response.items,
          status: "success",
          error: null,
          nextCursor,
          hasMore,
          loadingMore: false,
        })
      },
      (error: unknown) => {
        if (cancelled || generationRef.current !== generation) {
          return
        }
        setState({
          key: requestKey,
          posts: [],
          status: "error",
          error,
          nextCursor: null,
          hasMore: false,
          loadingMore: false,
        })
      }
    )

    fetchCollections().then(
      (collections) => {
        if (cancelled) {
          return
        }
        setCollection(
          collections.find((entry) => entry.filename === filename) ?? undefined
        )
      },
      () => {
        if (cancelled) {
          return
        }
        // The header counts are secondary: keep whatever we had rather than
        // blanking the page for a summary-only failure.
      }
    )

    return () => {
      cancelled = true
    }
  }, [
    hasFilename,
    filename,
    requestId,
    requestKey,
    effectiveLimit,
    sort,
    q,
    tweet_from,
    tweet_to,
    saved_from,
    saved_to,
  ])

  const loadMore = useCallback(() => {
    const current = stateRef.current

    // The page-1 data for the current query must be committed before paging.
    if (!hasFilename || current.key !== requestKey) {
      return
    }
    // Stop at the end and on the defensive `has_more: true` + null-cursor case.
    if (!current.hasMore || current.nextCursor === null) {
      return
    }
    // One page request at a time: a repeatedly-firing sentinel is coalesced.
    if (loadingMoreRef.current) {
      return
    }
    // Never request the same cursor twice in a row.
    if (lastRequestedCursorRef.current === current.nextCursor) {
      return
    }

    const cursor = current.nextCursor
    const generation = generationRef.current
    loadingMoreRef.current = true
    lastRequestedCursorRef.current = cursor
    setState((prev) =>
      prev.key === requestKey ? { ...prev, loadingMore: true } : prev
    )

    fetchPosts(filename, {
      limit: effectiveLimit,
      sort,
      q,
      tweet_from,
      tweet_to,
      saved_from,
      saved_to,
      cursor,
    }).then(
      (response) => {
        loadingMoreRef.current = false
        if (generationRef.current !== generation) {
          return
        }
        const { nextCursor, hasMore } = resolveNextPage(response)
        setState((prev) => {
          if (prev.key !== requestKey) {
            return prev
          }
          return {
            ...prev,
            posts: mergeUniquePosts(prev.posts, response.items),
            status: "success",
            error: null,
            nextCursor,
            hasMore,
            loadingMore: false,
          }
        })
      },
      () => {
        // A page failure is non-fatal: the loaded cards stay, the loader clears,
        // and the next sentinel intersection can retry the same cursor.
        loadingMoreRef.current = false
        if (generationRef.current !== generation) {
          return
        }
        setState((prev) =>
          prev.key === requestKey ? { ...prev, loadingMore: false } : prev
        )
      }
    )
  }, [
    hasFilename,
    filename,
    requestKey,
    effectiveLimit,
    sort,
    q,
    tweet_from,
    tweet_to,
    saved_from,
    saved_to,
  ])

  useEffect(() => {
    const onFocus = () => {
      refetch()
    }

    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
    }
  }, [refetch])

  if (!hasFilename) {
    return {
      posts: [],
      status: "error",
      error: null,
      errorMessage: COULD_NOT_LOAD_COLLECTION_MESSAGE,
      collection: undefined,
      nextCursor: null,
      hasMore: false,
      isLoadingMore: false,
      loadMore,
      refetch,
    }
  }

  // A query change makes the held pages/cursor belong to a superseded request,
  // so the view immediately reverts to `loading` with no posts and no cursor
  // (PRD-2 §77). A same-query refetch keeps them until the new page resolves.
  const isCurrent = state.key === requestKey

  return {
    posts: isCurrent ? state.posts : [],
    status: isCurrent ? state.status : "loading",
    error: isCurrent ? state.error : null,
    errorMessage:
      isCurrent && state.status === "error"
        ? describeGalleryError(state.error)
        : "",
    collection,
    nextCursor: isCurrent ? state.nextCursor : null,
    hasMore: isCurrent ? state.hasMore : false,
    isLoadingMore: isCurrent ? state.loadingMore : false,
    loadMore,
    refetch,
  }
}
