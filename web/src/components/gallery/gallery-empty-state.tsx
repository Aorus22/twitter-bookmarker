import { Images } from "lucide-react"

import { GalleryStateCard } from "@/components/gallery/gallery-state-card"
import { NO_COLLECTIONS_MESSAGE, NO_COLLECTIONS_TITLE } from "@/lib/messages"

/**
 * Empty-archive state. The archive exists and the request succeeded; there is
 * simply nothing saved yet.
 */
export function GalleryEmptyState() {
  return (
    <GalleryStateCard
      testId="gallery-empty-state"
      title={NO_COLLECTIONS_TITLE}
      message={NO_COLLECTIONS_MESSAGE}
      icon={Images}
    />
  )
}
