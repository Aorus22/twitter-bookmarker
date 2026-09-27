import { Badge } from "@/components/ui/badge"

/**
 * Homepage route `/`.
 *
 * Phase 4 replaces this body with the hero, section header and collection grid
 * (design spec §3.2). For now it renders the hero copy so the Editorial
 * typography scale and tokens are visibly wired.
 */
export function GalleryPage() {
  return (
    <section aria-labelledby="gallery-heading" className="py-4">
      <p className="text-[10px] leading-[1.4] font-semibold tracking-[0.12em] text-accent uppercase">
        Your Twitter archive, reimagined
      </p>
      <h1
        id="gallery-heading"
        className="mt-3 max-w-[520px] text-[46px] leading-[1.05] font-bold"
      >
        Save. Organize.
        <br />
        Relive inspiration.
      </h1>
      <p className="mt-4 max-w-[510px] text-sm leading-[1.45] text-muted">
        Every collection in your local CSV archive, rendered as a gallery. No
        cloud, no algorithmic feed — just your saved things.
      </p>
      <div className="mt-6">
        <Badge variant="secondary">Collection grid arrives in Phase 4</Badge>
      </div>
    </section>
  )
}
