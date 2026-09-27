import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { GalleryPage } from "./gallery-page"
import type { GalleryCollection } from "@/types"

/**
 * Homepage behaviour suite. Every test mocks `fetch` — there is no network and
 * no server, and the operator-owned backend on its dev port is never touched.
 */

const SAVED_AT = new Date(2026, 8, 27, 12, 0, 0).toISOString()

function collection(
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

const LINUX = collection({
  filename: "linux.csv",
  name: "Linux",
  post_count: 83,
  media_count: 126,
  last_saved_at: SAVED_AT,
  cover_media: [
    "https://example.test/1.jpg",
    "https://example.test/2.jpg",
    "https://example.test/3.jpg",
    "https://example.test/4.jpg",
  ],
})

const DESIGN = collection({
  filename: "design.csv",
  name: "Design",
  post_count: 12,
  media_count: 3,
  last_saved_at: SAVED_AT,
  cover_media: ["https://example.test/only.jpg"],
})

const QUIET = collection({ filename: "quiet.csv", name: "Quiet" })

/** Minimal stand-in for the parts of `Response` the API client reads. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <GalleryPage />
    </MemoryRouter>
  )
}

describe("GalleryPage — populated", () => {
  it("renders the hero, section header, footer and one card per collection", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ collections: [LINUX, DESIGN, QUIET] })
        )
    )

    renderPage()

    expect(
      screen.getByRole("heading", { level: 1, name: /Save\. Organize\./ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Explore gallery" })
    ).toHaveAttribute("href", "#collections-grid")
    expect(screen.getByText("My Collections")).toBeInTheDocument()
    expect(screen.getByText("Recently updated ▾")).toBeInTheDocument()

    expect(await screen.findByText("3 collections")).toBeInTheDocument()

    const cards = screen.getAllByTestId("collection-card")
    expect(cards).toHaveLength(3)
    expect(
      cards.map((card) => within(card).getByRole("heading").textContent)
    ).toEqual(["Linux", "Design", "Quiet"])

    expect(within(cards[0]).getByRole("link").getAttribute("href")).toBe(
      "/collections/linux.csv"
    )
    expect(
      within(cards[0]).getByText("83 posts · 126 media · Last saved Sep 27")
    ).toBeInTheDocument()
    expect(
      within(cards[2]).getByText("0 posts · 0 media · No saves yet")
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        "Local-only · Powered by your CSV archive · No cloud, no algorithmic feed"
      )
    ).toBeInTheDocument()

    // The four-media collection renders the 2x2 collage, the one-media
    // collection a single tile, the empty one the gradient placeholder.
    expect(within(cards[0]).getByTestId("collection-cover")).toHaveAttribute(
      "data-cover-layout",
      "quad"
    )
    expect(within(cards[1]).getByTestId("collection-cover")).toHaveAttribute(
      "data-cover-layout",
      "single"
    )
    expect(
      within(cards[2]).getByTestId("cover-placeholder")
    ).toBeInTheDocument()

    // The hero art is assembled from the newest cover media.
    expect(
      within(screen.getByTestId("hero-art")).getAllByTestId("media-image")
        .length
    ).toBeGreaterThan(0)
  })

  it("keeps timestamp-less collections last without re-sorting the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ collections: [QUIET, LINUX, DESIGN] })
        )
    )

    renderPage()

    await screen.findByText("3 collections")

    const names = screen
      .getAllByTestId("collection-card")
      .map((card) => within(card).getByRole("heading").textContent)

    expect(names).toEqual(["Linux", "Design", "Quiet"])
  })
})

describe("GalleryPage — states", () => {
  it("renders skeleton cards while the request is in flight (PRD-2 §35)", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})))

    renderPage()

    expect(
      screen.getByRole("status", { name: "Loading collections" })
    ).toBeInTheDocument()
    expect(
      screen.getAllByTestId("collection-card-skeleton").length
    ).toBeGreaterThan(0)
  })

  it("renders the empty state copy when there are no CSVs (PRD-2 §59)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ collections: [] }))
    )

    renderPage()

    expect(await screen.findByText("No collections yet")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Saved tweets will appear here after you organize them with the extension."
      )
    ).toBeInTheDocument()
    expect(screen.getByText("0 collections")).toBeInTheDocument()
    expect(screen.queryByTestId("collection-card")).not.toBeInTheDocument()
  })

  it("shows the PRD-2 §61 connection copy on a transport failure and retries", async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ collections: [LINUX] }))
    vi.stubGlobal("fetch", fetchMock)

    renderPage()

    expect(
      await screen.findByText("Could not connect to Twitter Bookmarker backend")
    ).toBeInTheDocument()
    expect(screen.queryByTestId("collection-card")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByTestId("collection-card")).toBeInTheDocument()
    expect(
      screen.queryByText("Could not connect to Twitter Bookmarker backend")
    ).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("falls back to the gallery API copy when the failure is not a transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ status: "error", reason: "" }, 500))
    )

    renderPage()

    expect(
      await screen.findByText("Could not load this collection")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("keeps the card in place when a cover image fails to load (PRD-2 §62)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ collections: [DESIGN] }))
    )

    renderPage()

    const card = await screen.findByTestId("collection-card")
    const cover = within(card).getByTestId("collection-cover")
    expect(cover).toHaveAttribute("data-cover-layout", "single")

    fireEvent.error(within(cover).getByTestId("media-image"))

    expect(within(cover).getByTestId("media-placeholder")).toBeInTheDocument()
    expect(screen.getByTestId("collection-card")).toBeInTheDocument()
    expect(within(card).getByRole("link")).toHaveAttribute(
      "href",
      "/collections/design.csv"
    )
  })

  it("refetches collections when the window regains focus (HOME-09)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ collections: [] }))
    vi.stubGlobal("fetch", fetchMock)

    renderPage()

    await screen.findByText("No collections yet")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
