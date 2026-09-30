package storage_test

import (
	"errors"
	"strings"
	"testing"

	"twitter-bookmarker/internal/dbtest"
	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

// The collection resource tests. They assert both what the Store returns and what
// is on disk, because the ordering is data now: a returned slice that happens to
// look right while `sort_order` stayed at default would reorder itself on the next
// read from a different path.

// slugsOf lists the slugs of a collection slice in order.
func slugsOf(collections []model.Collection) []string {
	slugs := make([]string, 0, len(collections))
	for _, collection := range collections {
		slugs = append(slugs, collection.Slug)
	}
	return slugs
}

// TestCreateCollectionAppendsAndReturnsTheResource is the basic contract: a new
// category exists, carries the name and colour it was given, and lands at the end
// of the list rather than at an arbitrary position.
func TestCreateCollectionAppendsAndReturnsTheResource(t *testing.T) {
	store, dir := newTestStore(t)

	first, err := store.CreateCollection("linux", "Linux", "#BF3F2E")
	if err != nil {
		t.Fatalf("CreateCollection() error = %v", err)
	}
	// The colour is normalized to lower case so two spellings cannot look like a
	// change on the next update.
	if first.Color != "#bf3f2e" {
		t.Errorf("Color = %q, want it normalized to lower case", first.Color)
	}
	if first.Order != 0 {
		t.Errorf("Order = %d, want 0 for the first collection", first.Order)
	}

	second, err := store.CreateCollection("ai-llm", "AI & LLM", "")
	if err != nil {
		t.Fatalf("CreateCollection() error = %v", err)
	}
	if second.Order != 1 {
		t.Errorf("Order = %d, want 1 (appended)", second.Order)
	}
	if second.Color != "" {
		t.Errorf("Color = %q, want empty when none was chosen", second.Color)
	}

	// Read from disk, not from the returned value.
	if got := dbtest.Count(t, openRO(t, dir), `SELECT count(*) FROM collections`); got != 2 {
		t.Errorf("collections on disk = %d, want 2", got)
	}
	if got := dbtest.Text(t, openRO(t, dir), `SELECT color FROM collections WHERE slug = 'linux'`); got != "#bf3f2e" {
		t.Errorf("stored color = %q, want #bf3f2e", got)
	}

	listed, err := store.ListCollections()
	if err != nil {
		t.Fatalf("ListCollections() error = %v", err)
	}
	if got, want := slugsOf(listed), []string{"linux", "ai-llm"}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("ListCollections() = %v, want %v", got, want)
	}
}

// TestCreateCollectionRejectsADuplicateSlug proves a second category with the same
// key is a conflict rather than a silent overwrite: the user's existing
// bookmarks must not quietly change folder.
func TestCreateCollectionRejectsADuplicateSlug(t *testing.T) {
	store, _ := newTestStore(t)

	if _, err := store.CreateCollection("linux", "Linux", ""); err != nil {
		t.Fatalf("first CreateCollection() error = %v", err)
	}
	_, err := store.CreateCollection("linux", "Linux", "")
	var exists *storage.CollectionExistsError
	if !errors.As(err, &exists) {
		t.Fatalf("second CreateCollection() error = %v, want *storage.CollectionExistsError", err)
	}
	if exists.Slug != "linux" {
		t.Errorf("CollectionExistsError.Slug = %q, want linux", exists.Slug)
	}
}

// TestCreateCollectionValidatesInput covers the three rejections a caller can
// cause: a slug the store will not accept, an empty name, and a colour that is not
// `#rrggbb`.
func TestCreateCollectionValidatesInput(t *testing.T) {
	store, _ := newTestStore(t)

	cases := []struct {
		name  string
		slug  string
		label string
		color string
	}{
		{"unsafe slug", "../etc/passwd", "Escape", ""},
		{"blank name", "linux", "   ", ""},
		{"name with nothing usable", "linux", "!!!", ""},
		{"name and slug disagree", "linux", "Windows", ""},
		{"named colour", "linux", "Linux", "red"},
		{"short hex", "linux", "Linux", "#fff"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := store.CreateCollection(tc.slug, tc.label, tc.color)
			var invalid *storage.ValidationError
			if !errors.As(err, &invalid) {
				t.Fatalf("CreateCollection() error = %v, want *storage.ValidationError", err)
			}
		})
	}
}

// TestUpdateCollectionRenamesAndKeepsTheBookmarks is the promise that makes a
// rename safe: the slug changes and every bookmark follows, because the foreign
// key is the collection id rather than the slug.
func TestUpdateCollectionRenamesAndKeepsTheBookmarks(t *testing.T) {
	store, dir := newTestStore(t)

	if _, err := store.Save(saveReq("linux", "https://x.com/a/status/700", "hello")); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	next := "Linux & BSD"
	updated, err := store.UpdateCollection("linux", storage.CollectionPatch{Name: &next})
	if err != nil {
		t.Fatalf("UpdateCollection() error = %v", err)
	}
	if updated.Slug != "linux-bsd" {
		t.Errorf("Slug after rename = %q, want linux-bsd", updated.Slug)
	}
	if updated.Name != "Linux & BSD" {
		t.Errorf("Name after rename = %q, want the name as typed", updated.Name)
	}

	conn := openRO(t, dir)
	if got := dbtest.Count(t, conn, `SELECT count(*) FROM collections WHERE slug = 'linux'`); got != 0 {
		t.Errorf("old slug rows = %d, want 0", got)
	}
	if got := dbtest.Count(t, conn,
		`SELECT count(*) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux-bsd'`); got != 1 {
		t.Errorf("bookmarks under the new slug = %d, want 1 (the bookmark follows its collection)", got)
	}
}

// TestUpdateCollectionRejectsACollision proves a rename onto a slug another
// category already holds is a conflict, not a silent merge of two folders.
func TestUpdateCollectionRejectsACollision(t *testing.T) {
	store, _ := newTestStore(t)

	for _, slug := range []string{"linux", "windows"} {
		if _, err := store.CreateCollection(slug, strings.ToUpper(slug[:1])+slug[1:], ""); err != nil {
			t.Fatalf("CreateCollection(%s) error = %v", slug, err)
		}
	}

	next := "Windows"
	_, err := store.UpdateCollection("linux", storage.CollectionPatch{Name: &next})
	var exists *storage.CollectionExistsError
	if !errors.As(err, &exists) {
		t.Fatalf("UpdateCollection() error = %v, want *storage.CollectionExistsError", err)
	}
}

// TestUpdateCollectionUnknownSlugIsNotFound keeps the 404 honest: renaming a
// category that was renamed or removed in another window must not create it.
func TestUpdateCollectionUnknownSlugIsNotFound(t *testing.T) {
	store, _ := newTestStore(t)

	next := "Anything"
	_, err := store.UpdateCollection("nope", storage.CollectionPatch{Name: &next})
	var missing *storage.CollectionNotFoundError
	if !errors.As(err, &missing) {
		t.Fatalf("UpdateCollection() error = %v, want *storage.CollectionNotFoundError", err)
	}
}

// TestUpdateCollectionChangesColorAndOrderAlone proves the patch is partial: the
// fields that were not supplied keep their stored values.
func TestUpdateCollectionChangesColorAndOrderAlone(t *testing.T) {
	store, _ := newTestStore(t)

	if _, err := store.CreateCollection("linux", "Linux", "#bf3f2e"); err != nil {
		t.Fatalf("CreateCollection() error = %v", err)
	}

	color := ""
	order := 4
	updated, err := store.UpdateCollection("linux", storage.CollectionPatch{Color: &color, Order: &order})
	if err != nil {
		t.Fatalf("UpdateCollection() error = %v", err)
	}
	if updated.Name != "Linux" {
		t.Errorf("Name = %q, want it untouched", updated.Name)
	}
	if updated.Slug != "linux" {
		t.Errorf("Slug = %q, want it untouched", updated.Slug)
	}
	if updated.Color != "" {
		t.Errorf("Color = %q, want the default cleared back to empty", updated.Color)
	}
	if updated.Order != 4 {
		t.Errorf("Order = %d, want 4", updated.Order)
	}
}

// TestUpdateCollectionRejectsAnEmptyPatch keeps a request that changes nothing
// from looking like a success that did something.
func TestUpdateCollectionRejectsAnEmptyPatch(t *testing.T) {
	store, _ := newTestStore(t)

	if _, err := store.CreateCollection("linux", "Linux", ""); err != nil {
		t.Fatalf("CreateCollection() error = %v", err)
	}
	_, err := store.UpdateCollection("linux", storage.CollectionPatch{})
	var invalid *storage.ValidationError
	if !errors.As(err, &invalid) {
		t.Fatalf("UpdateCollection() error = %v, want *storage.ValidationError", err)
	}
}

// TestReorderCollectionsWritesTheGivenOrder is the sort the popup and the phone
// both drive.
func TestReorderCollectionsWritesTheGivenOrder(t *testing.T) {
	store, dir := newTestStore(t)

	for _, slug := range []string{"alpha", "beta", "gamma"} {
		if _, err := store.CreateCollection(slug, strings.ToUpper(slug[:1])+slug[1:], ""); err != nil {
			t.Fatalf("CreateCollection(%s) error = %v", slug, err)
		}
	}

	ordered, err := store.ReorderCollections([]string{"gamma", "alpha", "beta"})
	if err != nil {
		t.Fatalf("ReorderCollections() error = %v", err)
	}
	if got, want := strings.Join(slugsOf(ordered), ","), "gamma,alpha,beta"; got != want {
		t.Errorf("ReorderCollections() = %s, want %s", got, want)
	}

	// The order has to be on disk, not just in the return value: the gallery and
	// the phone read it back with their own queries.
	conn := openRO(t, dir)
	for rank, slug := range []string{"gamma", "alpha", "beta"} {
		if got := dbtest.Count(t, conn, `SELECT sort_order FROM collections WHERE slug = ?`, slug); got != rank {
			t.Errorf("stored sort_order for %s = %d, want %d", slug, got, rank)
		}
	}

	listed, err := store.ListCollections()
	if err != nil {
		t.Fatalf("ListCollections() error = %v", err)
	}
	if got, want := strings.Join(slugsOf(listed), ","), "gamma,alpha,beta"; got != want {
		t.Errorf("ListCollections() after reorder = %s, want %s", got, want)
	}
}

// TestReorderCollectionsKeepsUnnamedOnesBehind proves a partial list is still a
// well-defined instruction: the collections the request did not mention keep their
// relative order and move behind the named ones.
//
// This is the case the naive `sort_order + len(slugs)` arithmetic gets wrong: a
// collection already at position 5 would land on 8, colliding with a named
// collection that was moved there.
func TestReorderCollectionsKeepsUnnamedOnesBehind(t *testing.T) {
	store, dir := newTestStore(t)

	for _, slug := range []string{"alpha", "beta", "gamma", "delta"} {
		if _, err := store.CreateCollection(slug, strings.ToUpper(slug[:1])+slug[1:], ""); err != nil {
			t.Fatalf("CreateCollection(%s) error = %v", slug, err)
		}
	}

	// Move delta to the front but name nothing else. delta must end up first and
	// the rest keep alpha, beta, gamma order behind it.
	ordered, err := store.ReorderCollections([]string{"delta"})
	if err != nil {
		t.Fatalf("ReorderCollections() error = %v", err)
	}
	if got, want := strings.Join(slugsOf(ordered), ","), "delta,alpha,beta,gamma"; got != want {
		t.Errorf("ReorderCollections() = %s, want %s", got, want)
	}

	conn := openRO(t, dir)
	orders := map[string]int{}
	rows, err := conn.Query(`SELECT slug, sort_order FROM collections`)
	if err != nil {
		t.Fatalf("read sort_order: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var slug string
		var order int
		if err := rows.Scan(&slug, &order); err != nil {
			t.Fatalf("scan: %v", err)
		}
		orders[slug] = order
	}
	if len(orders) != 4 {
		t.Fatalf("collections on disk = %d, want 4", len(orders))
	}
	for _, rank := range []int{0, 1, 2, 3} {
		found := false
		for _, order := range orders {
			if order == rank {
				found = true
			}
		}
		if !found {
			t.Errorf("no collection holds rank %d; positions must stay dense: %v", rank, orders)
		}
	}
}

// TestReorderCollectionsRejectsUnknownAndRepeatedSlugs keeps a stale client from
// half-applying an order it built from an older list.
func TestReorderCollectionsRejectsUnknownAndRepeatedSlugs(t *testing.T) {
	store, _ := newTestStore(t)

	if _, err := store.CreateCollection("linux", "Linux", ""); err != nil {
		t.Fatalf("CreateCollection() error = %v", err)
	}

	var missing *storage.CollectionNotFoundError
	if _, err := store.ReorderCollections([]string{"linux", "ghost"}); !errors.As(err, &missing) {
		t.Fatalf("ReorderCollections(unknown) error = %v, want *storage.CollectionNotFoundError", err)
	}

	var invalid *storage.ValidationError
	if _, err := store.ReorderCollections([]string{"linux", "linux"}); !errors.As(err, &invalid) {
		t.Fatalf("ReorderCollections(repeated) error = %v, want *storage.ValidationError", err)
	}
	if _, err := store.ReorderCollections(nil); !errors.As(err, &invalid) {
		t.Fatalf("ReorderCollections(empty) error = %v, want *storage.ValidationError", err)
	}

	// The failed requests must have changed nothing.
	listed, err := store.ListCollections()
	if err != nil {
		t.Fatalf("ListCollections() error = %v", err)
	}
	if got, want := strings.Join(slugsOf(listed), ","), "linux"; got != want {
		t.Errorf("ListCollections() after rejected reorders = %s, want %s", got, want)
	}
}

// TestSaveAppendsANewCollectionAndLeavesAnOldOneInPlace proves a save is not a
// reorder: a category created by saving lands at the end like any other, and
// saving again into a category the user has moved must not move it back.
func TestSaveAppendsANewCollectionAndLeavesAnOldOneInPlace(t *testing.T) {
	store, _ := newTestStore(t)

	if _, err := store.CreateCollection("first", "First", ""); err != nil {
		t.Fatalf("CreateCollection() error = %v", err)
	}
	// Saving creates "saved" on first use, at the end.
	if _, err := store.Save(saveReq("saved", "https://x.com/a/status/900", "one")); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	// The user puts "saved" first.
	if _, err := store.ReorderCollections([]string{"saved", "first"}); err != nil {
		t.Fatalf("ReorderCollections() error = %v", err)
	}
	// Saving into it again must leave it where the user put it.
	if _, err := store.Save(saveReq("saved", "https://x.com/a/status/901", "two")); err != nil {
		t.Fatalf("second Save() error = %v", err)
	}

	listed, err := store.ListCollections()
	if err != nil {
		t.Fatalf("ListCollections() error = %v", err)
	}
	if got, want := strings.Join(slugsOf(listed), ","), "saved,first"; got != want {
		t.Errorf("ListCollections() = %s, want %s", got, want)
	}
}

// TestSlugifyMatchesTheDocumentedRules pins the slug rules the three clients share.
func TestSlugifyMatchesTheDocumentedRules(t *testing.T) {
	cases := map[string]string{
		"Linux":        "linux",
		"AI & LLM":     "ai-llm",
		"Read Later":   "read-later",
		"  Spaced  ":   "spaced",
		"Café":         "cafe",
		"a---b":        "a-b",
		"--edged--":    "edged",
		"Emoji 🎉 here": "emoji-here",
		"MiXeD Case":   "mixed-case",
	}
	for name, want := range cases {
		got, err := storage.Slugify(name)
		if err != nil {
			t.Errorf("Slugify(%q) error = %v", name, err)
			continue
		}
		if got != want {
			t.Errorf("Slugify(%q) = %q, want %q", name, got, want)
		}
	}

	for _, name := range []string{"", "   ", "!!!", "🎉"} {
		if _, err := storage.Slugify(name); err == nil {
			t.Errorf("Slugify(%q) succeeded, want a validation error", name)
		}
	}
}
