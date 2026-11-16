import { Button } from "@astryxdesign/core/Button"
import { SearchX } from "lucide-react"

import { Astryx } from "@/app/astryx"

import { GalleryStateCard } from "@/components/gallery/gallery-state-card"
import { CLEAR_FILTERS_LABEL, NO_FILTER_MATCH_TITLE } from "@/lib/messages"

/**
 * Filter-no-match state: zero results because of the active search/dates, with
 * a real `Clear filters` action. Deliberately distinct from the postless
 * collection copy.
 */
export interface CollectionFilterEmptyStateProps {
  onClearFilters: () => void
}

export function CollectionFilterEmptyState({
  onClearFilters,
}: CollectionFilterEmptyStateProps) {
  return (
    <GalleryStateCard
      testId="collection-filter-empty-state"
      title={NO_FILTER_MATCH_TITLE}
      icon={SearchX}
    >
      <Astryx>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          label={CLEAR_FILTERS_LABEL}
          data-testid="clear-filters"
          onClick={onClearFilters}
        />
      </Astryx>
    </GalleryStateCard>
  )
}
