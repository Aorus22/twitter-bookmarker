import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { usePosts } from "./use-posts"
import {
  jsonResponse,
  makeCollection,
  makePost,
  pbsUrl,
  stubGalleryFetch,
} from "@/test/fixtures"

/**
 * COLL-01/COLL-10 data seam: one first-page request (default sort + limit), the
 * header summary joined from the collections list, cursor fields held in state
 * for Phase 7, and the PRD-2 §47/§78 focus refetch. Every fetch is mocked.
 */

const LINUX = makeCollection({
  filename: "linux.csv",
  name: "Linux",
  post_count: 186,
  media_count: 220,
})

const POSTS = [
  makePost({ tweet_id: "1", media: [pbsUrl("a")] }),
  makePost({ tweet_id: "2", text: "Text only.", media: [] }),
]

describe("usePosts — first page (PRD-2 §40)", () => {
  it("requests limit=30&sort=saved_desc for the URL-encoded filename", async () => {
    const fetchMock = stubGalleryFetch({
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: "abc", has_more: true }),
      collections: () => jsonResponse({ collections: [LINUX] }),
    })

    const { result } = renderHook(() => usePosts("linux.csv"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    const postUrl = String(fetchMock.mock.calls[0][0])
    expect(postUrl).toBe(
      "/api/gallery/collections/linux.csv/posts?limit=30&sort=saved_desc"
    )
    expect(result.current.posts).toHaveLength(2)
    expect(result.current.posts[0].tweet_id).toBe("1")
  })

  it("keeps the cursor and has_more in state so Phase 7 can page without a rewrite", async () => {
    stubGalleryFetch({
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: "next-page", has_more: true }),
    })

    const { result } = renderHook(() => usePosts("linux.csv"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    expect(result.current.nextCursor).toBe("next-page")
    expect(result.current.hasMore).toBe(true)
    expect(typeof result.current.refetch).toBe("function")
  })

  it("joins the header summary from the existing collections endpoint", async () => {
    stubGalleryFetch({
      posts: () => jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
      collections: () =>
        jsonResponse({ collections: [makeCollection({ filename: "other.csv" }), LINUX] }),
    })

    const { result } = renderHook(() => usePosts("linux.csv"))

    await waitFor(() => {
      expect(result.current.collection).toBeDefined()
    })

    expect(result.current.collection?.name).toBe("Linux")
    expect(result.current.collection?.post_count).toBe(186)
  })

  it("URL-encodes a filename with spaces", async () => {
    const fetchMock = stubGalleryFetch()

    renderHook(() => usePosts("my folder.csv"))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/collections/my%20folder.csv/posts"
    )
  })

  it("passes Phase 6 filter options through when supplied", async () => {
    const fetchMock = stubGalleryFetch()

    renderHook(() =>
      usePosts("linux.csv", { q: "wayland", sort: "tweet_asc" })
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("sort=tweet_asc")
    expect(url).toContain("q=wayland")
  })
})

describe("usePosts — failure handling (PRD-2 §61)", () => {
  it("shows the collection-load copy for a 404 and keeps it retryable", async () => {
    stubGalleryFetch({
      posts: () => jsonResponse({ status: "error", reason: "not found" }, 404),
    })

    const { result } = renderHook(() => usePosts("missing.csv"))

    await waitFor(() => {
      expect(result.current.status).toBe("error")
    })

    expect(result.current.errorMessage).toBe("Could not load this collection")
    expect(result.current.posts).toEqual([])
  })

  it("shows the backend connection copy for a transport failure", async () => {
    stubGalleryFetch({
      posts: () => Promise.reject(new TypeError("Failed to fetch")),
    })

    const { result } = renderHook(() => usePosts("linux.csv"))

    await waitFor(() => {
      expect(result.current.status).toBe("error")
    })

    expect(result.current.errorMessage).toBe(
      "Could not connect to Twitter Bookmarker backend"
    )
  })

  it("keeps the posts when only the header summary fails", async () => {
    stubGalleryFetch({
      posts: () => jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
      collections: () => jsonResponse({ status: "error", reason: "boom" }, 500),
    })

    const { result } = renderHook(() => usePosts("linux.csv"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    expect(result.current.posts).toHaveLength(2)
    expect(result.current.collection).toBeUndefined()
  })

  it("errors on a missing filename without calling the API", async () => {
    const fetchMock = stubGalleryFetch()

    const { result } = renderHook(() => usePosts(undefined))

    await waitFor(() => {
      expect(result.current.status).toBe("error")
    })

    expect(result.current.errorMessage).toBe("Could not load this collection")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("usePosts — refresh (PRD-2 §47/§78)", () => {
  it("refetches the first page when the window regains focus", async () => {
    const fetchMock = stubGalleryFetch({
      posts: () => jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
    })

    const { result } = renderHook(() => usePosts("linux.csv"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })
    const before = fetchMock.mock.calls.length

    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
    })
  })
})
