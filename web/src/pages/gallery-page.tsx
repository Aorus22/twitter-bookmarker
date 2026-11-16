import {
  CollectionCard,
  GalleryEmptyState,
  GalleryErrorState,
  GalleryHero,
  MasonrySkeleton,
} from "@/components/gallery"
import { useCollections } from "@/hooks"
import { formatCount } from "@/lib/collection-meta"

/**
 * Homepage route `/`.
 *
 * Masthead → collection index → one grid state:
 *   loading → card-shaped skeletons (never a blank page)
 *   error   → the connection copy with a working Retry
 *   success → cards, or the empty-archive state
 *
 * The ordering is fixed to `last_saved_at DESC` by the backend, so the label on
 * the right is static text, not a menu with one option.
 */
export function GalleryPage() {
  const { collections, status, errorMessage, refetch } = useCollections()

  return (
    <div className="flex flex-col gap-14 py-2">
      <GalleryHero collections={collections} />

      <section
        id="collections-grid"
        aria-labelledby="collections-heading"
        className="scroll-mt-24"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-3">
            <h2
              id="collections-heading"
              className="text-[20px]! leading-[1.2]! font-semibold tracking-[-0.02em] text-ink"
            >
              My Collections
            </h2>
            {status === "success" ? (
              <span className="tnum text-[11px] leading-[1.4] font-medium text-muted">
                {formatCount(collections.length, "collection")}
              </span>
            ) : null}
          </div>
          <span className="micro">Recently updated ▾</span>
        </div>

        <div className="mt-6">
          {status === "loading" ? <MasonrySkeleton /> : null}

          {status === "error" ? (
            <GalleryErrorState message={errorMessage} onRetry={refetch} />
          ) : null}

          {status === "success" && collections.length === 0 ? (
            <GalleryEmptyState />
          ) : null}

          {status === "success" && collections.length > 0 ? (
            <ul className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 xl:grid-cols-4">
              {collections.map((collection) => (
                <CollectionCard key={collection.slug} collection={collection} />
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <p className="border-t border-border/70 pt-6 text-[11px] leading-[1.4] text-muted">
        Local-only · Powered by your local archive · No cloud, no algorithmic
        feed
      </p>
    </div>
  )
}
