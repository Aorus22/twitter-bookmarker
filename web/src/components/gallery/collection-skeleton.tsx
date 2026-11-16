import { Skeleton } from "@astryxdesign/core/Skeleton"

import { Astryx } from "@/app/astryx"

/**
 * Card-shaped loading placeholders. The page never goes blank while a request
 * is in flight; the skeleton borrows the card's proportions so the layout does
 * not jump when the data lands.
 */
export function CollectionCardSkeleton() {
  return (
    <li data-testid="collection-card-skeleton" className="min-w-0">
      <div className="flex w-full flex-col rounded-xl border border-border bg-surface p-2">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface-warm">
          <Skeleton width="100%" height="100%" radius={2} index={0} />
        </div>
        <div className="mt-3 flex flex-col gap-2 px-1 pb-1">
          <Skeleton width="58%" height={11} radius={1} index={1} />
          <Skeleton width="82%" height={9} radius={1} index={2} />
        </div>
      </div>
    </li>
  )
}

export interface MasonrySkeletonProps {
  /** Number of placeholder cards; the default fills a desktop row. */
  count?: number
  /** Accessible label; the collection page announces `Loading posts`. */
  label?: string
}

export function MasonrySkeleton({
  count = 8,
  label = "Loading collections",
}: MasonrySkeletonProps) {
  return (
    <Astryx>
      <div role="status" aria-label={label}>
        <span className="sr-only">{label}…</span>
        <ul
          aria-hidden="true"
          className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: count }, (_, index) => (
            <CollectionCardSkeleton key={index} />
          ))}
        </ul>
      </div>
    </Astryx>
  )
}
