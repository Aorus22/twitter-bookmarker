import { Bookmark } from "lucide-react"
import { Link } from "react-router-dom"

import { CollectionCover } from "@/components/gallery/collection-cover"
import {
  formatCollectionMeta,
  formatCount,
  normalizeCount,
} from "@/lib/collection-meta"
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

  return (
    <li className="min-w-0" data-testid="collection-card">
      <Link
        to={href}
        aria-label={`${displayName}, ${meta}`}
        className="group block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-surface-warm">
          <CollectionCover
            media={cover_media}
            seed={slug}
            className="size-full transition-transform duration-300 ease-out group-hover:scale-[1.015]"
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
    </li>
  )
}
