import type { CSSProperties } from "react"

import { MediaImage } from "@/components/gallery/media-image"
import {
  selectCoverLayout,
  sliceCoverMedia,
  type CoverLayoutKind,
} from "@/lib/cover"
import { pickPlaceholderGradient } from "@/lib/placeholder"
import { cn } from "@/lib/utils"

/**
 * Adaptive collection cover collage (PRD-2 §17, design spec §3.2).
 *
 * The region is the card's full-bleed top: two grid tracks with a 5px gap and
 * r14 tiles. The outer r20 top corners come from the card's `overflow-hidden`,
 * so this component never has to know the card's radius.
 *
 * Layout selection is delegated to `selectCoverLayout` — pure and unit-tested —
 * and is based on the number of *usable* cover images. `cover_media` is already
 * ordered `saved_at` DESC by the backend, so the first four entries are the four
 * newest and are used as-is (`sliceCoverMedia`).
 */

export interface CollectionCoverProps {
  media: readonly string[]
  /** Stable key for the placeholder gradient (usually the collection slug). */
  seed: string
  className?: string
}

/** Grid placement for tile `index` under each layout kind. */
function tileSpanClass(kind: CoverLayoutKind, index: number): string {
  switch (kind) {
    case "single":
      return "col-span-2 row-span-2"
    case "stack":
      return "col-span-2"
    case "feature":
      return index === 2 ? "col-span-2" : ""
    case "quad":
    case "placeholder":
      return ""
  }
}

const REGION_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gridTemplateRows: "repeat(2, minmax(0, 1fr))",
  gap: "3px",
}

export function CollectionCover({
  media,
  seed,
  className,
}: CollectionCoverProps) {
  const tiles = sliceCoverMedia(media)
  const layout = selectCoverLayout(tiles.length)
  const placeholder = pickPlaceholderGradient(seed)

  return (
    <div
      aria-hidden="true"
      data-testid="collection-cover"
      data-cover-layout={layout.kind}
      style={REGION_STYLE}
      className={cn("overflow-hidden", className)}
    >
      {layout.kind === "placeholder" ? (
        <span
          data-testid="cover-placeholder"
          className="col-span-2 row-span-2 flex items-center justify-center"
          style={{ backgroundImage: placeholder.value }}
        >
          <span className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink/35">
            {(seed.replace(/[^a-zA-Z0-9]/g, " ").trim().charAt(0) || "·").toUpperCase()}
          </span>
        </span>
      ) : (
        tiles.map((src, index) => (
          <MediaImage
            key={`${src}-${index}`}
            src={src}
            fallbackSeed={`${seed}:${index}`}
            className={cn(
              "h-full w-full rounded-[4px]",
              tileSpanClass(layout.kind, index)
            )}
          />
        ))
      )}
    </div>
  )
}
