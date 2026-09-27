import { MediaImage } from "@/components/gallery/media-image"
import {
  mediaGridClassName,
  mediaTileClassName,
  selectMediaLayout,
} from "@/lib/post-media"
import { cn } from "@/lib/utils"

/**
 * Adaptive multi-media region for one post (PRD-2 §20, design spec §3.3).
 *
 * The card unit is the tweet, so **every** URL in `media` is rendered — never
 * only the first image:
 *
 *   1 → one natural-aspect tile
 *   2 → 50/50 side by side
 *   3 → wide tile on top + 2 below
 *   4+ → 2 columns × N rows (4 → 2×2, 5/6 → 2×3, …)
 *
 * Tiles are 6px apart and r14. Each goes through `MediaImage`, so the stored
 * `https://pbs.twimg.com/...` URL is used verbatim (no proxy, no cache, no
 * rewriting), the image is `loading="lazy"` + `decoding="async"`, and a broken
 * URL degrades to a same-box neutral gradient placeholder (PRD-2 §25/§62).
 */

export interface PostMediaGridProps {
  media: readonly string[]
  /** Stable key for the deterministic placeholder (usually the tweet id). */
  seed: string
  /** Contextual `alt` for tile `index` of `total` (author/tweet derived). */
  describeAlt: (index: number, total: number) => string
  className?: string
}

export function PostMediaGrid({
  media,
  seed,
  describeAlt,
  className,
}: PostMediaGridProps) {
  const layout = selectMediaLayout(media.length)

  return (
    <div
      data-testid="post-media-grid"
      data-media-layout={layout.kind}
      data-media-count={media.length}
      className={cn(mediaGridClassName(layout), className)}
    >
      {media.map((src, index) => (
        <MediaImage
          key={`${src}-${index}`}
          src={src}
          fallbackSeed={`${seed}:${index}`}
          alt={describeAlt(index, media.length)}
          className={mediaTileClassName(layout, index)}
        />
      ))}
    </div>
  )
}
