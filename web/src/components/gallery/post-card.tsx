import { ClampedPostText } from "@/components/gallery/clamped-post-text"
import { PostActionsMenu } from "@/components/gallery/post-actions-menu"
import { PostMediaGrid } from "@/components/gallery/post-media-grid"
import { TextPostCard } from "@/components/gallery/text-post-card"
import type { PortalContainer } from "@/components/ui/dialog"
import { OPEN_ON_X_LABEL } from "@/lib/messages"
import { displayHandle, formatPostMeta } from "@/lib/post-meta"
import type { GalleryPost } from "@/types"

/**
 * One post card. The card unit is the tweet: a four-image tweet is one card
 * whose media region renders all four images.
 *
 * Quiet chrome around loud media — a hairline, a small inset, and type that
 * stays out of the way. The kebab only appears on hover/focus but stays in the
 * DOM, so it is always in the tab order.
 */
export interface PostCardActions {
  onRequestDelete: (post: GalleryPost) => void
  onRequestMove: (post: GalleryPost) => void
  portalContainer?: PortalContainer
}

export interface PostCardProps {
  post: GalleryPost
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
  /** Makes each media tile a keyboard-reachable lightbox trigger. */
  onOpenMedia?: (mediaIndex: number, trigger: HTMLButtonElement) => void
  /** Shows the per-post kebab menu; the page owns the dialogs and requests. */
  actions?: PostCardActions
}

export function PostCard({ post, now, onOpenMedia, actions }: PostCardProps) {
  const isTextOnly = post.media.length === 0
  const meta = formatPostMeta(post, now === undefined ? {} : { now })
  const handle = displayHandle(post.username)
  const initial = (post.author.trim() || handle).charAt(0).toUpperCase()

  const describeAlt = (index: number, total: number) =>
    total === 1
      ? `Media from ${handle}`
      : `Media ${index + 1} of ${total} from ${handle}`

  return (
    <article
      data-testid="post-card"
      data-media-count={post.media.length}
      className="group relative flex w-full flex-col rounded-xl border border-border bg-surface p-2 shadow-post transition-colors hover:border-ink/15"
    >
      {actions === undefined ? null : (
        <div className="absolute top-3.5 right-3.5 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <PostActionsMenu
            post={post}
            onRequestDelete={actions.onRequestDelete}
            onRequestMove={actions.onRequestMove}
            portalContainer={actions.portalContainer}
            className="shadow-card"
          />
        </div>
      )}

      {isTextOnly ? (
        <TextPostCard text={post.text} seed={post.tweet_id} />
      ) : (
        <PostMediaGrid
          media={post.media}
          seed={post.tweet_id}
          describeAlt={describeAlt}
          onOpenMedia={onOpenMedia}
        />
      )}

      <div className="mt-2.5 flex items-center gap-2 px-1">
        <span
          aria-hidden="true"
          data-testid="post-avatar"
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-warm text-[9.5px] leading-none font-semibold text-muted"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12px] leading-[1.4] font-semibold tracking-[-0.005em] text-ink">
            {post.author}
          </p>
          <p className="truncate text-[10.5px] leading-[1.4] text-muted">
            {handle}
          </p>
        </div>
      </div>

      {isTextOnly ? null : (
        <ClampedPostText text={post.text} className="mt-2.5 px-1" />
      )}

      <p
        data-testid="post-meta"
        className="tnum mt-2.5 px-1 text-[10.5px] leading-[1.4] text-muted"
      >
        {meta}
      </p>

      <a
        data-testid="open-on-x"
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 w-fit rounded-sm px-1 py-0.5 text-[11px] leading-[1.4] font-semibold text-muted transition-colors outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {OPEN_ON_X_LABEL}
      </a>
    </article>
  )
}
