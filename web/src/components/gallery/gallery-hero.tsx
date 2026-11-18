import { ArrowUpRight, Bookmark } from "lucide-react"

import { MediaImage } from "@/components/gallery/media-image"
import { formatCount, sumCounts } from "@/lib/collection-meta"
import { sliceCoverMedia } from "@/lib/cover"
import { isNsfwCollection } from "@/lib/nsfw"
import { cn } from "@/lib/utils"
import type { GalleryCollection } from "@/types"

/**
 * Homepage masthead.
 *
 * The archive speaks for itself, so the hero is type and a small strip of the
 * newest covers rather than a gradient panel. The counts are set as the
 * caption line, which is the only place the whole archive is summed.
 */

export interface HeroArtProps {
  media: readonly string[]
  caption?: string
  className?: string
}

export function HeroArt({ media, className }: HeroArtProps) {
  // Three tiles: one tall feature and two stacked. A fourth would be a tile
  // with nowhere to go in the 3×2 frame.
  const tiles = sliceCoverMedia(media).slice(0, 3)

  return (
    <div
      data-testid="hero-art"
      className={cn(
        "grid h-[248px] w-full grid-cols-3 grid-rows-2 gap-1.5 overflow-hidden rounded-xl border border-border bg-surface-warm sm:h-[280px] lg:h-[264px]",
        className
      )}
    >
      {tiles.length === 0 ? (
        <span
          aria-hidden="true"
          className="col-span-3 row-span-2 flex flex-col items-center justify-center gap-3 bg-surface-warm text-muted"
        >
          <Bookmark className="size-5" strokeWidth={1.4} />
          <span className="micro">No covers yet</span>
        </span>
      ) : (
        tiles.map((src, index) => (
          <MediaImage
            key={`${src}-${index}`}
            src={src}
            fallbackSeed={`gallery-hero-art:${index}`}
            loading="eager"
            className={cn(
              "size-full",
              index === 0 ? "col-span-2 row-span-2" : ""
            )}
          />
        ))
      )}
    </div>
  )
}

export interface GalleryHeroProps {
  collections: readonly GalleryCollection[]
}

export function GalleryHero({ collections }: GalleryHeroProps) {
  // An NSFW collection's covers are blurred on its own card, so its media must
  // not reappear unblurred in the hero collage. Excluded here rather than
  // filtered per tile: the hero is one composition, and a half-blurred mosaic
  // would read as a rendering fault.
  const media = sliceCoverMedia(
    collections
      .filter((collection) => !isNsfwCollection(collection))
      .flatMap((collection) => collection.cover_media)
  )
  const mediaTotal = sumCounts(collections, (c) => c.media_count)
  const postTotal = sumCounts(collections, (c) => c.post_count)
  const caption =
    collections.length === 0
      ? "Your local archive"
      : [
          formatCount(collections.length, "collection"),
          formatCount(postTotal, "post"),
          formatCount(mediaTotal, "media", "media"),
        ].join(" · ")

  return (
    <section
      aria-labelledby="gallery-heading"
      data-testid="gallery-hero"
      className="grid gap-8 border-b border-border pb-10 sm:gap-10 sm:pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-end lg:gap-16"
    >
      <div className="min-w-0">
        <p className="micro">Local archive</p>
        <h1
          id="gallery-heading"
          className="mt-4 max-w-[620px] text-[38px]! leading-[1.0]! font-semibold tracking-[-0.04em] text-ink sm:text-[44px]! md:text-[56px]! md:tracking-[-0.045em]"
        >
          Save. Organize.
          <br />
          Relive inspiration.
        </h1>
        <p className="mt-6 max-w-[440px] text-[14px] leading-[1.65] text-muted">
          Every collection in your local archive, rendered as a gallery. No
          cloud, no algorithmic feed — just your saved things.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <a
            href="#collections-grid"
            className="group inline-flex items-center gap-1.5 rounded-sm text-[13px] leading-[1.4] font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <span className="border-b border-ink/30 pb-0.5 transition-colors group-hover:border-ink">
              Explore gallery
            </span>
            <ArrowUpRight
              aria-hidden="true"
              className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </a>
          <p className="tnum text-[12px] leading-[1.4] text-muted">{caption}</p>
        </div>
      </div>

      <HeroArt media={media} />
    </section>
  )
}
