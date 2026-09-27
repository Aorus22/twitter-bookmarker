import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { CollectionCard } from "./collection-card"
import type { GalleryCollection } from "@/types"

const NOW = new Date(2026, 8, 28, 12, 0, 0)
const SAVED_AT = new Date(2026, 8, 27, 12, 0, 0).toISOString()

const LINUX: GalleryCollection = {
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
}

function renderCard(collection: GalleryCollection = LINUX) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ul>
        <CollectionCard collection={collection} now={NOW} />
      </ul>
    </MemoryRouter>
  )
}

describe("CollectionCard", () => {
  it("renders the name, filename, counts and last-saved date (PRD-2 §16)", () => {
    renderCard()

    expect(screen.getByRole("heading", { name: "Linux" })).toBeInTheDocument()
    expect(screen.getByText("linux.csv")).toBeInTheDocument()
    expect(
      screen.getByText("83 posts · 126 media · Last saved Sep 27")
    ).toBeInTheDocument()
  })

  it("links the whole card to /collections/:filename", () => {
    renderCard()

    expect(
      screen.getByRole("link", { name: /Linux, 83 posts/ })
    ).toHaveAttribute("href", "/collections/linux.csv")
  })

  it("URL-encodes the filename in the href", () => {
    renderCard({ ...LINUX, filename: "a b/c.csv", name: "Odd" })

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/collections/a%20b%2Fc.csv"
    )
  })

  it("renders the four newest cover media as a 2x2 collage", () => {
    renderCard()

    const cover = screen.getByTestId("collection-cover")
    expect(cover).toHaveAttribute("data-cover-layout", "quad")
    expect(within(cover).getAllByTestId("media-image")).toHaveLength(4)
  })

  it("renders a gradient placeholder for a collection with no media (PRD-2 §17)", () => {
    renderCard({
      ...LINUX,
      filename: "quiet.csv",
      name: "Quiet",
      post_count: 0,
      media_count: 0,
      last_saved_at: null,
      cover_media: [],
    })

    expect(screen.getByTestId("cover-placeholder")).toBeInTheDocument()
    expect(
      screen.getByText("0 posts · 0 media · No saves yet")
    ).toBeInTheDocument()
  })

  it("omits the mockup's overflow control because no card action exists", () => {
    renderCard()

    expect(screen.queryByText("•••")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
