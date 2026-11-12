import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CollectionPage } from "./collection-page"
import {
  jsonResponse,
  makeCollection,
  makePost,
  pbsUrl,
  stubGalleryFetch,
} from "@/test/fixtures"

/**
 * Owner request (Nov 2026): the collection page has three layouts — masonry,
 * grid and rows — the choice persists, and a single measured column fills the
 * available width instead of being capped to the 292px card measure.
 */

const LINUX = makeCollection({
  slug: "linux",
  name: "Linux",
  post_count: 3,
  media_count: 5,
  last_saved_at: null,
})

const POSTS = [
  makePost({
    tweet_id: "1",
    author: "One Media",
    username: "@one",
    media: [pbsUrl("a")],
    text: "One image.",
  }),
  makePost({
    tweet_id: "2",
    author: "Text Only",
    username: "@texty",
    media: [],
    text: "Interesting thread about Linux.",
  }),
]

function renderPage(slug = "linux") {
  return render(
    <MemoryRouter initialEntries={[`/collections/${encodeURIComponent(slug)}`]}>
      <Routes>
        <Route path="/collections/:slug" element={<CollectionPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function stubPosts() {
  stubGalleryFetch({
    posts: () =>
      jsonResponse({ items: POSTS, next_cursor: null, has_more: false }),
    collections: () => jsonResponse({ collections: [LINUX] }),
  })
}

const ORIGINAL_INNER_WIDTH = window.innerWidth

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  Object.defineProperty(window, "innerWidth", {
    value: ORIGINAL_INNER_WIDTH,
    writable: true,
    configurable: true,
  })
})

describe("CollectionPage — layout modes", () => {
  it("starts in masonry and switches to grid and rows", async () => {
    const user = userEvent.setup()
    stubPosts()
    renderPage()

    // Masonry is the default and the only rendered layout.
    const masonry = await screen.findByTestId("gallery-masonry")
    expect(within(masonry).getAllByTestId("post-card")).toHaveLength(2)

    await user.click(screen.getByTestId("view-mode-grid"))

    const grid = screen.getByTestId("post-grid")
    expect(within(grid).getAllByTestId("post-card")).toHaveLength(2)
    expect(screen.queryByTestId("gallery-masonry")).not.toBeInTheDocument()
    // Grid tiles are the compact variant: one square thumbnail per post.
    expect(
      screen
        .getAllByTestId("post-card")
        .every((card) => card.getAttribute("data-variant") === "grid")
    ).toBe(true)

    await user.click(screen.getByTestId("view-mode-rows"))

    expect(screen.getByTestId("post-rows")).toBeInTheDocument()
    expect(screen.queryByTestId("post-grid")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("post-card")[0]).toHaveAttribute(
      "data-variant",
      "row"
    )
  })

  it("remembers the chosen layout for the next visit", async () => {
    const user = userEvent.setup()
    stubPosts()
    const first = renderPage()

    await user.click(await screen.findByTestId("view-mode-rows"))
    expect(window.localStorage.getItem("twb.gallery.view-mode")).toBe("rows")

    first.unmount()
    stubPosts()
    renderPage()

    expect(await screen.findByTestId("post-rows")).toBeInTheDocument()
    expect(screen.queryByTestId("gallery-masonry")).not.toBeInTheDocument()
  })

  it("keeps the page column full-width on a phone (one column)", async () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      writable: true,
      configurable: true,
    })
    stubPosts()
    renderPage()

    const masonry = await screen.findByTestId("gallery-masonry")
    expect(masonry).toHaveAttribute("data-columns", "1")
    // Neither the grid nor the page column may carry the 292px cap: that cap is
    // what left a narrow ribbon and an overflowing toolbar at phone widths.
    expect(masonry.style.maxWidth).toBe("")
    expect(screen.getByTestId("collection-column").style.maxWidth).toBe("")
  })
})
