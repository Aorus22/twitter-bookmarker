import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
  slug: "linux",
  name: "Linux",
  post_count: 186,
  media_count: 220,
})

const POSTS = [
  makePost({ tweet_id: "1", media: [pbsUrl("a")] }),
  makePost({ tweet_id: "2", text: "Text only.", media: [] }),
]

describe("usePosts — first page (PRD-2 §40)", () => {
  it("requests limit=30&sort=saved_desc for the URL-encoded slug", async () => {
    const fetchMock = stubGalleryFetch({
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: "abc", has_more: true }),
      collections: () => jsonResponse({ collections: [LINUX] }),
    })

    const { result } = renderHook(() => usePosts("linux"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    const postUrl = String(fetchMock.mock.calls[0][0])
    expect(postUrl).toBe(
      "/api/gallery/collections/linux/posts?limit=30&sort=saved_desc"
    )
    expect(result.current.posts).toHaveLength(2)
    expect(result.current.posts[0].tweet_id).toBe("1")
  })

  it("keeps the cursor and has_more in state so Phase 7 can page without a rewrite", async () => {
    stubGalleryFetch({
      posts: () =>
        jsonResponse({
          items: POSTS,
          next_cursor: "next-page",
          has_more: true,
        }),
    })

    const { result } = renderHook(() => usePosts("linux"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    expect(result.current.nextCursor).toBe("next-page")
    expect(result.current.hasMore).toBe(true)
    expect(typeof result.current.refetch).toBe("function")
  })

  it("joins the header summary from the existing collections endpoint", async () => {
    stubGalleryFetch({
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
      collections: () =>
        jsonResponse({
          collections: [makeCollection({ slug: "other" }), LINUX],
        }),
    })

    const { result } = renderHook(() => usePosts("linux"))

    await waitFor(() => {
      expect(result.current.collection).toBeDefined()
    })

    expect(result.current.collection?.name).toBe("Linux")
    expect(result.current.collection?.post_count).toBe(186)
  })

  it("URL-encodes a slug with spaces", async () => {
    const fetchMock = stubGalleryFetch()

    renderHook(() => usePosts("my folder"))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/collections/my%20folder/posts"
    )
  })

  it("passes Phase 6 filter options through when supplied", async () => {
    const fetchMock = stubGalleryFetch()

    renderHook(() => usePosts("linux", { q: "wayland", sort: "tweet_asc" }))

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

    const { result } = renderHook(() => usePosts("missing"))

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

    const { result } = renderHook(() => usePosts("linux"))

    await waitFor(() => {
      expect(result.current.status).toBe("error")
    })

    expect(result.current.errorMessage).toBe(
      "Could not connect to Twitter Bookmarker backend"
    )
  })

  it("keeps the posts when only the header summary fails", async () => {
    stubGalleryFetch({
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
      collections: () => jsonResponse({ status: "error", reason: "boom" }, 500),
    })

    const { result } = renderHook(() => usePosts("linux"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    expect(result.current.posts).toHaveLength(2)
    expect(result.current.collection).toBeUndefined()
  })

  it("errors on a missing slug without calling the API", async () => {
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
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
    })

    const { result } = renderHook(() => usePosts("linux"))

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

describe("usePosts — a query change resets the pages (PRD-2 §77, DISC-08)", () => {
  it("shows loading with no posts and no cursor the moment the query changes", async () => {
    stubGalleryFetch({
      posts: () =>
        jsonResponse({ items: POSTS, next_cursor: "abc", has_more: true }),
    })

    const { result, rerender } = renderHook(
      ({ q }: { q: string | undefined }) => usePosts("linux", { q }),
      { initialProps: { q: undefined as string | undefined } }
    )

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })
    expect(result.current.nextCursor).toBe("abc")

    rerender({ q: "wayland" })

    // Synchronously, before the new response lands: the previously loaded page
    // must never be displayed against the new query.
    expect(result.current.status).toBe("loading")
    expect(result.current.posts).toEqual([])
    expect(result.current.error).toBeNull()
    expect(result.current.nextCursor).toBeNull()
    expect(result.current.hasMore).toBe(false)

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })
  })

  it("ignores a stale response that resolves after a newer one", async () => {
    const pending: Array<(response: Response) => void> = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/posts")) {
        return new Promise<Response>((resolve) => {
          pending.push(resolve)
        })
      }
      return Promise.resolve(jsonResponse({ collections: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => usePosts("linux", { q }),
      { initialProps: { q: "first" } }
    )

    rerender({ q: "second" })
    await waitFor(() => {
      expect(pending).toHaveLength(2)
    })

    // The newer query resolves first…
    await act(async () => {
      pending[1](
        jsonResponse({
          items: [makePost({ tweet_id: "new" })],
          next_cursor: null,
          has_more: false,
        })
      )
    })
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })
    expect(result.current.posts.map((post) => post.tweet_id)).toEqual(["new"])

    // …and the stale one lands afterwards and must be dropped.
    await act(async () => {
      pending[0](
        jsonResponse({
          items: [makePost({ tweet_id: "old" })],
          next_cursor: "stale-cursor",
          has_more: true,
        })
      )
    })

    expect(result.current.posts.map((post) => post.tweet_id)).toEqual(["new"])
    expect(result.current.nextCursor).toBeNull()
    expect(result.current.hasMore).toBe(false)
  })
})

/**
 * SCROLL-01/03/04/05 cursor paging: `loadMore` appends pages in order with the
 * opaque cursor echoed verbatim, dedupes by `tweet_id`, refuses to loop, and
 * resets cleanly on a focus refetch. Every fetch is mocked; nothing polls.
 */

function postsUrls(fetchMock: ReturnType<typeof stubGalleryFetch>) {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/posts"))
}

function cursorOf(url: string): string | null {
  return new URL(url, "http://gallery.test").searchParams.get("cursor")
}

describe("usePosts — cursor paging (SCROLL-01, SCROLL-03, SCROLL-04)", () => {
  it("appends the next page in order and echoes the opaque cursor verbatim", async () => {
    const opaque = "opaque+/=cursor"
    const fetchMock = stubGalleryFetch({
      posts: (url) =>
        cursorOf(url) === null
          ? jsonResponse({
              items: [makePost({ tweet_id: "1" }), makePost({ tweet_id: "2" })],
              next_cursor: opaque,
              has_more: true,
            })
          : jsonResponse({
              items: [makePost({ tweet_id: "3" }), makePost({ tweet_id: "4" })],
              next_cursor: null,
              has_more: false,
            }),
    })

    const { result } = renderHook(() => usePosts("linux"))

    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })
    expect(result.current.hasMore).toBe(true)
    expect(result.current.nextCursor).toBe(opaque)

    act(() => {
      result.current.loadMore()
    })

    await waitFor(() => {
      expect(result.current.posts).toHaveLength(4)
    })
    expect(result.current.posts.map((post) => post.tweet_id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.nextCursor).toBeNull()
    expect(result.current.isLoadingMore).toBe(false)

    const urls = postsUrls(fetchMock)
    expect(urls).toHaveLength(2)
    expect(urls[0]).not.toContain("cursor=")
    expect(urls[1]).toContain("limit=30")
    expect(urls[1]).toContain(`cursor=${encodeURIComponent(opaque)}`)
    expect(urls[1]).not.toContain("limit=100")
  })

  it("keeps the first page size within the API maximum", async () => {
    const fetchMock = stubGalleryFetch()

    renderHook(() => usePosts("linux", { limit: 500 }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=100")
  })

  it("stops requesting once has_more is false", async () => {
    const fetchMock = stubGalleryFetch({
      posts: (url) =>
        cursorOf(url) === null
          ? jsonResponse({
              items: [makePost({ tweet_id: "1" })],
              next_cursor: "c1",
              has_more: true,
            })
          : jsonResponse({
              items: [makePost({ tweet_id: "2" })],
              next_cursor: null,
              has_more: false,
            }),
    })

    const { result } = renderHook(() => usePosts("linux"))
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => {
      expect(result.current.posts).toHaveLength(2)
    })

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })

    expect(postsUrls(fetchMock)).toHaveLength(2)
    expect(result.current.hasMore).toBe(false)
  })

  it("does not loop when has_more is true but next_cursor is null", async () => {
    const fetchMock = stubGalleryFetch({
      posts: () =>
        jsonResponse({
          items: [makePost({ tweet_id: "1" })],
          next_cursor: null,
          has_more: true,
        }),
    })

    const { result } = renderHook(() => usePosts("linux"))
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    expect(result.current.hasMore).toBe(false)
    expect(result.current.nextCursor).toBeNull()

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })

    expect(postsUrls(fetchMock)).toHaveLength(1)
  })

  it("coalesces repeated sentinel firings into exactly one in-flight page request", async () => {
    let resolvePage!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolvePage = resolve
    })
    const fetchMock = stubGalleryFetch({
      posts: (url) =>
        cursorOf(url) === null
          ? jsonResponse({
              items: [makePost({ tweet_id: "1" })],
              next_cursor: "c1",
              has_more: true,
            })
          : pending,
    })

    const { result } = renderHook(() => usePosts("linux"))
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
      result.current.loadMore()
    })

    expect(postsUrls(fetchMock)).toHaveLength(2)
    expect(result.current.isLoadingMore).toBe(true)

    await act(async () => {
      resolvePage(
        jsonResponse({
          items: [makePost({ tweet_id: "2" })],
          next_cursor: null,
          has_more: false,
        })
      )
    })

    await waitFor(() => {
      expect(result.current.posts).toHaveLength(2)
    })
    expect(postsUrls(fetchMock)).toHaveLength(2)
    expect(result.current.isLoadingMore).toBe(false)
  })

  it("does not render an overlapping tweet_id twice and keeps its first position", async () => {
    stubGalleryFetch({
      posts: (url) =>
        cursorOf(url) === null
          ? jsonResponse({
              items: [
                makePost({ tweet_id: "1" }),
                makePost({ tweet_id: "2" }),
                makePost({ tweet_id: "3", text: "first-seen three" }),
              ],
              next_cursor: "c1",
              has_more: true,
            })
          : jsonResponse({
              items: [
                makePost({ tweet_id: "3", text: "drifted duplicate" }),
                makePost({ tweet_id: "4" }),
              ],
              next_cursor: null,
              has_more: false,
            }),
    })

    const { result } = renderHook(() => usePosts("linux"))
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => {
      expect(result.current.posts).toHaveLength(4)
    })

    expect(result.current.posts.map((post) => post.tweet_id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ])
    expect(result.current.posts[2].text).toBe("first-seen three")
  })

  it("never requests the same cursor twice in a row", async () => {
    const fetchMock = stubGalleryFetch({
      posts: (url) =>
        cursorOf(url) === null
          ? jsonResponse({
              items: [makePost({ tweet_id: "1" })],
              next_cursor: "c1",
              has_more: true,
            })
          : jsonResponse({
              // A malformed backend repeats the cursor while claiming more.
              items: [makePost({ tweet_id: "2" })],
              next_cursor: "c1",
              has_more: true,
            }),
    })

    const { result } = renderHook(() => usePosts("linux"))
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => {
      expect(result.current.posts).toHaveLength(2)
    })
    expect(result.current.nextCursor).toBe("c1")

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })

    expect(postsUrls(fetchMock)).toHaveLength(2)
  })

  it("drops an in-flight page when the query changes mid-flight", async () => {
    let resolvePage!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolvePage = resolve
    })
    stubGalleryFetch({
      posts: (url) => {
        const params = new URL(url, "http://gallery.test").searchParams
        if (params.get("cursor") === "c1") {
          return pending
        }
        if (params.get("q") === "wayland") {
          return jsonResponse({
            items: [makePost({ tweet_id: "new" })],
            next_cursor: null,
            has_more: false,
          })
        }
        return jsonResponse({
          items: [makePost({ tweet_id: "1" })],
          next_cursor: "c1",
          has_more: true,
        })
      },
    })

    const { result, rerender } = renderHook(
      ({ q }: { q: string | undefined }) => usePosts("linux", { q }),
      { initialProps: { q: undefined as string | undefined } }
    )
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    act(() => {
      result.current.loadMore()
    })
    rerender({ q: "wayland" })

    await waitFor(() => {
      expect(result.current.posts.map((post) => post.tweet_id)).toEqual(["new"])
    })

    await act(async () => {
      resolvePage(
        jsonResponse({
          items: [makePost({ tweet_id: "2" })],
          next_cursor: null,
          has_more: false,
        })
      )
    })

    expect(result.current.posts.map((post) => post.tweet_id)).toEqual(["new"])
    expect(result.current.hasMore).toBe(false)
  })
})

describe("usePosts — refresh resets paging, nothing polls (SCROLL-05)", () => {
  it("resets to page one on a window focus refetch without duplicating posts", async () => {
    stubGalleryFetch({
      posts: (url) =>
        cursorOf(url) === null
          ? jsonResponse({
              items: [makePost({ tweet_id: "1" }), makePost({ tweet_id: "2" })],
              next_cursor: "c1",
              has_more: true,
            })
          : jsonResponse({
              items: [makePost({ tweet_id: "3" })],
              next_cursor: null,
              has_more: false,
            }),
    })

    const { result } = renderHook(() => usePosts("linux"))
    await waitFor(() => {
      expect(result.current.status).toBe("success")
    })

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => {
      expect(result.current.posts).toHaveLength(3)
    })

    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => {
      expect(result.current.posts).toHaveLength(2)
    })

    const ids = result.current.posts.map((post) => post.tweet_id)
    expect(ids).toEqual(["1", "2"])
    expect(new Set(ids).size).toBe(2)
    expect(result.current.hasMore).toBe(true)
  })

  it("issues no request when wall-clock timers advance", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = stubGalleryFetch({
        posts: () =>
          jsonResponse({
            items: [makePost({ tweet_id: "1" })],
            next_cursor: null,
            has_more: false,
          }),
      })

      const { result } = renderHook(() => usePosts("linux"))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.status).toBe("success")
      expect(postsUrls(fetchMock)).toHaveLength(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000)
      })

      expect(postsUrls(fetchMock)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
