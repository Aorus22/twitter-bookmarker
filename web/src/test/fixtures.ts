import { vi } from "vitest"

import type { GalleryCollection, GalleryPost } from "@/types"

/**
 * Shared fixtures for the gallery suites.
 *
 * Every test mocks `fetch` (there is no network and no server, and the
 * operator-owned backend on its dev port is never contacted), so these helpers
 * build a realistic API surface once instead of in every file. This module is
 * *not* a test file: `vitest.config.ts` only collects `src/**\/*.test.{ts,tsx}`.
 */

/** A stored remote media URL — always the verbatim `pbs.twimg.com` host. */
export function pbsUrl(name: string): string {
  return `https://pbs.twimg.com/media/${name}.jpg`
}

export const POST_NOW = new Date(2026, 3, 3, 12, 0, 0)
export const POST_TWEET_DATE = new Date(2026, 2, 12, 12, 0, 0).toISOString()
export const POST_SAVED_AT = new Date(2026, 3, 3, 12, 0, 0).toISOString()

/** One bookmark row; `media: []` is a text-only post (PRD-2 §22). */
export function makePost(
  overrides: Partial<GalleryPost> & { tweet_id: string }
): GalleryPost {
  const username = overrides.username ?? "tester"
  return {
    url: `https://x.com/${username}/status/${overrides.tweet_id}`,
    media: [],
    author: "Test Author",
    username,
    tweet_date: POST_TWEET_DATE,
    saved_at: POST_SAVED_AT,
    text: "A saved tweet.",
    ...overrides,
  }
}

/** One collection summary row. */
export function makeCollection(
  overrides: Partial<GalleryCollection> & { filename: string }
): GalleryCollection {
  return {
    name: overrides.filename.replace(/\.csv$/, ""),
    post_count: 0,
    media_count: 0,
    last_saved_at: null,
    cover_media: [],
    ...overrides,
  }
}

/** Minimal stand-in for the parts of `Response` the API client reads. */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

export interface GalleryFetchRoutes {
  /** `GET /api/gallery/collections` (header summary). */
  collections?: () => Response | Promise<Response>
  /** `GET /api/gallery/collections/{filename}/posts`. */
  posts?: (url: string) => Response | Promise<Response>
}

/**
 * Install a URL-routing `fetch` mock and return it.
 *
 * The collection page issues two requests (posts + collections), so routing on
 * the URL keeps the assertions about which endpoint was asked for meaningful.
 */
export function stubGalleryFetch(routes: GalleryFetchRoutes = {}) {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes("/posts")) {
      const response = routes.posts?.(url)
      return Promise.resolve(
        response ?? jsonResponse({ items: [], next_cursor: null, has_more: false })
      )
    }

    const response = routes.collections?.()
    return Promise.resolve(response ?? jsonResponse({ collections: [] }))
  })

  vi.stubGlobal("fetch", mock)
  return mock
}
