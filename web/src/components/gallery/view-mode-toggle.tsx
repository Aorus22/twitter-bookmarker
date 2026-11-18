import { Columns3, Grid2x2, Rows3 } from "lucide-react"

import { VIEW_MODE_LABEL } from "@/lib/messages"
import { VIEW_MODES, type GalleryViewMode } from "@/lib/view-mode"
import { cn } from "@/lib/utils"

/**
 * Segmented layout switcher for the collection toolbar (owner request, Nov 2026).
 *
 * Three icon buttons rather than a menu: there are only three modes, the choice
 * is made often, and a menu would hide two thirds of it behind a click. Each
 * button is a real toggle (`aria-pressed`) with its own accessible name, because
 * the visual content is an icon only.
 *
 * Rendered as a group so a screen reader hears "Layout, group" around the three
 * toggle buttons instead of three unrelated controls.
 */

const ICONS = {
  masonry: Columns3,
  grid: Grid2x2,
  rows: Rows3,
} as const

export interface ViewModeToggleProps {
  value: GalleryViewMode
  onChange: (mode: GalleryViewMode) => void
  className?: string
}

export function ViewModeToggle({
  value,
  onChange,
  className,
}: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label={VIEW_MODE_LABEL}
      data-testid="view-mode-toggle"
      className={cn(
        "flex h-10 shrink-0 items-center gap-0.5 rounded-sm border border-border bg-surface p-1",
        className
      )}
    >
      {VIEW_MODES.map((option) => {
        const Icon = ICONS[option.value]
        const active = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            data-testid={`view-mode-${option.value}`}
            data-active={active}
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => {
              onChange(option.value)
            }}
            className={cn(
              "flex size-8 items-center justify-center rounded-[8px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-surface-warm text-accent"
                : "text-muted hover:text-ink"
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
