import { useCallback, useEffect, useState } from "react"

import { fetchCollections, fetchPosts } from "@/lib/api"
import { DEFAULT_SORT } from "@/lib/collection-sort"
import { describeGalleryError } from "@/lib/error-message"
import { COULD_NOT_LOAD_COLLECTION_MESSAGE } from "@/lib/messages"
import type { PostsStatus } from "@/lib/posts-state"
import type { GalleryCollection, GalleryPost, GallerySort } from "@/types"

/**
 * Collection posts hook — first page only (PRD-2 §40, design spec §3.3).
 *
 * - One `GET /api/gallery/collections/{filename}/posts?limit=30&sort=saved_desc`
 *   on mount and per `refetch()`; Phase 5 never consumes the cursor.
 * - One `GET /api/gallery/collections` alongside it purely to join the header
 *   counts (the posts response carries no totals). **No new endpoint** is added.
 *   A summary-only failure leaves the posts intact — the header just falls back
 *   to the filename with no counts — while a posts failure is the page error.
 * - `nextCursor` / `hasMore` are held in state from day one, so Phase 7 adds
 *   `loadMore` (append `items`, advance the cursor) without restructuring.
 * - Stale resolutions are dropped with a per-effect `cancelled` flag, and a
 *   `window` `focus` listener refetches (PRD-2 §47/§78).
 * - State is **keyed by the request signature**: the moment a search/filter/sort
 *   change alters the query, the hook returns `loading` with no posts and a null
 *   cursor (PRD-2 §77's "clear current pages, reset cursor") while a same-query
 *   refetch (focus, Retry) keeps the current posts on screen.
 *
 * `options` is intentionally a set of primitive fields rather than a params
 * object: an object literal rebuilt on every render would either churn the
 * effect or force an eslint suppression.
 */

/** First-page size; PRD-2 §40's API default. */
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
  /** Re-run the first-page request (the `Retry` action). */
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
}

const EMPTY_POSTS_STATE = {
  posts: [] as GalleryPost[],
  status: "loading" as PostsStatus,
  error: null,
  nextCursor: null,
  hasMore: false,
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

  // The signature of the query this render wants. A change to any part of it
  // means the view's pages and cursor no longer belong to the current query.
  const requestKey = [
    filename ?? "",
    limit,
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

  const refetch = useCallback(() => {
    setRequestId((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!hasFilename) {
      // No filename means no collection to load. This is derived into the
      // returned state below rather than set from the effect body.
      return
    }

    let cancelled = false

    fetchPosts(filename, {
      limit,
      sort,
      q,
      tweet_from,
      tweet_to,
      saved_from,
      saved_to,
    }).then(
      (response) => {
        if (cancelled) {
          return
        }
        setState({
          key: requestKey,
          posts: response.items,
          status: "success",
          error: null,
          nextCursor: response.next_cursor,
          hasMore: response.has_more,
        })
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        setState({
          key: requestKey,
          posts: [],
          status: "error",
          error,
          nextCursor: null,
          hasMore: false,
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
    limit,
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
    refetch,
  }
}
