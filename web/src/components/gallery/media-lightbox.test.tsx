import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MediaLightbox, type MediaLightboxProps } from "./media-lightbox"
import { makePost, pbsUrl, POST_NOW } from "@/test/fixtures"

/**
 * LIGHT-01/LIGHT-02/LIGHT-04/LIGHT-05 component contract (PRD-2 §26/§27/§67,
 * design spec §3.5). The component is presentational: the flattened index is a
 * prop, so every case here is a direct statement about the rendered panel,
 * counter, controls and responsive structure.
 */

const POSTS = [
  makePost({
    tweet_id: "1",
    author: "Ada Lovelace",
    username: "ada",
    media: [pbsUrl("a1"), pbsUrl("a2")],
    text: "Two images from the archive.",
  }),
  makePost({
    tweet_id: "2",
    author: "Grace Hopper",
    username: "grace",
    media: [],
    text: "A text-only tweet.",
  }),
  makePost({
    tweet_id: "3",
    author: "Linus Torvalds",
    username: "linus",
    media: [pbsUrl("c1")],
    text: "One image.",
  }),
]

const LONG_TEXT = `${"Wayland compositors and the Linux desktop. ".repeat(8)}End.`

function renderLightbox(props: Partial<MediaLightboxProps> = {}) {
  const onClose = vi.fn()
  const onPrev = vi.fn()
  const onNext = vi.fn()

  const view = render(
    <MediaLightbox
      posts={POSTS}
      index={0}
      collectionName="Linux"
      onPrev={onPrev}
      onNext={onNext}
      onClose={onClose}
      now={POST_NOW}
      {...props}
    />
  )

  return { onClose, onPrev, onNext, view }
}

describe("MediaLightbox — contents (LIGHT-01)", () => {
  it("renders nothing while closed", () => {
    renderLightbox({ index: null })

    expect(screen.queryByTestId("media-lightbox")).not.toBeInTheDocument()
  })

  it("shows the active media contained in the media area", () => {
    const { view } = renderLightbox({ index: 0 })

    const mediaArea = screen.getByTestId("lightbox-media-area")
    const image = within(mediaArea).getByTestId("media-image")
    expect(image).toHaveAttribute("src", pbsUrl("a1"))
    expect(image.className).toContain("object-contain")
    // A real alt, because the lightbox image is the dialog's primary content.
    expect(image).toHaveAttribute("alt", "Media 1 of 2 from @ada")
    expect(view.container).toBeInTheDocument()
  })

  it("flattens navigation over the loaded posts, skipping text-only tweets", () => {
    const { view } = renderLightbox({ index: 2 })

    // Slot 2 is post 3's only image — post 2 has no media.
    expect(within(screen.getByTestId("lightbox-media-area")).getByTestId("media-image")).toHaveAttribute(
      "src",
      pbsUrl("c1")
    )
    expect(screen.getByTestId("lightbox-author")).toHaveTextContent(
      "Linus Torvalds"
    )
    expect(view.container).toBeInTheDocument()
  })

  it("shows the three meta lines with both dates and the collection display name", () => {
    renderLightbox({ index: 0, collectionName: "Linux" })

    expect(screen.getByTestId("lightbox-posted")).toHaveTextContent(
      "Posted Mar 12, 2026"
    )
    expect(screen.getByTestId("lightbox-saved")).toHaveTextContent("Saved Apr 3")
    expect(screen.getByTestId("lightbox-collection")).toHaveTextContent(
      "Collection Linux"
    )
  })

  it("renders author, username, text and a real Open on X anchor", () => {
    renderLightbox({ index: 0 })

    expect(screen.getByTestId("lightbox-author")).toHaveTextContent(
      "Ada Lovelace"
    )
    expect(screen.getByTestId("lightbox-username")).toHaveTextContent("@ada")
    expect(screen.getByTestId("lightbox-info")).toHaveTextContent(
      "Two images from the archive."
    )

    const link = screen.getByTestId("lightbox-open-on-x")
    expect(link.tagName).toBe("A")
    expect(link).toHaveAttribute("href", "https://x.com/ada/status/1")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveTextContent("Open on X ↗")
  })

  it("gives the dialog an accessible name and a keyboard hint", () => {
    renderLightbox({ index: 0 })

    expect(
      screen.getByRole("dialog", {
        name: "Post media by Ada Lovelace (@ada)",
      })
    ).toBeInTheDocument()
    expect(screen.getByTestId("media-lightbox")).toHaveAccessibleDescription(
      /left and right arrow keys/
    )
  })
})

describe("MediaLightbox — counter and controls (LIGHT-02/LIGHT-03)", () => {
  it("shows n / total and exposes it to assistive tech", () => {
    renderLightbox({ index: 1 })

    const counter = screen.getByTestId("lightbox-counter")
    expect(counter).toHaveTextContent("2 / 3")
    expect(counter).toHaveAttribute("aria-label", "Media 2 of 3")
    expect(counter).toHaveAttribute("role", "status")
  })

  it("names the prev/next controls instead of relying on the glyphs", () => {
    renderLightbox({ index: 1 })

    expect(
      screen.getByRole("button", { name: "Previous media" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next media" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close lightbox" })).toHaveAttribute(
      "data-testid",
      "lightbox-close"
    )
  })

  it("disables previous on the very first loaded item", () => {
    renderLightbox({ index: 0 })

    expect(screen.getByTestId("lightbox-prev")).toBeDisabled()
    expect(screen.getByTestId("lightbox-next")).toBeEnabled()
  })

  it("disables next on the very last loaded item", () => {
    renderLightbox({ index: 2 })

    expect(screen.getByTestId("lightbox-next")).toBeDisabled()
    expect(screen.getByTestId("lightbox-prev")).toBeEnabled()
  })

  it("calls the navigation handlers when the controls are clicked", async () => {
    const user = userEvent.setup()
    const { onNext, onPrev, onClose } = renderLightbox({ index: 1 })

    await user.click(screen.getByTestId("lightbox-next"))
    await user.click(screen.getByTestId("lightbox-prev"))
    await user.click(screen.getByTestId("lightbox-close"))

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("MediaLightbox — keyboard (LIGHT-04)", () => {
  it("navigates with ArrowLeft and ArrowRight", async () => {
    const user = userEvent.setup()
    const { onNext, onPrev } = renderLightbox({ index: 1 })

    await user.keyboard("{ArrowRight}")
    await user.keyboard("{ArrowLeft}")

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it("closes on Escape through the dialog primitive", async () => {
    const user = userEvent.setup()
    const { onClose } = renderLightbox({ index: 1 })

    await user.keyboard("{Escape}")

    expect(onClose).toHaveBeenCalled()
  })

  it("does not let the arrow keys scroll the page behind the dialog", () => {
    renderLightbox({ index: 1 })

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    })
    screen.getByTestId("media-lightbox").dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe("MediaLightbox — responsive structure and scrim (LIGHT-02)", () => {
  it("puts the media beside the info panel on desktop and stacks them below", () => {
    renderLightbox({ index: 0 })

    const panel = screen.getByTestId("media-lightbox")
    expect(panel.className).toContain("flex-col")
    expect(panel.className).toContain("md:flex-row")
    expect(panel.className).toContain("sm:max-w-[1220px]")
    expect(panel.className).toContain("md:h-[820px]")
    expect(panel.className).toContain("rounded-2xl")
    expect(panel.className).toContain("bg-surface")
    expect(panel.className).toContain("shadow-popover")
    expect(panel.className).toContain("p-[30px]")

    const mediaArea = screen.getByTestId("lightbox-media-area")
    expect(mediaArea.className).toContain("h-[55vh]")
    expect(mediaArea.className).toContain("md:flex-1")
    expect(mediaArea.className).toContain("rounded-xl")
    expect(mediaArea.className).toContain("bg-[#0b080d]")

    const info = screen.getByTestId("lightbox-info")
    expect(info.className).toContain("md:w-[330px]")
    expect(info.className).toContain("rounded-xl")
    expect(info.className).toContain("bg-surface-warm")
    expect(info.className).toContain("p-[22px]")
  })

  it("tints the scrim with the spec colour", () => {
    renderLightbox({ index: 0 })

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    expect(overlay?.className).toContain("bg-[#120d14]/82")
  })
})

describe("MediaLightbox — clamp and broken media (LIGHT-01)", () => {
  it("clamps long post text with a working Show more", async () => {
    const user = userEvent.setup()
    renderLightbox({
      index: 0,
      posts: [{ ...POSTS[0], text: LONG_TEXT }],
    })

    const text = within(screen.getByTestId("lightbox-info")).getByTestId(
      "post-text"
    )
    expect(text.className).toContain("line-clamp-5")
    expect(text.className).toContain("text-[13px]")

    await user.click(screen.getByTestId("post-text-toggle"))

    expect(text.className).not.toContain("line-clamp")
    expect(screen.getByTestId("post-text-toggle")).toHaveTextContent("Show less")
  })

  it("keeps the panel intact when the lightbox image is broken", () => {
    renderLightbox({ index: 0 })

    fireEvent.error(
      within(screen.getByTestId("lightbox-media-area")).getByTestId("media-image")
    )

    expect(screen.getByTestId("media-placeholder")).toBeInTheDocument()
    expect(screen.getByTestId("lightbox-author")).toHaveTextContent(
      "Ada Lovelace"
    )
    expect(screen.getByTestId("lightbox-counter")).toHaveTextContent("1 / 3")
  })
})
