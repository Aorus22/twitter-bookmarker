import { Link, useParams } from "react-router-dom"

/**
 * Collection route `/collections/:filename`.
 *
 * Phase 5 replaces this body with the header, toolbar and masonry (design spec
 * §3.3) and starts calling `fetchPosts(filename, …)`. For now it proves the
 * dynamic segment resolves and renders the back link from PRD-2 §65.
 */
export function CollectionPage() {
  const { filename } = useParams<{ filename: string }>()

  return (
    <section aria-labelledby="collection-heading" className="py-4">
      <Link
        to="/"
        className="text-[11px] leading-[1.4] font-medium text-muted outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        ← Collections
      </Link>

      <header className="mt-6 flex items-start gap-6">
        <span
          aria-hidden="true"
          className="size-24 shrink-0 rounded-2xl bg-grad-brand"
        />
        <div className="min-w-0">
          <h1
            id="collection-heading"
            className="text-[28px] leading-[1.1] font-bold break-words md:text-[38px]"
          >
            {filename ?? "Collection"}
          </h1>
          <p className="mt-2 text-xs leading-[1.45] text-muted">
            Toolbar and masonry arrive in Phase 5.
          </p>
        </div>
      </header>
    </section>
  )
}
