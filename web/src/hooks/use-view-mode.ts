import { useCallback, useState } from "react"

import {
  readStoredViewMode,
  writeStoredViewMode,
  type GalleryViewMode,
} from "@/lib/view-mode"

export interface UseViewModeResult {
  viewMode: GalleryViewMode
  setViewMode: (mode: GalleryViewMode) => void
}

/**
 * The collection page's layout preference, persisted across visits.
 *
 * The stored value is read once in the state initialiser and written back in
 * the setter, so mounting never rewrites storage and the default mode does not
 * overwrite a saved preference.
 */
export function useViewMode(): UseViewModeResult {
  const [viewMode, setMode] = useState<GalleryViewMode>(readStoredViewMode)

  const setViewMode = useCallback((mode: GalleryViewMode) => {
    setMode(mode)
    writeStoredViewMode(mode)
  }, [])

  return { viewMode, setViewMode }
}
