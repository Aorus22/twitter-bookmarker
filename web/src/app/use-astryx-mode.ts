import * as React from "react"

import { ThemeProviderContext } from "@/app/theme-provider"

/** The app's resolved theme, or `system` when rendered outside the provider. */
export function useAstryxMode(): "light" | "dark" | "system" {
  const context = React.useContext(ThemeProviderContext)
  return context?.resolvedTheme ?? "system"
}
