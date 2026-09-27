import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react"

import { LightboxInfoPanel } from "@/components/gallery/lightbox-info-panel"
import { MediaImage } from "@/components/gallery/media-image"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { flattenMediaSlots, slotAt } from "@/lib/lightbox"
import {
  LIGHTBOX_KEYBOARD_HINT,
  LIGHTBOX_NEXT_LABEL,
  LIGHTBOX_PREVIOUS_LABEL,
  LIGHTBOX_TITLE_PREFIX,
  formatLightboxCounter,
} from "@/lib/messages"
import { cn } from "@/lib/utils"
import type { GalleryPost } from "@/types"

/**
 * The media lightbox (LIGHT-01…LIGHT-06, PRD-2 §26/§27/§67, design spec §3.5).
 *
 * A **controlled, presentational** Radix Dialog: the caller (the
 * `useMediaLightbox` controller in `CollectionPage`) owns the flattened index,
 * and this component derives the active `(postIndex, mediaIndex)` slot, the
 * `n / total` counter and the two boundary flags from `posts` + `index` with
 * the same pure helpers the controller uses. Deriving rather than storing means
 * a late page append can never make the rendered item disagree with the index.
 *
 * Desktop (design spec §3.5): a `1220×820` r24 `surface` panel with a 30px
 * inset, an `800×760` r20 near-black media area holding the contained active
 * image with prev/next at its left/right edges and the counter, and a `330×760`
 * r20 `surface-warm` info panel beside it. Below `md` the panel is
 * `flex-col` — media on top at ~55vh, info stacked below.
 *
 * Keyboard (PRD-2 §27): `Escape` and the focus trap come from Radix; the arrow
 * keys are handled here on the dialog content (never a global listener) and are
 * `preventDefault`ed so the page behind cannot scroll. Radix does not bind the
 * arrow keys (verified: its `FocusScope` intercepts only `Tab`), so they always
 * reach this handler.
 *
 * Image `alt`: unlike the decorative card thumbnails, the lightbox image is the
 * dialog's primary content, so it carries a real author-derived name matching
 * the trigger that opened it; the metadata panel carries the tweet details.
 */

export interface MediaLightboxProps {
  /** The accumulated loaded gallery — the flattened navigation sequence. */
  posts: readonly GalleryPost[]
  /**
   * 0-based position in the flattened media sequence, or `null` when the
   * lightbox is closed. Text-only posts are skipped by the flattening.
   */
  index: number | null
  /** Backend collection `DisplayName` for the `Collection <name>` meta line. */
  collectionName: string
  /** Step one media back (no-op at the first loaded slot). */
  onPrev: () => void
  /** Step one media forward (no-op at the last loaded slot). */
  onNext: () => void
  /** Close the lightbox. */
  onClose: () => void
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
}

/** Author-derived `alt` for the active media (matches the tile trigger name). */
function describeMediaAlt(
  username: string,
  mediaIndex: number,
  mediaTotal: number
): string {
  return mediaTotal === 1
    ? `Media from @${username}`
    : `Media ${mediaIndex + 1} of ${mediaTotal} from @${username}`
}

const CONTROL_CLASS =
  "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-ink shadow-card outline-none transition-colors hover:bg-surface-warm focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40"

export function MediaLightbox({
  posts,
  index,
  collectionName,
  onPrev,
  onNext,
  onClose,
  now,
}: MediaLightboxProps) {
  const slots = useMemo(() => flattenMediaSlots(posts), [posts])
  const slot = index === null ? undefined : slotAt(slots, index)
  const post = slot === undefined ? undefined : posts[slot.postIndex]
  const hasActive = slot !== undefined && post !== undefined
  const prevRef = useRef<HTMLButtonElement | null>(null)
  const nextRef = useRef<HTMLButtonElement | null>(null)

  const total = slots.length
  const position = slot === undefined || index === null ? 0 : index + 1
  const hasPrev = hasActive && index !== null && index > 0
  const hasNext = hasActive && index !== null && index < total - 1

  // A browser blurs a control the instant it becomes `disabled`, and Radix's
  // focus trap ignores a blur whose `relatedTarget` is null — so arrow
  // navigation would die whenever it reached a boundary and disabled the button
  // that had focus (jsdom keeps reporting the disabled button as the active
  // element, which also makes `user-event` swallow the next key press). Pull
  // focus back onto an enabled control whenever the active media changes and
  // focus is no longer on something usable.
  useEffect(() => {
    if (!hasActive) {
      return
    }
    const focused = document.activeElement
    const focusLost =
      focused === null ||
      focused === document.body ||
      (focused instanceof HTMLButtonElement && focused.disabled)
    if (!focusLost) {
      return
    }

    const fallback =
      (hasNext ? nextRef.current : null) ??
      (hasPrev ? prevRef.current : null) ??
      document.querySelector<HTMLElement>('[data-testid="lightbox-close"]')
    fallback?.focus()
  }, [hasActive, index, hasNext, hasPrev])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      onPrev()
      return
    }
    if (event.key === "ArrowRight") {
      event.preventDefault()
      onNext()
    }
  }

  const mediaSrc =
    slot === undefined || post === undefined
      ? ""
      : (post.media[slot.mediaIndex] ?? "")

  return (
    <Dialog
      open={hasActive}
      onOpenChange={(next) => {
        if (!next) {
          onClose()
        }
      }}
    >
      <DialogContent
        data-testid="media-lightbox"
        showCloseButton={false}
        overlayClassName="bg-[#120d14]/82 supports-backdrop-filter:backdrop-blur-none"
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] flex-col gap-[30px] overflow-y-auto rounded-2xl bg-surface p-[30px] shadow-popover ring-0 sm:max-w-[1220px] md:h-[820px] md:flex-row md:overflow-hidden"
      >
        <DialogTitle className="sr-only">
          {slot === undefined || post === undefined
            ? LIGHTBOX_TITLE_PREFIX
            : `${LIGHTBOX_TITLE_PREFIX} ${post.author} (@${post.username})`}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {LIGHTBOX_KEYBOARD_HINT}
        </DialogDescription>

        <div
          data-testid="lightbox-media-area"
          className="relative flex h-[55vh] w-full items-center justify-center overflow-hidden rounded-xl bg-[#0b080d] md:h-auto md:min-h-0 md:flex-1"
        >
          {slot === undefined || post === undefined ? null : (
            <>
              <MediaImage
                key={`${post.tweet_id}:${slot.mediaIndex}`}
                src={mediaSrc}
                fallbackSeed={`${post.tweet_id}:${slot.mediaIndex}`}
                alt={describeMediaAlt(
                  post.username,
                  slot.mediaIndex,
                  post.media.length
                )}
                loading="eager"
                className="max-h-full max-w-full object-contain"
              />

              <button
                ref={prevRef}
                type="button"
                data-testid="lightbox-prev"
                aria-label={LIGHTBOX_PREVIOUS_LABEL}
                disabled={!hasPrev}
                onClick={onPrev}
                className={cn(CONTROL_CLASS, "left-3")}
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>

              <button
                ref={nextRef}
                type="button"
                data-testid="lightbox-next"
                aria-label={LIGHTBOX_NEXT_LABEL}
                disabled={!hasNext}
                onClick={onNext}
                className={cn(CONTROL_CLASS, "right-3")}
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </button>

              <p
                data-testid="lightbox-counter"
                role="status"
                aria-label={formatLightboxCounter(position, total)}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-sm bg-surface/85 px-2 py-0.5 text-[11px] leading-[1.4] font-medium text-ink"
              >
                {`${position} / ${total}`}
              </p>
            </>
          )}
        </div>

        {slot === undefined || post === undefined ? null : (
          <LightboxInfoPanel
            post={post}
            collectionName={collectionName}
            onClose={onClose}
            now={now}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
