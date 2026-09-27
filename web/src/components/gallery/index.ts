/**
 * `@/components/gallery` barrel — the gallery surface for every route.
 *
 * Exported for Phases 5–8: the collection cover and the media-image primitive
 * are reused by the collection page, the empty/error states are reused by every
 * gallery route, and the masonry/post-card/toolbar surface is the collection
 * page's public seam (Phase 6 extends the toolbar, Phase 7 the masonry,
 * Phase 8 the post media).
 */
export { ClampedPostText } from "./clamped-post-text"
export { CollectionCard } from "./collection-card"
export { CollectionCover } from "./collection-cover"
export { CollectionEmptyState } from "./collection-empty-state"
export { CollectionFilterEmptyState } from "./collection-filter-empty-state"
export { CollectionCardSkeleton, MasonrySkeleton } from "./collection-skeleton"
export { CollectionToolbar } from "./collection-toolbar"
export type { CollectionToolbarProps } from "./collection-toolbar"
export { GalleryEmptyState } from "./gallery-empty-state"
export { GalleryErrorState } from "./gallery-error-state"
export { GalleryHero, HeroArt } from "./gallery-hero"
export { GalleryMasonry } from "./gallery-masonry"
export type { GalleryMasonryProps } from "./gallery-masonry"
export { GalleryStateCard } from "./gallery-state-card"
export { MediaImage } from "./media-image"
export { PostCard } from "./post-card"
export type { PostCardProps } from "./post-card"
export { PostMediaGrid } from "./post-media-grid"
export type { PostMediaGridProps } from "./post-media-grid"
export { TextPostCard } from "./text-post-card"
export type { TextPostCardProps } from "./text-post-card"
