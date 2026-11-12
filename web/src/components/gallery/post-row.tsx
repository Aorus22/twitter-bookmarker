import { MessageSquare } from "lucide-react"

import { ClampedPostText } from "@/components/gallery/clamped-post-text"
import { PostActionsMenu } from "@/components/gallery/post-actions-menu"
import { PostMediaThumb } from "@/components/gallery/post-media-thumb"
import type { PortalContainer } from "@/components/ui/dialog"
import { OPEN_ON_X_LABEL } from "@/lib/messages"
import { pickPlaceholderGradient } from "@/lib/placeholder"
import { displayHandle, formatPostMeta } from "@/lib/post-meta"
import { cn } from "@/lib/utils"
import type { GalleryPost } from "@/types"

/**
 * One horizontal post row (owner request, Nov 2026).
 *
 * The compact layout: square thumbnail on the left, author + clamped tweet +
 * meta + `Open on X` on the right. It carries the same data-testids as
 * `PostCard` (`post-card`, `post-meta`, `open-on-x`) because it is the same
 * post, just rendered as a row — page tests and the curation plumbing do not
 * have to care which layout is active.
 *
 * The text clamp is the `row` variant (two lines) so a long thread cannot turn
 * one row into a page; `Show more` still expands it in place.
 */

export interface PostRowActions {
  onRequestDelete: (post: GalleryPost) => void
  onRequestMove: (post: GalleryPost) => void
  portalContainer?: PortalContainer
}

export interface PostRowProps {
  post: GalleryPost
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
  onOpenMedia?: (mediaIndex: number, trigger: HTMLButtonElement) => void
  actions?: PostRowActions
}

export function PostRow({ post, now, onOpenMedia, actions }: PostRowProps) {
  const meta = formatPostMeta(post, now === undefined ? {} : { now })
  const handle = displayHandle(post.username)
  const avatar = pickPlaceholderGradient(post.username)
  const hasMedia = post.media.length > 0
  const mediaLabel =
    post.media.length === 1
      ? `Media from ${handle}`
      : `Media 1 of ${post.media.length} from ${handle}`

  return (
    <article
      data-testid="post-card"
      data-variant="row"
      data-media-count={post.media.length}
      className="group relative flex w-full gap-3 rounded-lg border border-border bg-surface p-2.5 shadow-post sm:gap-4 sm:p-3"
    >
      {actions === undefined ? null : (
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

      <div className="w-[92px] shrink-0 sm:w-[120px]">
        {hasMedia ? (
          <PostMediaThumb
            media={post.media}
            seed={post.tweet_id}
            label={mediaLabel}
            onOpenMedia={onOpenMedia}
          />
        ) : (
          // Text-only rows keep the same square slot so the list stays on one
          // rhythm. It is a neutral panel, not a gradient pretending to be an
          // image: the row's text is the content.
          <div
            aria-hidden="true"
            data-testid="post-row-panel"
            className="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-surface-warm"
          >
            <MessageSquare className="size-5 text-muted" />
          </div>
        )}
      </div>

      <div
        className={cn("flex min-w-0 flex-1 flex-col", actions ? "pr-8" : "")}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            data-testid="post-avatar"
            style={{ backgroundImage: avatar.value }}
            className="size-6 shrink-0 rounded-full"
          />
          <p className="min-w-0 flex-1 truncate text-[11px] leading-[1.4]">
            <span className="font-semibold text-ink">{post.author}</span>{" "}
            <span className="text-[9px] font-normal text-muted">{handle}</span>
          </p>
        </div>

        <ClampedPostText text={post.text} variant="row" className="mt-2 pr-1" />

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
          <p
            data-testid="post-meta"
            className="text-[9px] leading-[1.4] text-muted"
          >
            {meta}
          </p>
          <a
            data-testid="open-on-x"
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit rounded-sm text-[10px] leading-[1.4] font-semibold text-ink transition-colors outline-none hover:text-accent focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {OPEN_ON_X_LABEL}
          </a>
        </div>
      </div>
    </article>
  )
}
