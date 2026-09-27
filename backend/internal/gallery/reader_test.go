package gallery_test

import (
	"bytes"
	"encoding/csv"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"twitter-bookmarker/internal/gallery"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/storage"
)

// --- seeding helpers -------------------------------------------------------

func newReader(t *testing.T, dir string) (*gallery.Reader, *bytes.Buffer) {
	t.Helper()
	var logs bytes.Buffer
	return gallery.New(dir, logging.New(&logs)), &logs
}

func currentHeader() []string { return strings.Split(storage.Header, ",") }
func legacyHeader() []string  { return strings.Split(storage.LegacyHeader, ",") }

// writeCSV writes a header plus rows using encoding/csv, so commas, quotes,
// newlines and emoji inside cells are escaped exactly like the writer does.
func writeCSV(t *testing.T, dir, name string, header []string, rows [][]string) {
	t.Helper()
	file, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	if err := writer.Write(header); err != nil {
		t.Fatalf("write header %s: %v", name, err)
	}
	for _, row := range rows {
		if err := writer.Write(row); err != nil {
			t.Fatalf("write row %s: %v", name, err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		t.Fatalf("flush %s: %v", name, err)
	}
}

// appendCSV appends one row to an existing collection, proving freshness.
func appendCSV(t *testing.T, dir, name string, header, row []string) {
	t.Helper()
	existing, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if len(existing) == 0 {
		writeCSV(t, dir, name, header, [][]string{row})
		return
	}
	file, err := os.OpenFile(filepath.Join(dir, name), os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	if err := writer.Write(row); err != nil {
		t.Fatalf("append %s: %v", name, err)
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		t.Fatalf("flush %s: %v", name, err)
	}
}

func writeRaw(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func currentRow(url, media, author, username, tweetDate, savedAt, text string) []string {
	return []string{url, media, author, username, tweetDate, savedAt, text}
}

func legacyRow(url, author, username, tweetDate, savedAt, text string) []string {
	return []string{url, author, username, tweetDate, savedAt, text}
}

// mustPosts parses a raw query and runs it.
func mustPosts(t *testing.T, r *gallery.Reader, filename string, raw gallery.RawQuery) gallery.Page {
	t.Helper()
	query, err := raw.Parse()
	if err != nil {
		t.Fatalf("RawQuery.Parse() error = %v", err)
	}
	page, err := r.Posts(filename, query)
	if err != nil {
		t.Fatalf("Posts(%q) error = %v", filename, err)
	}
	return page
}

func collectionByName(t *testing.T, collections []gallery.Collection, name string) gallery.Collection {
	t.Helper()
	for _, collection := range collections {
		if collection.Name == name {
			return collection
		}
	}
	names := make([]string, 0, len(collections))
	for _, collection := range collections {
		names = append(names, collection.Name)
	}
	t.Fatalf("collection %q not found in %v", name, names)
	return gallery.Collection{}
}

func itemIDs(page gallery.Page) []string {
	ids := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		ids = append(ids, item.TweetID)
	}
	return ids
}

// --- discovery and summaries (Specific Idea 1) -----------------------------

func seedGallery(t *testing.T) (*gallery.Reader, *bytes.Buffer, string) {
	t.Helper()
	dir := t.TempDir()

	writeCSV(t, dir, "ai.csv", currentHeader(), [][]string{
		currentRow("https://x.com/alice/status/111",
			`["https://pbs.twimg.com/media/a1.jpg","https://pbs.twimg.com/media/a2.jpg"]`,
			"Alice", "@alice", "2026-09-20T08:00:00Z", "2026-09-27T10:00:00Z", "AI news"),
		currentRow("https://x.com/alice/status/112", `[]`,
			"Alice", "@alice", "2026-09-21T08:00:00Z", "2026-09-27T11:00:00Z", "text only"),
		currentRow("https://x.com/bob/status/113",
			`["https://pbs.twimg.com/media/a3.jpg"]`,
			"Bob", "@bob", "2026-09-22T08:00:00Z", "2026-09-26T09:00:00Z", "older"),
	})
	writeCSV(t, dir, "linux.csv", currentHeader(), [][]string{
		currentRow("https://x.com/carol/status/211",
			`["https://pbs.twimg.com/media/l1.jpg"]`,
			"Carol", "@carol", "2026-09-10T08:00:00Z", "2026-09-25T10:00:00Z", "Linux desktop tips"),
		currentRow("https://x.com/dave/status/212",
			`["https://pbs.twimg.com/media/l2.jpg"]`,
			"Dave", "@dave", "2026-09-11T08:00:00Z", "2026-09-24T10:00:00Z", "kernel stuff"),
	})
	writeCSV(t, dir, "design.csv", currentHeader(), [][]string{
		currentRow("https://x.com/erin/status/311", `[]`,
			"Erin", "@erin", "2026-09-15T08:00:00Z", "2026-09-20T10:00:00Z", "design notes"),
	})

	// Everything below must never be exposed as a collection.
	writeRaw(t, dir, "index.json", `{"version":1,"tweets":{}}`)
	writeRaw(t, dir, "linux.csv.bak", "url,author,username,tweet_date,saved_at,text\n")
	writeRaw(t, dir, ".hidden.csv", "url,media,author,username,tweet_date,saved_at,text\n")
	writeRaw(t, dir, "linux.csv.tmp", "junk")
	writeRaw(t, dir, "notes.txt", "junk")
	if err := os.Mkdir(filepath.Join(dir, "folder.csv"), 0o700); err != nil {
		t.Fatalf("mkdir folder.csv: %v", err)
	}
	if err := os.Symlink(filepath.Join(dir, "linux.csv"), filepath.Join(dir, "link.csv")); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	reader, logs := newReader(t, dir)
	return reader, logs, dir
}

func TestCollectionsDiscoverySummariesAndOrdering(t *testing.T) {
	reader, _, _ := seedGallery(t)

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if len(collections) != 3 {
		t.Fatalf("Collections() returned %d collections, want 3: %+v", len(collections), collections)
	}

	wantOrder := []string{"AI", "Linux", "Design"}
	for i, want := range wantOrder {
		if collections[i].Name != want {
			t.Errorf("collections[%d].Name = %q, want %q", i, collections[i].Name, want)
		}
	}

	tests := []struct {
		name        string
		postCount   int
		mediaCount  int
		lastSavedAt string
		cover       []string
	}{
		{
			name:        "AI",
			postCount:   3,
			mediaCount:  3,
			lastSavedAt: "2026-09-27T11:00:00Z",
			cover: []string{
				"https://pbs.twimg.com/media/a1.jpg",
				"https://pbs.twimg.com/media/a2.jpg",
				"https://pbs.twimg.com/media/a3.jpg",
			},
		},
		{
			name:        "Linux",
			postCount:   2,
			mediaCount:  2,
			lastSavedAt: "2026-09-25T10:00:00Z",
			cover: []string{
				"https://pbs.twimg.com/media/l1.jpg",
				"https://pbs.twimg.com/media/l2.jpg",
			},
		},
		{
			name:        "Design",
			postCount:   1,
			mediaCount:  0,
			lastSavedAt: "2026-09-20T10:00:00Z",
			cover:       []string{},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := collectionByName(t, collections, test.name)
			if got.Filename != strings.ToLower(test.name)+".csv" {
				t.Errorf("Filename = %q, want %q", got.Filename, strings.ToLower(test.name)+".csv")
			}
			if got.PostCount != test.postCount {
				t.Errorf("PostCount = %d, want %d", got.PostCount, test.postCount)
			}
			if got.MediaCount != test.mediaCount {
				t.Errorf("MediaCount = %d, want %d", got.MediaCount, test.mediaCount)
			}
			if got.LastSavedAt == nil || *got.LastSavedAt != test.lastSavedAt {
				t.Errorf("LastSavedAt = %v, want %q", got.LastSavedAt, test.lastSavedAt)
			}
			if got.CoverMedia == nil {
				t.Fatal("CoverMedia is nil, want a non-nil slice for JSON []")
			}
			if !equalStrings(got.CoverMedia, test.cover) {
				t.Errorf("CoverMedia = %v, want %v", got.CoverMedia, test.cover)
			}
		})
	}
}

func TestCollectionsCoverMediaNewestFirstCappedAtFour(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "cap.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1",
			`["https://pbs.twimg.com/media/m1.jpg","https://pbs.twimg.com/media/m2.jpg"]`,
			"A", "@a", "2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z", "newest"),
		currentRow("https://x.com/u/status/2",
			`["https://pbs.twimg.com/media/m3.jpg","https://pbs.twimg.com/media/m4.jpg"]`,
			"A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "middle"),
		currentRow("https://x.com/u/status/3",
			`["https://pbs.twimg.com/media/m5.jpg","https://pbs.twimg.com/media/m6.jpg"]`,
			"A", "@a", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "oldest"),
	})
	reader, _ := newReader(t, dir)

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	got := collectionByName(t, collections, "Cap")
	want := []string{
		"https://pbs.twimg.com/media/m1.jpg",
		"https://pbs.twimg.com/media/m2.jpg",
		"https://pbs.twimg.com/media/m3.jpg",
		"https://pbs.twimg.com/media/m4.jpg",
	}
	if !equalStrings(got.CoverMedia, want) {
		t.Fatalf("CoverMedia = %v, want newest-first capped at 4 %v", got.CoverMedia, want)
	}
}

func TestCollectionsEmptyAndTimestampLessSortLast(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "full.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", "has a timestamp"),
	})
	writeCSV(t, dir, "header-only.csv", currentHeader(), nil)
	writeCSV(t, dir, "empty-rows.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/2", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "", "no saved_at so it is dropped"),
	})
	reader, _ := newReader(t, dir)

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if len(collections) != 3 {
		t.Fatalf("Collections() returned %d collections, want 3: %+v", len(collections), collections)
	}
	if collections[0].Name != "Full" {
		t.Fatalf("first collection = %q, want the one with a timestamp", collections[0].Name)
	}
	for _, collection := range collections[1:] {
		if collection.LastSavedAt != nil {
			t.Errorf("%s LastSavedAt = %v, want nil", collection.Name, *collection.LastSavedAt)
		}
		if collection.PostCount != 0 || collection.MediaCount != 0 {
			t.Errorf("%s counts = %d/%d, want 0/0", collection.Name, collection.PostCount, collection.MediaCount)
		}
		if collection.CoverMedia == nil || len(collection.CoverMedia) != 0 {
			t.Errorf("%s CoverMedia = %v, want []", collection.Name, collection.CoverMedia)
		}
	}
}

func TestCollectionsMissingDirectoryIsEmpty(t *testing.T) {
	reader, _ := newReader(t, filepath.Join(t.TempDir(), "does-not-exist"))
	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if len(collections) != 0 {
		t.Fatalf("collections = %+v, want none", collections)
	}
}

// --- parsing fault tolerance (Specific Ideas 2, 3, 4) ----------------------

func TestPostsMalformedMediaJSONBecomesEmptyAndWarns(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "media.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", "not-json", "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "bad media"),
		currentRow("https://x.com/u/status/2", `["https://pbs.twimg.com/media/ok.jpg"]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z", "good media"),
	})
	reader, logs := newReader(t, dir)

	page := mustPosts(t, reader, "media.csv", gallery.RawQuery{Sort: "saved_desc"})
	if len(page.Items) != 2 {
		t.Fatalf("Items = %d, want 2 (the malformed-media post is still returned)", len(page.Items))
	}
	bad := page.Items[1]
	if bad.Media == nil || len(bad.Media) != 0 {
		t.Errorf("malformed media => %v, want []", bad.Media)
	}
	if bad.Text != "bad media" {
		t.Errorf("text = %q, want the row preserved as a text card", bad.Text)
	}
	if !strings.Contains(logs.String(), "malformed media json") {
		t.Errorf("expected a malformed-media warning, logs = %q", logs.String())
	}
	if !strings.Contains(logs.String(), "filename=media.csv") {
		t.Errorf("warning should name the file, logs = %q", logs.String())
	}
}

func TestPostsMalformedRowsAreSkippedWithWarnings(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "rows.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "good one"),
		currentRow("https://x.com/u/status/2", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "", "missing saved_at"),
		currentRow("https://x.com/u/status/3", `[]`, "", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "missing author"),
		currentRow("", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "missing url"),
		currentRow("https://x.com/u/status/5", `[]`, "A", "@a", "not-a-date", "2026-09-02T00:00:00Z", "bad tweet_date"),
		{"https://x.com/u/status/6", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "wrong", "field", "count"},
		currentRow("https://example.com/not-a-tweet", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "unparseable url"),
		currentRow("https://x.com/u/status/8", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "good two"),
	})
	reader, logs := newReader(t, dir)

	page := mustPosts(t, reader, "rows.csv", gallery.RawQuery{})
	if got := itemIDs(page); !equalStrings(got, []string{"8", "1"}) {
		t.Fatalf("surviving ids = %v, want [8 1] (default saved_desc)", got)
	}
	if !strings.Contains(logs.String(), "skipping malformed row") {
		t.Errorf("expected malformed-row warnings, logs = %q", logs.String())
	}
	for _, reason := range []string{"missing saved_at", "missing author", "missing url", "tweet_date is not RFC3339", "expected 7 fields, got 9"} {
		if !strings.Contains(logs.String(), reason) {
			t.Errorf("logs missing reason %q: %q", reason, logs.String())
		}
	}
}

func TestPostsLegacyHeaderYieldsEmptyMedia(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "legacy.csv", legacyHeader(), [][]string{
		legacyRow("https://x.com/u/status/77", "Old Author", "@old", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z", "pre-media file, with a comma"),
	})
	// The current layout next to it must still resolve.
	writeCSV(t, dir, "current.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/88", `["https://pbs.twimg.com/media/n.jpg"]`, "New Author", "@new", "2026-08-03T00:00:00Z", "2026-08-04T00:00:00Z", "with media"),
	})
	reader, _ := newReader(t, dir)

	legacy := mustPosts(t, reader, "legacy.csv", gallery.RawQuery{})
	if len(legacy.Items) != 1 {
		t.Fatalf("legacy Items = %d, want 1", len(legacy.Items))
	}
	got := legacy.Items[0]
	if got.TweetID != "77" || got.Author != "Old Author" || got.Username != "@old" || got.Text != "pre-media file, with a comma" {
		t.Fatalf("legacy post misparsed: %+v", got)
	}
	if got.Media == nil || len(got.Media) != 0 {
		t.Errorf("legacy Media = %v, want []", got.Media)
	}
	if got.SavedAt != "2026-08-02T00:00:00Z" {
		t.Errorf("legacy SavedAt = %q", got.SavedAt)
	}

	current := mustPosts(t, reader, "current.csv", gallery.RawQuery{})
	if len(current.Items) != 1 || len(current.Items[0].Media) != 1 {
		t.Fatalf("current layout misparsed: %+v", current.Items)
	}
}

func TestPostsCSVEdgeCharactersRoundTrip(t *testing.T) {
	dir := t.TempDir()
	text := "line one\nline two, with \"quotes\" and a comma; emoji 🎉 and unicode—dash"
	writeCSV(t, dir, "edge.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `["https://pbs.twimg.com/media/é.jpg"]`, "Ünïcode Áuthor", "@ünï", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", text),
	})
	reader, _ := newReader(t, dir)

	page := mustPosts(t, reader, "edge.csv", gallery.RawQuery{})
	if len(page.Items) != 1 {
		t.Fatalf("Items = %d, want 1", len(page.Items))
	}
	if page.Items[0].Text != text {
		t.Errorf("Text = %q, want %q", page.Items[0].Text, text)
	}
	if page.Items[0].Author != "Ünïcode Áuthor" {
		t.Errorf("Author = %q", page.Items[0].Author)
	}
}

func TestPostsUnknownHeaderReadsAsEmptyCollection(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "weird.csv", []string{"a", "b"}, [][]string{{"1", "2"}})
	reader, logs := newReader(t, dir)

	page := mustPosts(t, reader, "weird.csv", gallery.RawQuery{})
	if len(page.Items) != 0 || page.HasMore {
		t.Fatalf("page = %+v, want an empty exhausted page", page)
	}
	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if len(collections) != 1 || collections[0].PostCount != 0 {
		t.Fatalf("collections = %+v, want one empty collection", collections)
	}
	if !strings.Contains(logs.String(), "no gallery columns") {
		t.Errorf("expected an unrecognised-header warning, logs = %q", logs.String())
	}
}

// --- freshness (Specific Idea 8) -------------------------------------------

func TestEveryCallRereadsTheCSVWithoutCache(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "fresh.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "first"),
	})
	reader, _ := newReader(t, dir)

	first := mustPosts(t, reader, "fresh.csv", gallery.RawQuery{})
	if len(first.Items) != 1 {
		t.Fatalf("first read Items = %d, want 1", len(first.Items))
	}

	// A bookmark appended while the server runs must be visible immediately.
	appendCSV(t, dir, "fresh.csv", currentHeader(),
		currentRow("https://x.com/u/status/2", `[]`, "A", "@a", "2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z", "second"))

	second := mustPosts(t, reader, "fresh.csv", gallery.RawQuery{Sort: "saved_asc"})
	if got := itemIDs(second); !equalStrings(got, []string{"1", "2"}) {
		t.Fatalf("second read ids = %v, want [1 2] with the fresh row visible", got)
	}

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if got := collectionByName(t, collections, "Fresh"); got.PostCount != 2 || *got.LastSavedAt != "2026-09-04T00:00:00Z" {
		t.Fatalf("summary = %+v, want 2 posts and the new last_saved_at", got)
	}
}

// --- filename safety (Specific Idea 9) -------------------------------------

func TestPostsRejectsTraversalAndNonCSVNames(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "linux.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "ok"),
	})
	reader, _ := newReader(t, dir)

	for _, name := range []string{
		"../etc/passwd",
		"/etc/passwd",
		"a/b.csv",
		`a\b.csv`,
		"~/linux.csv",
		"linux.csv.bak",
		"x.txt",
		"..",
		"linux.csv/../linux.csv",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := reader.Posts(name, gallery.Query{})
			if err == nil {
				t.Fatalf("Posts(%q) succeeded, want an error", name)
			}
		})
	}

	if _, err := reader.Posts("absent.csv", gallery.Query{}); !errors.Is(err, gallery.ErrCollectionNotFound) {
		t.Fatalf("Posts(\"absent.csv\") error = %v, want ErrCollectionNotFound", err)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
