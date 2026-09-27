import { useState } from "react"

import { SHOW_LESS_LABEL, SHOW_MORE_LABEL } from "@/lib/messages"
import { clampClassName, isLongPostText } from "@/lib/post-text"
import { cn } from "@/lib/utils"

/**
 * Controlled twitter-text clamp (PRD-2 §23, COLL-08).
 *
 * Short tweets render unchanged and with no affordance at all. Text longer than
 * {@link POST_TEXT_CLAMP_CHARS} collapses to `line-clamp-N` and gains a real
 * `<button>` that expands it **in place** — never an aggressive hard cut with
 * no escape. `aria-expanded` reports the state, and the button's label flips to
 * `Show less`.
 */

export interface ClampedPostTextProps {
  text: string
  /** `body` = Inter 11 ink paragraph; `quote` = Playfair 22 quote panel. */
  variant?: "body" | "quote"
  className?: string
}

export function ClampedPostText({
  text,
  variant = "body",
  className,
}: ClampedPostTextProps) {
  const [expanded, setExpanded] = useState(false)
  const needsAffordance = isLongPostText(text)
  // Short tweets are never clamped at all, so there is no hidden overflow and
  // no dead affordance; only genuinely long text collapses.
  const collapsed = needsAffordance && !expanded

  return (
    <div className={cn("min-w-0", className)}>
      <p
        data-testid="post-text"
        className={cn(
          "whitespace-pre-line",
          variant === "quote"
            ? "font-display text-[22px] leading-[1.35] text-white"
            : "text-[11px] leading-[1.45] text-ink",
          clampClassName(variant, !collapsed)
        )}
      >
        {text}
      </p>

      {needsAffordance ? (
        <button
          type="button"
          data-testid="post-text-toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current)
          }}
          className={cn(
            "mt-1.5 rounded-sm text-[10px] leading-[1.4] font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
            variant === "quote"
              ? "text-white/90 hover:text-white"
              : "text-accent hover:text-ink"
          )}
        >
          {expanded ? SHOW_LESS_LABEL : SHOW_MORE_LABEL}
        </button>
      ) : null}
    </div>
  )
}
