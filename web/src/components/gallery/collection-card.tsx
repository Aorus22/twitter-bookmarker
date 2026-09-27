import { Link } from "react-router-dom"

import { CollectionCover } from "@/components/gallery/collection-cover"
import { formatCollectionMeta } from "@/lib/collection-meta"
import type { GalleryCollection } from "@/types"

/**
 * One collection card (design spec §3.2, PRD-2 §16).
 *
 * `244×330`, `surface`, r20, hairline `border`, `shadow-card`; the collage is a
 * full-bleed top region so the tile corners are clipped by the card's r20.
 *
 * Content decisions, all recorded in the phase plan:
 *   - the meta row carries the PRD-required **last bookmarked date** as well as
 *     the post/media counts (`83 posts · 126 media · Last saved Sep 27`);
 *   - the mockup's one-line description is omitted (spec §7, no CSV field) and
 *     its slot shows the filename — real data, not invented copy;
 *   - the mockup's `•••` overflow control is omitted because no card action
 *     exists (PRD-2 §5, spec §7).
 *
 * The whole card is a single react-router `<Link>`, so it is keyboard reachable
 * and announcing as one destination (the accessible name repeats name + meta).
 */
export interface CollectionCardProps {
  collection: GalleryCollection
  /** Reference "today" for the year-aware date format; defaults to the clock. */
  now?: Date
}

export function CollectionCard({ collection, now }: CollectionCardProps) {
  const { filename, name, cover_media } = collection
  const displayName = name.trim() === "" ? filename : name
  const meta = formatCollectionMeta(collection, now ? { now } : {})
  const href = `/collections/${encodeURIComponent(filename)}`

  return (
    <li className="w-[244px] max-w-full" data-testid="collection-card">
      <Link
        to={href}
        aria-label={`${displayName}, ${meta}`}
        className="group flex h-[330px] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card transition-shadow outline-none hover:shadow-hero focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CollectionCover
          media={cover_media}
          seed={filename}
          className="h-[181px] w-full shrink-0"
        />

        <div className="flex min-h-0 flex-1 flex-col px-[18px] pt-[17px] pb-7">
          <h3 className="line-clamp-2 font-display text-[22px] leading-[1.2] font-bold text-ink">
            {displayName}
          </h3>
          <p className="mt-[7px] truncate text-[11px] leading-[1.45] text-muted">
            {filename}
          </p>
          <p className="mt-auto truncate text-[11px] leading-[1.4] font-medium text-muted">
            {meta}
          </p>
        </div>
      </Link>
    </li>
  )
}
