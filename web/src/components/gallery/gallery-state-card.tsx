import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Shared product-state panel: a quiet bordered surface, a hairline icon tile,
 * and the copy. Used by the postless-collection and filter-no-match states so
 * the two stay visually identical while keeping their distinct copy and action.
 */
export interface GalleryStateCardProps {
  title: string
  message?: string
  icon: LucideIcon
  /** Stable key, kept for callers that still pass a seed. */
  seed?: string
  children?: ReactNode
  testId: string
}

export function GalleryStateCard({
  title,
  message,
  icon: Icon,
  children,
  testId,
}: GalleryStateCardProps) {
  return (
    <section
      data-testid={testId}
      className="flex w-full max-w-[390px] flex-col rounded-xl border border-border bg-surface p-6"
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-warm text-muted"
      >
        <Icon className="size-4" />
      </span>
      <h2 className="mt-5 text-[17px]! leading-[1.3]! font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {message === undefined ? null : (
        <p className={cn("mt-1.5 text-[12px] leading-[1.55] text-muted")}>
          {message}
        </p>
      )}
      {children === undefined || children === null ? null : (
        <div className="mt-5">{children}</div>
      )}
    </section>
  )
}
