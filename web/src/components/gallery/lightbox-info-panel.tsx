import { ClampedPostText } from "@/components/gallery/clamped-post-text"
import { PostActionsMenu } from "@/components/gallery/post-actions-menu"
import type { PostCardActions } from "@/components/gallery/post-card"
import { displayHandle, formatLightboxMeta } from "@/lib/post-meta"
import { LIGHTBOX_CLOSE_LABEL, OPEN_ON_X_LABEL } from "@/lib/messages"
import type { GalleryPost } from "@/types"

/**
 * The lightbox metadata panel: author, text, dates, and the one outbound link.
 *
 * The facts are split between the top (who and what) and the foot (when and
 * where) so the middle of a tall panel is not a dead white column. The close and
 * kebab controls stay in the top-right corner.
 */
export interface LightboxInfoPanelProps {
  post: GalleryPost
  /** Backend collection `DisplayName` — never the slug. */
  collectionName: string
  onClose: () => void
  now?: Date
  /** Curation actions; the menu portals into the lightbox content element. */
  actions?: PostCardActions
}

export function LightboxInfoPanel({
  post,
  collectionName,
  onClose,
  now,
  actions,
}: LightboxInfoPanelProps) {
  const meta = formatLightboxMeta(
    post,
    collectionName,
    now === undefined ? {} : { now }
  )
  const handle = displayHandle(post.username)
  const initial = (post.author.trim() || handle).charAt(0).toUpperCase()

  return (
    <aside
      data-testid="lightbox-info"
      className="relative flex w-full shrink-0 flex-col rounded-xl bg-surface-warm p-[22px] md:h-auto md:w-[330px]"
    >
      <button
        type="button"
        data-testid="lightbox-close"
        aria-label={LIGHTBOX_CLOSE_LABEL}
        onClick={onClose}
        className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-md text-[20px] leading-none font-normal text-muted transition-colors outline-none hover:bg-surface hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        ×
      </button>

      {actions === undefined ? null : (
        <div className="absolute top-4 right-12">
          <PostActionsMenu
            post={post}
            onRequestDelete={actions.onRequestDelete}
            onRequestMove={actions.onRequestMove}
            portalContainer={actions.portalContainer}
          />
        </div>
      )}

      <div className="flex items-center gap-2.5 pr-20">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] leading-none font-semibold text-muted"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p
            data-testid="lightbox-author"
            className="truncate text-[12.5px] leading-[1.35] font-semibold text-ink"
          >
            {post.author}
          </p>
          <p
            data-testid="lightbox-username"
            className="truncate text-[10.5px] leading-[1.4] text-muted"
          >
            {handle}
          </p>
        </div>
      </div>

      <div aria-hidden="true" className="mt-5 h-px w-full bg-border" />

      <ClampedPostText variant="lightbox" text={post.text} className="mt-5" />

      <div className="mt-auto pt-10">
        <div
          data-testid="lightbox-meta"
          className="tnum flex flex-col gap-0.5 border-t border-border pt-4 text-[10.5px] leading-[1.5] text-muted"
        >
          <p data-testid="lightbox-posted">{meta.posted}</p>
          <p data-testid="lightbox-saved">{meta.saved}</p>
          <p data-testid="lightbox-collection">{meta.collection}</p>
        </div>

        <a
          data-testid="lightbox-open-on-x"
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface text-[11.5px] leading-[1.4] font-semibold text-ink transition-colors outline-none hover:border-ink/25 focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {OPEN_ON_X_LABEL}
        </a>
      </div>
    </aside>
  )
}
