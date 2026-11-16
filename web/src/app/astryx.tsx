import { Theme } from "@astryxdesign/core/theme"
import * as React from "react"

import { galleryTheme } from "@/app/astryx-theme"
import { useAstryxMode } from "@/app/use-astryx-mode"

/**
 * Astryx theme surface.
 *
 * Scoped to the controls that actually come from Astryx rather than wrapping
 * the whole app: Astryx's runtime theme emits heading rules that would otherwise
 * win over the page's own type scale. `mode` follows the app's resolved theme
 * when a provider is present, and falls back to `system` in isolated renders.
 */
export function Astryx({
  children,
  mode,
}: {
  children: React.ReactNode
  mode?: "light" | "dark" | "system"
}) {
  const resolved = useAstryxMode()
  return (
    <Theme theme={galleryTheme} mode={mode ?? resolved}>
      {children}
    </Theme>
  )
}
