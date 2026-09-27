import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useMediaLightbox } from "./use-media-lightbox"
import { makePost, pbsUrl } from "@/test/fixtures"

/**
 * LIGHT-03/LIGHT-06 controller contract: a click becomes a flattened position,
 * stepping walks across tweet boundaries and clamps at the loaded edges, a
 * query change closes a stale lightbox, and the gallery offset is captured on
 * open and restored after close.
 */

const POSTS = [
  makePost({
    tweet_id: "1",
    username: "ada",
    media: [pbsUrl("a1"), pbsUrl("a2")],
    text: "Two images.",
  }),
  makePost({
    tweet_id: "2",
    username: "grace",
    media: [],
    text: "Text only.",
  }),
  makePost({
    tweet_id: "3",
    username: "linus",
    media: [pbsUrl("c1")],
    text: "One image.",
  }),
]

afterEach(() => {
  window.scrollY = 0
})

function renderLightbox(posts = POSTS) {
  return renderHook(({ value }: { value: typeof POSTS }) => useMediaLightbox(value), {
    initialProps: { value: posts },
  })
}

describe("useMediaLightbox — flattening and opening (LIGHT-03)", () => {
  it("starts closed and reports the total media in the loaded dataset", () => {
    const { result } = renderLightbox()

    expect(result.current.index).toBeNull()
    // The text-only post contributes no slot.
    expect(result.current.total).toBe(3)
  })

  it("opens at the flattened position of the clicked tile", () => {
    const { result } = renderLightbox()

    act(() => {
      result.current.open(0, 1)
    })

    expect(result.current.index).toBe(1)
  })

  it("continues a tweet's media in the next loaded tweet after the last one", () => {
    const { result } = renderLightbox()

    act(() => {
      result.current.open(0, 1)
    })
    act(() => {
      result.current.goNext()
    })

    // Slot 2 is post 3's only image: the text-only post 2 contributed nothing.
    expect(result.current.index).toBe(2)
  })

  it("is a no-op when the clicked slot does not exist", () => {
    const { result } = renderLightbox()

    act(() => {
      result.current.open(1, 0)
    })

    expect(result.current.index).toBeNull()
  })
})

describe("useMediaLightbox — boundaries (LIGHT-03)", () => {
  it("does not wrap past the last loaded item", () => {
    const { result } = renderLightbox()

    act(() => {
      result.current.open(2, 0)
    })
    act(() => {
      result.current.goNext()
    })

    expect(result.current.index).toBe(2)
  })

  it("does not wrap before the first loaded item", () => {
    const { result } = renderLightbox()

    act(() => {
      result.current.open(0, 0)
    })
    act(() => {
      result.current.goPrev()
    })

    expect(result.current.index).toBe(0)
  })
})

describe("useMediaLightbox — lifecycle (LIGHT-03/LIGHT-06)", () => {
  it("closes on demand", () => {
    const { result } = renderLightbox()

    act(() => {
      result.current.open(0, 0)
    })
    act(() => {
      result.current.close()
    })

    expect(result.current.index).toBeNull()
  })

  it("closes itself when the loaded slots disappear under it", () => {
    const { result, rerender } = renderLightbox()

    act(() => {
      result.current.open(2, 0)
    })
    expect(result.current.index).toBe(2)

    rerender({ value: [POSTS[0]] })

    expect(result.current.index).toBeNull()
  })

  it("keeps following the same media when a reshuffle reorders the tweets", () => {
    const { result, rerender } = renderLightbox()

    act(() => {
      result.current.open(0, 1)
    })
    expect(result.current.index).toBe(1)

    // A sort change puts the one-media tweet first; the selected media is the
    // same image, so the position follows it instead of jumping to a stranger.
    rerender({ value: [POSTS[2], POSTS[0]] })

    expect(result.current.index).toBe(2)
  })

  it("captures the gallery offset on open and restores it after close", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo")
    const { result } = renderLightbox()

    window.scrollY = 512
    act(() => {
      result.current.open(0, 0)
    })

    // A browser that clamped the locked body would leave the page at the top.
    window.scrollY = 0
    act(() => {
      result.current.close()
    })

    // The restore is deferred past Radix's scroll-lock release.
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0)
      })
    })

    expect(scrollTo).toHaveBeenCalledWith({
      top: 512,
      left: 0,
      behavior: "auto",
    })
  })
})
