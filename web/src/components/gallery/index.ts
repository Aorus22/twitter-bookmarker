/**
 * `@/components/gallery` barrel — the homepage gallery surface.
 *
 * Exported for Phases 5–8: the collection cover and the media-image primitive
 * are reused by the collection page, and the empty/error states are reused by
 * every gallery route.
 */
export { CollectionCard } from "./collection-card"
export { CollectionCover } from "./collection-cover"
export { CollectionCardSkeleton, MasonrySkeleton } from "./collection-skeleton"
export { GalleryEmptyState } from "./gallery-empty-state"
export { GalleryErrorState } from "./gallery-error-state"
export { GalleryHero, HeroArt } from "./gallery-hero"
export { MediaImage } from "./media-image"
