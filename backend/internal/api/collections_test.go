package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"twitter-bookmarker/internal/api"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
)

// The collection resource over HTTP. These tests are about the *contract*: what a
// client can ask for, what it gets back, and which status a refusal carries. The
// storage layer's own behaviour is covered in internal/storage.
//
// The server comes from newGalleryServer because these endpoints answer with the
// gallery's own card shape: the store and the per-request gallery reader have to
// resolve the same directory, or a created category would look empty.

// createCollection POSTs a category and fails the test unless it was a 201.
func createCollection(t *testing.T, h http.Handler, body string) model.Collection {
	t.Helper()
	rec := do(h, http.MethodPost, "/v1/collections", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create collection: status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
	}
	var got model.CollectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode create response %q: %v", rec.Body.String(), err)
	}
	return got.Collection
}

// listCollections reads GET /v1/collections.
func listCollections(t *testing.T, h http.Handler) []model.Collection {
	t.Helper()
	rec := do(h, http.MethodGet, "/v1/collections", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list collections: status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var got model.CollectionListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode list response %q: %v", rec.Body.String(), err)
	}
	return got.Collections
}

// TestCollectionsCreateListAndRename is the whole point of the resource: a client
// asks for a category, sees it in the list, renames it, and the bookmarks that were
// saved into it are still there afterwards.
func TestCollectionsCreateListAndRename(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	mustSave(t, h, "linux", "5001")

	// A category with nothing in it is a legitimate thing to create now: the
	// gallery used to only ever show collections a save had produced.
	created := createCollection(t, h, `{"name":"Read Later"}`)
	if created.Slug != "read-later" || created.Name != "Read Later" {
		t.Fatalf("created = %+v, want slug read-later and the name as typed", created)
	}
	if created.PostCount != 0 || created.CoverMedia == nil {
		t.Errorf("created = %+v, want a zero card with an empty cover_media array", created)
	}

	listed := listCollections(t, h)
	if len(listed) != 2 {
		t.Fatalf("collections = %d, want 2: %+v", len(listed), listed)
	}
	// linux was saved first, so it was created first and holds position 0.
	if listed[0].Slug != "linux" || listed[1].Slug != "read-later" {
		t.Errorf("order = %s,%s, want linux,read-later", listed[0].Slug, listed[1].Slug)
	}
	if listed[0].PostCount != 1 {
		t.Errorf("linux post_count = %d, want 1 (the endpoint reports the gallery card)", listed[0].PostCount)
	}

	// Rename through the API and check both halves: the response and the list.
	rec := do(h, http.MethodPut, "/v1/collections/read-later", `{"name":"Read It Later"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("rename: status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var renamed model.CollectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &renamed); err != nil {
		t.Fatalf("decode rename response %q: %v", rec.Body.String(), err)
	}
	if renamed.Collection.Slug != "read-it-later" {
		t.Errorf("renamed slug = %q, want read-it-later", renamed.Collection.Slug)
	}

	listed = listCollections(t, h)
	if listed[1].Name != "Read It Later" {
		t.Errorf("listed name = %q, want the new name", listed[1].Name)
	}
	// The saved bookmark did not move: a rename is not a data migration.
	if !collectionHas(t, h, "linux", "5001") {
		t.Error("the bookmark saved into linux disappeared after renaming a different collection")
	}
}

// TestCollectionsRenameCarriesTheBookmarks proves the slug rename is safe: the
// bookmark follows its collection, because the foreign key is the collection id.
func TestCollectionsRenameCarriesTheBookmarks(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	mustSave(t, h, "linux", "5002")

	rec := do(h, http.MethodPut, "/v1/collections/linux", `{"name":"Linux & BSD"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("rename: status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if !collectionHas(t, h, "linux-bsd", "5002") {
		t.Error("the bookmark did not follow its collection to the new slug")
	}
	// The old URL is gone rather than answering with the same posts.
	rec = do(h, http.MethodGet, "/api/gallery/collections/linux/posts", "")
	if rec.Code != http.StatusNotFound {
		t.Errorf("old slug status = %d, want 404", rec.Code)
	}
}

// TestCollectionsCarryColorAndOrder is the field contract the popup and the phone
// both read: colour is hex or empty, and the order the list comes back in is the
// order the user arranged.
func TestCollectionsCarryColorAndOrder(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	createCollection(t, h, `{"name":"One","color":"#BF3F2E"}`)
	createCollection(t, h, `{"name":"Two"}`)
	createCollection(t, h, `{"name":"Three"}`)

	listed := listCollections(t, h)
	if listed[0].Color != "#bf3f2e" {
		t.Errorf("color = %q, want it normalized to lower case", listed[0].Color)
	}
	for i, want := range []string{"one", "two", "three"} {
		if listed[i].Slug != want {
			t.Fatalf("position %d = %s, want %s", i, listed[i].Slug, want)
		}
		if listed[i].Order != i {
			t.Errorf("%s order = %d, want %d", want, listed[i].Order, i)
		}
	}

	// Reorder with the whole list, the way a drag-and-drop client sends it.
	rec := do(h, http.MethodPut, "/v1/collections/order", `{"slugs":["three","one","two"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reorder: status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var ordered model.ReorderCollectionsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &ordered); err != nil {
		t.Fatalf("decode reorder response %q: %v", rec.Body.String(), err)
	}
	if got := slugs(ordered.Collections); got != "three,one,two" {
		t.Errorf("reorder response = %s, want three,one,two", got)
	}
	// And the new order persists for the next reader, not just this response.
	if got := slugs(listCollections(t, h)); got != "three,one,two" {
		t.Errorf("listed order = %s, want three,one,two", got)
	}
}

// TestCollectionsColorCanBeCleared keeps "no colour chosen" expressible: an empty
// string is an instruction, not a missing field, so a client can go back to the
// default dot after picking one.
func TestCollectionsColorCanBeCleared(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	createCollection(t, h, `{"name":"One","color":"#bf3f2e"}`)
	rec := do(h, http.MethodPut, "/v1/collections/one", `{"color":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear color: status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if got := listCollections(t, h)[0].Color; got != "" {
		t.Errorf("color = %q, want empty", got)
	}
}

// TestCollectionsRejections pins every refusal to a status: a bad colour is a 400,
// an unknown slug is a 404, and a taken slug is a 409.
func TestCollectionsRejections(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	createCollection(t, h, `{"name":"Linux"}`)
	mustSave(t, h, "windows", "5003")

	cases := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"duplicate name", http.MethodPost, "/v1/collections", `{"name":"Linux"}`, http.StatusConflict},
		{"missing name", http.MethodPost, "/v1/collections", `{}`, http.StatusBadRequest},
		{"unslugifiable name", http.MethodPost, "/v1/collections", `{"name":"!!!"}`, http.StatusBadRequest},
		{"named colour", http.MethodPost, "/v1/collections", `{"name":"Blue","color":"blue"}`, http.StatusBadRequest},
		{"short hex", http.MethodPost, "/v1/collections", `{"name":"Blue","color":"#00f"}`, http.StatusBadRequest},
		{"malformed json", http.MethodPost, "/v1/collections", `{"name":`, http.StatusBadRequest},
		{"unknown slug rename", http.MethodPut, "/v1/collections/ghost", `{"name":"Ghost"}`, http.StatusNotFound},
		{"unknown slug colour", http.MethodPut, "/v1/collections/ghost", `{"color":"#ffffff"}`, http.StatusNotFound},
		{"rename onto a taken slug", http.MethodPut, "/v1/collections/windows", `{"name":"Linux"}`, http.StatusConflict},
		{"empty patch", http.MethodPut, "/v1/collections/linux", `{}`, http.StatusBadRequest},
		{"negative order", http.MethodPut, "/v1/collections/linux", `{"order":-1}`, http.StatusBadRequest},
		{"unsafe slug", http.MethodPut, "/v1/collections/..%2Fetc", `{"name":"X"}`, http.StatusBadRequest},
		{"reorder unknown", http.MethodPut, "/v1/collections/order", `{"slugs":["linux","ghost"]}`, http.StatusNotFound},
		{"reorder repeated", http.MethodPut, "/v1/collections/order", `{"slugs":["linux","linux"]}`, http.StatusBadRequest},
		{"reorder empty", http.MethodPut, "/v1/collections/order", `{"slugs":[]}`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(h, tc.method, tc.path, tc.body)
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d (body %s)", rec.Code, tc.want, rec.Body.String())
			}
			// Every refusal is the JSON error shape, never the SPA shell: a client
			// has to be able to read the reason.
			var body model.ErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("error body %q is not JSON: %v", rec.Body.String(), err)
			}
			if body.Status != "error" || body.Reason == "" {
				t.Errorf("error body = %+v, want status error and a reason", body)
			}
		})
	}

	// The rejected requests must not have rearranged anything.
	if got := slugs(listCollections(t, h)); got != "linux,windows" {
		t.Errorf("collections after rejections = %s, want linux,windows", got)
	}
}

// TestCollectionsMethodGate keeps the method surface closed: /v1/collections
// answers GET and POST only, the order route answers PUT only, and a wrong method
// is a 405 with an Allow header rather than a 404 or a 500.
func TestCollectionsMethodGate(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	createCollection(t, h, `{"name":"Linux"}`)

	cases := []struct {
		method string
		path   string
		want   string
	}{
		{http.MethodDelete, "/v1/collections", "GET, HEAD, POST"},
		{http.MethodPut, "/v1/collections", "GET, HEAD, POST"},
		{http.MethodPost, "/v1/collections/order", "PUT"},
		{http.MethodDelete, "/v1/collections/order", "PUT"},
		{http.MethodPost, "/v1/collections/linux", "PUT"},
		{http.MethodDelete, "/v1/collections/linux", "PUT"},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := do(h, tc.method, tc.path, "")
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want 405 (body %s)", rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Allow"); got != tc.want {
				t.Errorf("Allow = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestCollectionsUnknownSubPathIsAnAPI404 proves the new routes did not widen the
// catch-all: `/v1/collections/order/extra` is still a JSON 404, not the SPA.
func TestCollectionsUnknownSubPathIsAnAPI404(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	rec := do(h, http.MethodGet, "/v1/collections/linux/extra", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "json") {
		t.Errorf("Content-Type = %q, want JSON", ct)
	}
}

// TestCollectionsWithoutACollectionStoreIsA500 proves the route degrades honestly
// when the store was assembled for saving alone: a 500 with the standard error
// body, not a panic and not a silent empty list.
func TestCollectionsWithoutACollectionStoreIsA500(t *testing.T) {
	h := api.NewServer(stubStore{err: nil}, logging.Discard())

	rec := do(h, http.MethodGet, "/v1/collections", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %s)", rec.Code, rec.Body.String())
	}
	var body model.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("error body %q is not JSON: %v", rec.Body.String(), err)
	}
	if body.Status != "error" {
		t.Errorf("error body = %+v, want status error", body)
	}
}

// TestCollectionsAppearOnTheGalleryHomepage ties the resource to the read-only
// gallery: a category created for a name with nothing saved into it is visible
// there, and it does not push the populated categories out of the way.
func TestCollectionsAppearOnTheGalleryHomepage(t *testing.T) {
	h, _ := newGalleryServer(t, nil)

	mustSave(t, h, "linux", "5004")
	createCollection(t, h, `{"name":"Empty One"}`)

	body := fetchCollections(t, h)
	if len(body.Collections) != 2 {
		t.Fatalf("gallery collections = %d, want 2: %+v", len(body.Collections), body.Collections)
	}
	if body.Collections[0].Slug != "linux" {
		t.Errorf("first collection = %s, want the populated linux before the empty one", body.Collections[0].Slug)
	}
	empty := body.Collections[1]
	if empty.Slug != "empty-one" {
		t.Fatalf("second collection = %s, want empty-one", empty.Slug)
	}
	if empty.PostCount != 0 || empty.LastSavedAt != nil {
		t.Errorf("empty collection = %+v, want no posts and a null last_saved_at", empty)
	}
	if empty.Order != 1 {
		t.Errorf("empty collection order = %d, want 1 (the position it was given)", empty.Order)
	}
}

// slugs joins a collection list's slugs, for order assertions.
func slugs(collections []model.Collection) string {
	parts := make([]string, 0, len(collections))
	for _, collection := range collections {
		parts = append(parts, collection.Slug)
	}
	return strings.Join(parts, ",")
}
