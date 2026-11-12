package api

import (
	"net/http"

	"twitter-bookmarker/internal/gallery"
	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

// The collection resource: the endpoints that let a client *ask for* a category
// to exist or to change.
//
// Before this, categories were created only as a side effect of saving a bookmark
// into one, and renamed only by saving into the same slug with a new name. The
// browser extension owned the list in `chrome.storage.local`. Now the backend owns
// it: `collections` is the same table the gallery already read, so there is one
// list, one order and one colour, and every client reads it.
//
// These handlers sit on /v1/ next to the save that created a bookmark, and not
// under /api/gallery, because that API is GET-only by contract (API-07): a
// category change is a user-initiated mutation, exactly like a delete or a move.
//
// Every handler answers with the *same* collection shape the gallery homepage
// renders, summaries included, so a client that just created a category can show
// its card without a second request. The catalog half comes from the store and the
// derived half from the gallery reader; neither can be trusted to build the other.

// handleCollectionsRoute dispatches /v1/collections by method: GET lists, POST
// creates.
//
// The gate in server.go has already rejected anything else, so the default branch
// is unreachable; it exists because a handler that returns without writing would
// leave the request hanging if it ever were reached.
func (s *server) handleCollectionsRoute(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		s.handleCollections(w, r)
	case http.MethodPost:
		s.handleCreateCollection(w, r)
	default:
		w.Header().Set("Allow", "GET, HEAD, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleCollections answers GET /v1/collections with every category, in order.
func (s *server) handleCollections(w http.ResponseWriter, r *http.Request) {
	store, ok := s.collectionStore(w)
	if !ok {
		return
	}

	collections, err := store.ListCollections()
	if err != nil {
		s.writeCurationError(w, err, "list collections")
		return
	}
	writeJSON(w, http.StatusOK, model.CollectionListResponse{
		Collections: s.withSummaries(collections),
	})
}

// handleCreateCollection answers POST /v1/collections with 201.
//
// The request carries a *name*, not a slug: the backend derives the key, which is
// what makes the three clients agree on it. The derived slug is what can conflict,
// so a second "Linux" is a 409 rather than a second folder.
func (s *server) handleCreateCollection(w http.ResponseWriter, r *http.Request) {
	store, ok := s.collectionStore(w)
	if !ok {
		return
	}

	var req model.CreateCollectionRequest
	if reason, logReason := decodeJSONBody(w, r, &req); reason != "" {
		s.log.InvalidRequest(logReason)
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{Status: "error", Reason: reason})
		return
	}

	slug, err := storage.Slugify(req.Name)
	if err != nil {
		s.writeCurationError(w, err, "create collection")
		return
	}

	created, err := store.CreateCollection(slug, req.Name, req.Color)
	if err != nil {
		s.writeCurationError(w, err, "create collection")
		return
	}

	writeJSON(w, http.StatusCreated, model.CollectionResponse{
		Status:     "created",
		Collection: s.summaryFor(created),
	})
}

// handleUpdateCollection answers PUT /v1/collections/{slug}.
//
// One endpoint serves a rename, a colour change and a position move, because they
// are all "this collection, changed": a separate path per field would be three
// routes to keep in step and one more place to forget the slug validation.
func (s *server) handleUpdateCollection(w http.ResponseWriter, r *http.Request) {
	store, ok := s.collectionStore(w)
	if !ok {
		return
	}

	slug := r.PathValue("slug")
	if err := storage.ValidateSlug(slug); err != nil {
		s.writeValidationReason(w, err)
		return
	}

	var req model.UpdateCollectionRequest
	if reason, logReason := decodeJSONBody(w, r, &req); reason != "" {
		s.log.InvalidRequest(logReason)
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{Status: "error", Reason: reason})
		return
	}

	patch := storage.CollectionPatch{Color: req.Color, Order: req.Order}
	if req.Name != nil {
		name := *req.Name
		patch.Name = &name
	}

	updated, err := store.UpdateCollection(slug, patch)
	if err != nil {
		s.writeCurationError(w, err, "update collection")
		return
	}

	writeJSON(w, http.StatusOK, model.CollectionResponse{
		Status:     "updated",
		Collection: s.summaryFor(updated),
	})
}

// handleReorderCollections answers PUT /v1/collections/order.
//
// The body is the whole order, not one position, so the list can never be left
// half-arranged: two clients reordering at once is the case this shape rules out.
func (s *server) handleReorderCollections(w http.ResponseWriter, r *http.Request) {
	store, ok := s.collectionStore(w)
	if !ok {
		return
	}

	var req model.ReorderCollectionsRequest
	if reason, logReason := decodeJSONBody(w, r, &req); reason != "" {
		s.log.InvalidRequest(logReason)
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{Status: "error", Reason: reason})
		return
	}

	ordered, err := store.ReorderCollections(req.Slugs)
	if err != nil {
		s.writeCurationError(w, err, "reorder collections")
		return
	}

	writeJSON(w, http.StatusOK, model.ReorderCollectionsResponse{
		Status:      "ordered",
		Collections: s.withSummaries(ordered),
	})
}

// collectionStore returns the collection surface, or writes the 500 and reports
// false.
//
// The type assertion exists so this file did not have to grow BookmarkStore, which
// every test double implements: a handler that needs collections declares that
// need here, and a store built for saving alone keeps compiling.
func (s *server) collectionStore(w http.ResponseWriter) (CollectionStore, bool) {
	store, ok := s.store.(CollectionStore)
	if !ok || store == nil {
		writeNoStore(w)
		return nil, false
	}
	return store, true
}

// withSummaries attaches the gallery's derived fields to catalog rows, keeping the
// catalog's order. A collection the gallery cannot describe (it was renamed
// between the two reads) still gets a card, just without counts, rather than
// disappearing from the list the user is looking at.
func (s *server) withSummaries(collections []model.Collection) []model.Collection {
	out := make([]model.Collection, 0, len(collections))
	summaries := s.gallerySummaries()
	for _, collection := range collections {
		if summary, ok := summaries[collection.Slug]; ok {
			collection.PostCount = summary.PostCount
			collection.MediaCount = summary.MediaCount
			collection.LastSavedAt = summary.LastSavedAt
			collection.CoverMedia = summary.CoverMedia
		} else if collection.CoverMedia == nil {
			collection.CoverMedia = []string{}
		}
		out = append(out, collection)
	}
	return out
}

// summaryFor is withSummaries for a single collection.
func (s *server) summaryFor(collection model.Collection) model.Collection {
	return s.withSummaries([]model.Collection{collection})[0]
}

// gallerySummaries reads the homepage projection keyed by slug. A failure is not
// fatal to a collection response: the catalog half is the part the caller asked
// for, and the summaries are additive. The real error still reaches the log.
func (s *server) gallerySummaries() map[string]model.Collection {
	summaries := map[string]model.Collection{}
	reader, err := gallery.NewFromConfig(s.log)
	if err != nil {
		s.log.FilesystemError("collections summaries", err)
		return summaries
	}
	collections, err := reader.Collections()
	if err != nil {
		s.log.FilesystemError("collections summaries", err)
		return summaries
	}
	for _, collection := range collections {
		summaries[collection.Slug] = collection
	}
	return summaries
}

// compile-time proof that the concrete store satisfies the collection surface.
var _ CollectionStore = (*storage.Store)(nil)
