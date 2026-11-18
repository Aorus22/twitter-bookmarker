import { Button } from "@astryxdesign/core/Button"
import { TriangleAlert } from "lucide-react"

import { Astryx } from "@/app/astryx"

import { RETRY_LABEL } from "@/lib/messages"

/**
 * Error state with a working retry action. The caller supplies the exact
 * connection/load message, which is rendered verbatim as the heading.
 */
export interface GalleryErrorStateProps {
  /** Exact PRD copy for the failure, e.g. the §61 connection message. */
  message: string
  onRetry: () => void
}

export function GalleryErrorState({
  message,
  onRetry,
}: GalleryErrorStateProps) {
  return (
    <section
      role="alert"
      aria-labelledby="gallery-error-heading"
      data-testid="gallery-error-state"
      className="flex w-full max-w-[390px] flex-col rounded-xl border border-border bg-surface p-6"
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-warm text-muted"
      >
        <TriangleAlert className="size-4" />
      </span>
      <h2
        id="gallery-error-heading"
        className="mt-5 text-[17px]! leading-[1.35]! font-semibold tracking-[-0.01em] text-ink"
      >
        {message}
      </h2>
      <div className="mt-5">
        <Astryx>
          <Button
            type="button"
            variant="secondary"
            size="md"
            label={RETRY_LABEL}
            className="rounded-md border border-border bg-surface px-3"
            onClick={onRetry}
          />
        </Astryx>
      </div>
    </section>
  )
}
