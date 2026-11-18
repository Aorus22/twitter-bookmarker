package model

// The collection resource. A collection is the backend's own record of a
// category: its slug (the public key), the display name the user typed, the
// colour every client renders, and the position it holds in the list.
//
// Colour and position live here rather than in any client's local storage
// because the category is shared: the browser extension, the phone and the web
// gallery all read the same `GET /v1/collections`, and a change made in one of
// them has to be the change the others see. An empty Color means "no colour
// chosen yet"; each client falls back to its own default constant so a category
// created by an older client still renders.

// DefaultCollectionColor is the colour a client shows for a collection whose
// Color is empty. It is published on the wire rather than only held in each
// client so the three of them cannot drift: the extension's
// DEFAULT_CATEGORY_COLOR, the web gallery's accent and the phone's fallback all
// mirror this value.
const DefaultCollectionColor = "#bf3f2e"

// MaxCollectionNameLen bounds a stored display name, in runes. The extension's
// own input is capped far lower (60 characters), so this only ever rejects
// something that did not come from the UI.
const MaxCollectionNameLen = 255

// Collection is one category: the JSON shape returned by the create, update and
// list endpoints, and the summary the gallery renders as a homepage card.
//
// PostCount, MediaCount, LastSavedAt and CoverMedia are derived from the
// collection's bookmarks. They are zero, zero, nil and empty for a category that
// exists but has never been saved into — which is now a normal state, because a
// category can be created before anything is saved to it.
type Collection struct {
	// Slug is the public key: what a save sends, what a gallery URL carries, and
	// what a rename recomputes. It is not a filename.
	Slug string `json:"slug"`
	// Name is the display name, exactly as the user typed it.
	Name string `json:"name"`
	// Color is `#rrggbb`, or "" when the user has not chosen one yet.
	Color string `json:"color"`
	// Order is the display position, dense from 0. Clients render in this order
	// and must not re-sort.
	Order int `json:"order"`
	// PostCount is how many live bookmarks the collection holds.
	PostCount int `json:"post_count"`
	// MediaCount is how many media URLs those bookmarks hold in total.
	MediaCount int `json:"media_count"`
	// LastSavedAt is the maximum saved_at as UTC RFC3339, or nil when the
	// collection has no valid rows. JSON is null in that case.
	LastSavedAt *string `json:"last_saved_at"`
	// CoverMedia holds up to four media URLs from the newest-by-saved_at rows,
	// newest first. It is never nil, so it always encodes as [].
	CoverMedia []string `json:"cover_media"`
}

// CollectionListResponse is the GET /v1/collections body.
//
// Collections is never nil, so an archive with no categories answers `[]` rather
// than `null` and a client never has to special-case the empty gallery.
type CollectionListResponse struct {
	Collections []Collection `json:"collections"`
}

// CreateCollectionRequest is the POST /v1/collections body.
//
// Only the name is required, and it is the caller's name, not a slug: the
// backend owns slugging now, so every client that can type a name can create a
// category without carrying its own slugify rules. Color is optional and empty
// means "the client's default".
type CreateCollectionRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// UpdateCollectionRequest is the PUT /v1/collections/{slug} body.
//
// Every field is optional and only the ones present change, which is what lets
// the same endpoint serve a rename, a colour change and a single position move.
// The fields are pointers because "not supplied" and "supplied as empty" differ:
// an empty Color is a real instruction (use the default), while an absent one
// leaves the stored colour alone.
type UpdateCollectionRequest struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
	Order *int    `json:"order"`
}

// CollectionResponse is the body of a successful create or update.
type CollectionResponse struct {
	Status     string     `json:"status"`
	Collection Collection `json:"collection"`
}

// ReorderCollectionsRequest is the PUT /v1/collections/order body: the complete
// list of slugs in their new order.
//
// A whole list rather than one position per request, because the client that
// reorders knows the order it just drew and can state it atomically; two
// half-applied moves would leave the list in a state no client chose.
type ReorderCollectionsRequest struct {
	Slugs []string `json:"slugs"`
}

// ReorderCollectionsResponse is the body of a successful reorder.
type ReorderCollectionsResponse struct {
	Status      string       `json:"status"`
	Collections []Collection `json:"collections"`
}
