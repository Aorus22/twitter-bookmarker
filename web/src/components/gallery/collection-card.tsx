import { Bookmark, EyeOff } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"

import { CollectionCover } from "@/components/gallery/collection-cover"
import {
  formatCollectionMeta,
  formatCount,
  normalizeCount,
} from "@/lib/collection-meta"
import { NSFW_LABEL, NSFW_REVEAL_LABEL } from "@/lib/messages"
import { isNsfwCollection } from "@/lib/nsfw"
import { cn } from "@/lib/utils"
import type { GalleryCollection } from "@/types"

/**
 * One collection in the index.
 *
 * The cover is the card: a 4:3 collage, a hairline, and the name underneath. No
 * floating panel, no shadow, no repeated description line — the meta row already
 * carries the only facts the archive has. The bookmark total is repeated as a
 * small chip over the art because "how many are in here" is the thing people
 * scan a folder for; it is `aria-hidden` because the link's name already
 * contains the count.
 *
 * **NSFW guard** (owner request, Nov 2026): when the collection title carries
 * `nsfw` (`isNsfwCollection`), the cover collage is blurred and a chip explains
 * why. Revealing is a per-card, per-visit choice — a `<button>` laid *over* the
 * cover, not inside the `<Link>` (a button inside an anchor is invalid and
 * breaks the link's keyboard semantics). The rest of the card still navigates.
 */
export interface CollectionCardProps {
  collection: GalleryCollection
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
}

export function CollectionCard({ collection, now }: CollectionCardProps) {
  const { slug, name, cover_media } = collection
  const displayName = name.trim() === "" ? slug : name
  const meta = formatCollectionMeta(collection, now ? { now } : {})
  const postCount = normalizeCount(collection.post_count)
  const href = `/collections/${encodeURIComponent(slug)}`

  const nsfw = isNsfwCollection(collection)
  const [revealed, setRevealed] = useState(false)
  const coverHidden = nsfw && !revealed

  return (
    <li
      className="relative min-w-0"
      data-testid="collection-card"
      data-nsfw={nsfw ? "true" : undefined}
      data-revealed={coverHidden ? undefined : nsfw ? "true" : undefined}
    >
      <Link
        to={href}
        aria-label={`${displayName}, ${meta}`}
        className="group block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-surface-warm">
          <CollectionCover
            media={cover_media}
            seed={slug}
            className={cn(
              "size-full transition-[filter,transform] duration-300 ease-out",
              coverHidden
                ? "scale-105 blur-xl"
                : "group-hover:scale-[1.015]"
            )}
          />

          <span
            aria-hidden="true"
            data-testid="collection-card-count"
            title={formatCount(postCount, "post")}
            className="tnum absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[10px] leading-none font-semibold text-white backdrop-blur-sm"
          >
            <Bookmark className="size-2.5" fill="currentColor" />
            {postCount}
          </span>
        </div>

        <div className="mt-3 min-w-0">
          <h3 className="truncate text-[14.5px] leading-[1.35] font-semibold tracking-[-0.01em] text-ink">
            {displayName}
          </h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] font-medium text-muted">
            {meta}
          </p>
        </div>
      </Link>

      {coverHidden ? (
        <button
          type="button"
          data-testid="collection-nsfw-reveal"
          aria-label={`${NSFW_REVEAL_LABEL}: ${displayName}`}
          onClick={() => {
            setRevealed(true)
          }}
          className="absolute inset-x-0 top-0 z-10 flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg transition-colors outline-none hover:bg-black/20 focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[10px] leading-[1.2] font-semibold tracking-[0.08em] text-white uppercase">
            <EyeOff className="size-3.5" aria-hidden="true" />
            {NSFW_LABEL}
          </span>
          <span className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] leading-[1.2] font-medium text-white backdrop-blur-sm">
            {NSFW_REVEAL_LABEL}
          </span>
        </button>
      ) : null}
    </li>
  )
}
