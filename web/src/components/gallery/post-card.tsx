import { ClampedPostText } from "@/components/gallery/clamped-post-text"
import { PostActionsMenu } from "@/components/gallery/post-actions-menu"
import { PostMediaGrid } from "@/components/gallery/post-media-grid"
import { PostMediaThumb } from "@/components/gallery/post-media-thumb"
import type { PortalContainer } from "@/components/ui/dialog"
import { OPEN_ON_X_LABEL } from "@/lib/messages"
import { pickPlaceholderGradient } from "@/lib/placeholder"
import { displayHandle, formatPostMeta } from "@/lib/post-meta"
import { cn } from "@/lib/utils"
import type { GalleryPost } from "@/types"

/**
 * One post card (PRD-2 §19/§23/§24, design spec §3.3).
 *
 * `292` wide, `r18` (`rounded-lg`), `surface`, hairline `border`,
 * `shadow-post`, `10px` padding. The card unit is the tweet: a four-image tweet
 * is exactly one card whose media region renders all four images.
 *
 * **Content order follows X itself** (owner request, Nov 2026):
 *   1. header — avatar `28×28` r-full (deterministic gradient seeded from
 *      `username`; the stored post has no avatar URL, spec §5), author Inter
 *      SemiBold 11 and `@username` Inter Regular 9 muted, with the curation
 *      kebab on the right;
 *   2. the tweet body Inter Regular 11 ink with the controlled clamp +
 *      `Show more` (COLL-08);
 *   3. the media region — `PostMediaGrid`. Each tile is a named, focusable
 *      lightbox trigger when `onOpenMedia` is supplied (LIGHT-01);
 *   4. meta `Mar 12, 2026 · Saved Apr 3` Inter Regular 9 muted;
 *   5. `Open on X ↗` Inter SemiBold 10 as a real `<a>` to the stored `url` with
 *      `target="_blank" rel="noopener noreferrer"` — the tweet URL is always
 *      reachable as text, never only through a clickable image (PRD-2 §67).
 *
 * The old card put the media (or a gradient "quote panel") first and the author
 * below it, and a text-only tweet was rendered *inside* a decorative image. That
 * is not how the source tweet reads: text first, media after, then any quoted
 * post. The stored row has no quoted-tweet column (the extension deliberately
 * excludes quoted text/media), so there is no quoted block to draw yet — the
 * slot would sit after the media.
 */

/**
 * The curation actions a card can offer. Optional as a whole, so a card rendered
 * without them (a read-only context, or a test of the card's own layout) shows no
 * kebab at all rather than a dead button.
 */
export interface PostCardActions {
  onRequestDelete: (post: GalleryPost) => void
  onRequestMove: (post: GalleryPost) => void
  /**
   * Portal target for the menu. Only the media lightbox needs one: its content
   * element keeps the menu inside the dialog's focus trap.
   */
  portalContainer?: PortalContainer
}

/**
 * Card densities.
 *
 * `card` is the masonry card: header, tweet body, then the whole adaptive media
 * region. `grid` is the same card reduced to a square thumbnail (one frame plus
 * a `+N` chip) with the body omitted, so every tile in the aligned grid has the
 * same height. Both keep the header, the meta line and `Open on X`, so the card
 * never loses its non-media affordances when the layout changes.
 */
export type PostCardVariant = "card" | "grid"

export interface PostCardProps {
  post: GalleryPost
  /** Card density; defaults to the full masonry card. */
  variant?: PostCardVariant
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
  /**
   * Phase 8 (LIGHT-01/LIGHT-05): makes each media tile a keyboard-reachable
   * lightbox trigger and hands back the trigger element so focus can be
   * restored to it when the lightbox closes. Omit for a non-interactive card.
   */
  onOpenMedia?: (mediaIndex: number, trigger: HTMLButtonElement) => void
  /**
   * Curation: shows the per-post kebab menu. The card only *reports* the intent;
   * the page owns the dialogs and the requests, so one set of dialogs serves
   * every card instead of one per card.
   */
  actions?: PostCardActions
}

export function PostCard({
  post,
  variant = "card",
  now,
  onOpenMedia,
  actions,
}: PostCardProps) {
  const isGrid = variant === "grid"
  const isTextOnly = post.media.length === 0
  const hasText = post.text.trim() !== ""
  const meta = formatPostMeta(post, now === undefined ? {} : { now })
  const avatar = pickPlaceholderGradient(post.username)

  const handle = displayHandle(post.username)
  const describeAlt = (index: number, total: number) =>
    total === 1
      ? `Media from ${handle}`
      : `Media ${index + 1} of ${total} from ${handle}`

  return (
    <article
      data-testid="post-card"
      data-variant={variant}
      data-media-count={post.media.length}
      className={cn(
        "group relative flex w-full flex-col rounded-lg border border-border bg-surface p-[10px] shadow-post",
        isGrid && "h-full"
      )}
    >
      {actions === undefined ? null : (
        // Hidden until the card is hovered or something inside it takes focus.
        // `focus-within` is what keeps it reachable by keyboard: a control that
        // only appears on hover is unusable without a pointer, and the
        // accessibility gate fails a Tab stop that paints no ring. The button
        // stays in the DOM either way, so it is always in the tab order.
        <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <PostActionsMenu
            post={post}
            onRequestDelete={actions.onRequestDelete}
            onRequestMove={actions.onRequestMove}
            portalContainer={actions.portalContainer}
            className="shadow-card"
          />
        </div>
      )}

      <div
        className={cn(
          "flex min-w-0 items-center gap-2 px-1",
          actions === undefined ? null : "pr-7"
        )}
      >
        <span
          aria-hidden="true"
          data-testid="post-avatar"
          style={{ backgroundImage: avatar.value }}
          className="size-7 shrink-0 rounded-full"
        />
        <p className="min-w-0 flex-1 truncate text-[11px] leading-[1.4]">
          <span className="font-semibold text-ink">{post.author}</span>{" "}
          <span className="text-[9px] font-normal text-muted">{handle}</span>
        </p>
      </div>

      {/* A grid tile is a picture, not a reading card: the body is left to the
          masonry and rows modes, and the lightbox's info panel still carries it
          in full. This is also what keeps every tile the same height. */}
      {isGrid ? null : hasText ? (
        <ClampedPostText text={post.text} className="mt-2 px-1" />
      ) : null}

      {isTextOnly ? (
        isGrid && hasText ? (
          // Text-only posts have no picture; the tile shows the tweet as text on
          // the card surface instead of faking an image behind it.
          <div className="mt-2.5 flex min-h-[160px] w-full flex-col rounded-md border border-border bg-surface-warm p-3">
            <ClampedPostText text={post.text} />
          </div>
        ) : null
      ) : isGrid ? (
        <PostMediaThumb
          media={post.media}
          seed={post.tweet_id}
          label={describeAlt(0, post.media.length)}
          onOpenMedia={onOpenMedia}
          className="mt-2.5"
        />
      ) : (
        <PostMediaGrid
          media={post.media}
          seed={post.tweet_id}
          describeAlt={describeAlt}
          onOpenMedia={onOpenMedia}
          className="mt-2.5"
        />
      )}

      <p
        data-testid="post-meta"
        className={cn(
          "px-1 text-[9px] leading-[1.4] text-muted",
          isGrid ? "mt-auto pt-3" : "mt-3"
        )}
      >
        {meta}
      </p>

      <a
        data-testid="open-on-x"
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 w-fit rounded-sm px-1 text-[10px] leading-[1.4] font-semibold text-ink transition-colors outline-none hover:text-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {OPEN_ON_X_LABEL}
      </a>
    </article>
  )
}
