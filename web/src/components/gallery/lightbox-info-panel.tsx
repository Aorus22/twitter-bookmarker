import { ClampedPostText } from "@/components/gallery/clamped-post-text"
import { displayHandle, formatLightboxMeta } from "@/lib/post-meta"
import {
  LIGHTBOX_CLOSE_LABEL,
  OPEN_ON_X_LABEL,
} from "@/lib/messages"
import type { GalleryPost } from "@/types"

/**
 * The lightbox metadata panel (LIGHT-01/LIGHT-02, PRD-2 §26, design spec §3.5).
 *
 * `330×760`, r20, `surface-warm`, padding 22 on desktop; full width and
 * auto-height when it stacks under the media below the breakpoint. Exactly the
 * five things PRD-2 §26 requires are present:
 *
 *   1. author Inter SemiBold 13 and `@username` Inter Regular 10 muted;
 *   2. the post text Inter Regular 13 `ink`, clamped with a working
 *      `Show more` (the Phase 5 `ClampedPostText`, `lightbox` variant);
 *   3. the three-line meta block Inter Regular 10 muted — `Posted <date>` /
 *      `Saved <date>` / `Collection <name>` — where the collection name is the
 *      backend `DisplayName` the caller got from the posts hook;
 *   4. `Open on X ↗` as a real 286×42 r12 `surface`+border anchor to the stored
 *      URL with `target="_blank" rel="noopener noreferrer"`, pinned near the
 *      panel's bottom;
 *   5. the `×` close control (Inter Medium 22) at the panel's top-right.
 */
export interface LightboxInfoPanelProps {
  post: GalleryPost
  /** Backend collection `DisplayName` — never the filename. */
  collectionName: string
  /** Closes the lightbox (the `×` control). */
  onClose: () => void
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
}

export function LightboxInfoPanel({
  post,
  collectionName,
  onClose,
  now,
}: LightboxInfoPanelProps) {
  const meta = formatLightboxMeta(
    post,
    collectionName,
    now === undefined ? {} : { now }
  )

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
        className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-sm text-[22px] leading-none font-medium text-muted outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        ×
      </button>

      <p
        data-testid="lightbox-author"
        className="pr-10 text-[13px] leading-[1.4] font-semibold text-ink"
      >
        {post.author}
      </p>
      <p
        data-testid="lightbox-username"
        className="text-[10px] leading-[1.4] text-muted"
      >
        {displayHandle(post.username)}
      </p>

      <ClampedPostText variant="lightbox" text={post.text} className="mt-4" />

      <div
        data-testid="lightbox-meta"
        className="mt-4 flex flex-col text-[10px] leading-[1.4] text-muted"
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
        className="mt-auto flex h-[42px] w-full items-center justify-center rounded-sm border border-border bg-surface text-[12px] leading-[1.4] font-semibold text-ink outline-none transition-colors hover:bg-surface-warm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {OPEN_ON_X_LABEL}
      </a>
    </aside>
  )
}
