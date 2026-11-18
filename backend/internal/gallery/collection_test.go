package gallery_test

import (
	"testing"

	"twitter-bookmarker/internal/dbtest"
)

// TestCollectionsFollowTheStoredOrder is the ordering contract after the backend
// took ownership of categories: the list comes back in the positions the user
// arranged, not in an order derived from the bookmarks.
//
// Ordering used to be `last_saved_at DESC`, which meant the homepage reshuffled
// itself as bookmarks arrived and no two clients could agree on the list. The
// `sort_order` column is that list now. Two collections with the *same* saved_at is
// the case that used to fall through to the slug alphabet; it must follow the
// stored positions instead.
func TestCollectionsFollowTheStoredOrder(t *testing.T) {
	dir := t.TempDir()
	conn := dbtest.Open(t, dir)
	same := "2026-09-05T00:00:00Z"

	dbtest.Seed(t, conn, "b-second", "B Second",
		dbtest.Row{TweetID: "1", URL: "https://x.com/u/status/1",
			Author: "A", Username: "@a",
			TweetDate: "2026-09-01T00:00:00Z", SavedAt: same, Text: "b"},
	)
	dbtest.Seed(t, conn, "a-first", "A First",
		dbtest.Row{TweetID: "2", URL: "https://x.com/u/status/2",
			Author: "A", Username: "@a",
			TweetDate: "2026-09-01T00:00:00Z", SavedAt: same, Text: "a"},
	)
	// Both carry the same saved_at, so anything slug-shaped in the comparison
	// would show up here as "A First" winning. The stored positions say otherwise.
	dbtest.MustExec(t, conn, `UPDATE collections SET sort_order = 0 WHERE slug = 'b-second'`)
	dbtest.MustExec(t, conn, `UPDATE collections SET sort_order = 1 WHERE slug = 'a-first'`)

	// Empty collections keep their stored order too, and sort behind the populated
	// ones so a fresh category cannot push the archive down the page.
	dbtest.Collection(t, conn, "z-empty", "Z Empty")
	dbtest.Collection(t, conn, "y-empty", "Y Empty")

	reader, _ := newReader(t, dir)
	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}

	want := []string{"B Second", "A First", "Z Empty", "Y Empty"}
	got := make([]string, 0, len(collections))
	for _, collection := range collections {
		got = append(got, collection.Name)
	}
	if !equalStrings(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}

	// The stored position travels with the summary, so a client rendering from the
	// payload alone can reproduce the order without re-sorting.
	if collections[0].Order != 0 || collections[1].Order != 1 {
		t.Errorf("orders = %d,%d, want 0,1", collections[0].Order, collections[1].Order)
	}
}
