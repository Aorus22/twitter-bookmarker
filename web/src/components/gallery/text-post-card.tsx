import { ClampedPostText } from "@/components/gallery/clamped-post-text"
import { cn } from "@/lib/utils"

/**
 * Text-only tweet treatment.
 *
 * A post with no media gets a paper panel in the media slot rather than an
 * artificial image or a gradient: the text *is* the content, set a little
 * larger and with a hairline around it. The panel carries no image semantics.
 */
export interface TextPostCardProps {
  text: string
  /** Stable key; kept for callers that still pass the tweet id. */
  seed?: string
  className?: string
}

export function TextPostCard({ text, className }: TextPostCardProps) {
  return (
    <div
      data-testid="text-post-card"
      className={cn(
        "relative flex min-h-[190px] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-warm p-5",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="mb-3 block h-px w-6 bg-ink/25"
      />
      <ClampedPostText text={text} variant="quote" />
    </div>
  )
}
