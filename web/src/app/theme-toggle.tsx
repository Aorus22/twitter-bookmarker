import { IconButton } from "@astryxdesign/core/IconButton"
import { Monitor, Moon, Sun } from "lucide-react"

import { Astryx } from "@/app/astryx"
import { useTheme, type Theme } from "@/hooks/use-theme"

const ORDER: readonly Theme[] = ["light", "dark", "system"]

const LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
}

function nextTheme(theme: Theme): Theme {
  const index = ORDER.indexOf(theme)
  return ORDER[(index + 1) % ORDER.length] ?? "system"
}

/**
 * Cycles light → dark → system. The control is a real button with an accessible
 * name and a tooltip title, so it stays keyboard reachable.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const next = nextTheme(theme)

  const Icon =
    theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun

  return (
    <span
      data-theme-preference={theme}
      data-theme-resolved={resolvedTheme}
    >
      <Astryx mode={resolvedTheme}>
        <span title={`Theme: ${LABELS[theme]} — switch to ${LABELS[next]}`}>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            icon={<Icon aria-hidden="true" className="size-4" />}
            label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]} theme.`}
            onClick={() => {
              setTheme(next)
            }}
          />
        </span>
      </Astryx>
    </span>
  )
}
