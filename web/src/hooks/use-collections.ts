import { useCallback, useEffect, useState } from "react"

import { fetchCollections, isApiError } from "@/lib/api"
import { orderCollections } from "@/lib/collection-order"
import {
  COULD_NOT_CONNECT_MESSAGE,
  COULD_NOT_LOAD_COLLECTION_MESSAGE,
} from "@/lib/messages"
import type { GalleryCollection } from "@/types"

/**
 * Collections data hook for the homepage (PRD-2 §47, HOME-09).
 *
 * - One `GET /api/gallery/collections` per mount and per `refetch()`.
 * - A `window` `focus` listener refetches when the user comes back from another
 *   window or tab; there is no polling and no interval.
 * - Stale resolutions are dropped via a per-effect `cancelled` flag, so a slow
 *   first request cannot overwrite a newer retry.
 * - The received backend order is preserved (`orderCollections` only moves
 *   timestamp-less collections to the end, PRD-2 §38).
 */

export type CollectionsStatus = "loading" | "success" | "error"

export interface UseCollectionsResult {
  collections: GalleryCollection[]
  status: CollectionsStatus
  /** The raw failure, for logging/debugging; may be a non-`ApiError`. */
  error: unknown
  /** Exact user-facing copy for the error state (PRD-2 §61). */
  errorMessage: string
  /** Re-run the request (the `Retry` action). */
  refetch: () => void
}

interface CollectionsState {
  collections: GalleryCollection[]
  status: CollectionsStatus
  error: unknown
}

const INITIAL_STATE: CollectionsState = {
  collections: [],
  status: "loading",
  error: null,
}

/**
 * Map a failure to the exact PRD-2 §61 copy.
 *
 * A transport failure (status `0`, i.e. the backend is not running) carries the
 * §61 connection message from the API client. Every other gallery API failure
 * renders the §61 gallery-error copy. Anything that is not an `ApiError` at all
 * still renders that same copy rather than leaking an internal message.
 */
function describeError(error: unknown): string {
  if (isApiError(error)) {
    if (error.isNetworkError) {
      return error.reason.trim() !== ""
        ? error.reason
        : COULD_NOT_CONNECT_MESSAGE
    }
    return COULD_NOT_LOAD_COLLECTION_MESSAGE
  }
  return COULD_NOT_LOAD_COLLECTION_MESSAGE
}

export function useCollections(): UseCollectionsResult {
  const [requestId, setRequestId] = useState(0)
  const [state, setState] = useState<CollectionsState>(INITIAL_STATE)

  const refetch = useCallback(() => {
    setRequestId((current) => current + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    fetchCollections().then(
      (collections) => {
        if (cancelled) {
          return
        }
        setState({
          collections: orderCollections(collections),
          status: "success",
          error: null,
        })
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        setState({ collections: [], status: "error", error })
      }
    )

    return () => {
      cancelled = true
    }
  }, [requestId])

  useEffect(() => {
    const onFocus = () => {
      refetch()
    }

    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
    }
  }, [refetch])

  return {
    collections: state.collections,
    status: state.status,
    error: state.error,
    errorMessage: state.status === "error" ? describeError(state.error) : "",
    refetch,
  }
}
