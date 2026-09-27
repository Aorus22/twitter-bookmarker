import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PostMediaGrid } from "./post-media-grid"
import { pbsUrl } from "@/test/fixtures"

/**
 * COLL-04: every media URL of a post is rendered in one card — never truncated
 * to the first image — with the §3.3 adaptive layout for each count.
 */

function media(count: number): string[] {
  return Array.from({ length: count }, (_, index) => pbsUrl(`m${index}`))
}

function renderGrid(count: number) {
  const urls = media(count)
  render(
    <PostMediaGrid
      media={urls}
      seed="tweet-1"
      describeAlt={(index, total) => `Media ${index + 1} of ${total}`}
    />
  )
  return urls
}

describe("PostMediaGrid — adaptive layouts (PRD-2 §20)", () => {
  it("renders one natural-aspect tile for a single image", () => {
    const urls = renderGrid(1)
    const grid = screen.getByTestId("post-media-grid")

    expect(grid).toHaveAttribute("data-media-layout", "single")
    expect(grid).toHaveAttribute("data-media-count", "1")
    expect(screen.getAllByTestId("media-image")).toHaveLength(1)
    expect(screen.getByTestId("media-image")).toHaveAttribute("src", urls[0])
  })

  it("renders two images as a 50/50 split", () => {
    renderGrid(2)
    const grid = screen.getByTestId("post-media-grid")

    expect(grid).toHaveAttribute("data-media-layout", "duo")
    expect(grid.className).toContain("grid-cols-2")
    expect(screen.getAllByTestId("media-image")).toHaveLength(2)
  })

  it("renders three images as a wide tile over two tiles", () => {
    renderGrid(3)
    const grid = screen.getByTestId("post-media-grid")
    const images = screen.getAllByTestId("media-image")

    expect(grid).toHaveAttribute("data-media-layout", "trio")
    expect(images).toHaveLength(3)
    expect(images[0].className).toContain("col-span-2")
    expect(images[1].className).not.toContain("col-span-2")
    expect(images[2].className).not.toContain("col-span-2")
  })

  it("renders four images as a compact 2x2 grid", () => {
    renderGrid(4)

    expect(screen.getByTestId("post-media-grid")).toHaveAttribute(
      "data-media-layout",
      "grid"
    )
    expect(screen.getAllByTestId("media-image")).toHaveLength(4)
  })

  it("renders every media beyond four — 5 and 6 are never truncated", () => {
    for (const count of [5, 6, 9]) {
      const { unmount } = render(
        <PostMediaGrid
          media={media(count)}
          seed={`tweet-${count}`}
          describeAlt={(index, total) => `Media ${index + 1} of ${total}`}
        />
      )

      const images = screen.getAllByTestId("media-image")
      expect(images).toHaveLength(count)
      expect(images.map((image) => image.getAttribute("src"))).toEqual(
        media(count)
      )
      // No summary/overflow tile is used to hide media.
      expect(screen.getByTestId("post-media-grid")).toHaveAttribute(
        "data-media-count",
        String(count)
      )

      unmount()
    }
  })
})

describe("PostMediaGrid — rendering contract", () => {
  it("loads every tile lazily from the stored pbs.twimg.com URL", () => {
    renderGrid(4)

    for (const image of screen.getAllByTestId("media-image")) {
      expect(image).toHaveAttribute("loading", "lazy")
      expect(image).toHaveAttribute("decoding", "async")
      expect(image.getAttribute("src")).toMatch(/^https:\/\/pbs\.twimg\.com\//)
    }
  })

  it("gives each tile contextual alt text derived from the post", () => {
    renderGrid(2)

    const grid = screen.getByTestId("post-media-grid")
    expect(within(grid).getByAltText("Media 1 of 2")).toBeInTheDocument()
    expect(within(grid).getByAltText("Media 2 of 2")).toBeInTheDocument()
  })

  it("keeps a same-box placeholder when a tile's remote image is broken (COLL-11)", () => {
    renderGrid(2)
    const grid = screen.getByTestId("post-media-grid")

    fireEvent.error(screen.getAllByTestId("media-image")[1])

    const placeholder = within(grid).getByTestId("media-placeholder")
    expect(placeholder.className).toContain("aspect-[3/4]")
    expect(placeholder.className).toContain("rounded-md")
    expect(grid).toHaveAttribute("data-media-layout", "duo")
    expect(within(grid).getAllByTestId("media-image")).toHaveLength(1)
  })
})
