import { MediaImage } from "@/components/gallery/media-image"
import { cn } from "@/lib/utils"

/**
 * Square media thumbnail for the compact layouts (owner request, Nov 2026).
 *
 * Grid tiles and list rows show **one** frame per post instead of the whole
 * adaptive media region: a `+N` chip says how many more images the tweet has,
 * and opening the thumbnail enters the lightbox at the first one, where the rest
 * are one arrow key away.
 *
 * Follows the same interaction contract as `PostMediaGrid`: with `onOpenMedia`
 * the thumbnail is a real focusable button named from the post's author; without
 * it, a static image that keeps its own `alt`.
 */
export interface PostMediaThumbProps {
  media: readonly string[]
  /** Stable key for the deterministic placeholder (usually the tweet id). */
  seed: string
  /** Accessible name for the thumbnail (composed by the caller). */
  label: string
  onOpenMedia?: (mediaIndex: number, trigger: HTMLButtonElement) => void
  className?: string
}

export function PostMediaThumb({
  media,
  seed,
  label,
  onOpenMedia,
  className,
}: PostMediaThumbProps) {
  const src = media[0] ?? ""
  const extra = Math.max(0, media.length - 1)

  const content = (
    <>
      <MediaImage
        src={src}
        fallbackSeed={`${seed}:0`}
        alt={onOpenMedia === undefined ? label : ""}
        className="size-full transition-transform duration-200 group-hover:scale-[1.02]"
      />
      {extra === 0 ? null : (
        <span
          aria-hidden="true"
          data-testid="post-media-thumb-extra"
          className="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] leading-[1.2] font-semibold text-white"
        >
          +{extra}
        </span>
      )}
    </>
  )

  const base = cn(
    "relative aspect-square w-full overflow-hidden rounded-md",
    className
  )

  if (onOpenMedia === undefined) {
    return (
      <div data-testid="post-media-thumb" className={base}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid="post-media-thumb"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={(event) => {
        onOpenMedia(0, event.currentTarget)
      }}
      className={cn(
        base,
        "group block cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      )}
    >
      {content}
    </button>
  )
}
