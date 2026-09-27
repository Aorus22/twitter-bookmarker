package gallery_test

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"twitter-bookmarker/internal/gallery"
)

// This file is the Phase 10 (HARD-01) hardening suite for the read layer. It
// pins the four fault-tolerance behaviours PRD-2 §50/§51/§68 require, as a set,
// plus the blanket invariant that no malformed input can panic the server-side
// reader. The individual behaviours each have a narrower test elsewhere
// (reader_test.go); what this file adds is the "one bad row does not take the
// collection down" pairing, the legacy header, the 5,000-row bound, and the
// panic guard.

// assertNoPanic runs fn and fails the test if it panics, naming the input.
func assertNoPanic(t *testing.T, label string, fn func()) {
	t.Helper()
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("%s panicked: %v", label, recovered)
		}
	}()
	fn()
}

// TestHardeningMalformedMediaRowDoesNotTakeDownTheCollection is PRD-2 §50: a
// malformed `media` cell must degrade to a text card while every other row in
// the same file still reads.
func TestHardeningMalformedMediaRowDoesNotTakeDownTheCollection(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "mixed.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `["https://pbs.twimg.com/media/one.jpg"]`,
			"First", "@first", "2026-09-01T00:00:00Z", "2026-09-04T00:00:00Z", "good with media"),
		currentRow("https://x.com/u/status/2", `{"not":"an array"}`,
			"Broken", "@broken", "2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z", "broken media cell"),
		currentRow("https://x.com/u/status/3", `not-json-at-all`,
			"Broken Too", "@brokentoo", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "also broken"),
		currentRow("https://x.com/u/status/4", `["https://pbs.twimg.com/media/two.jpg"]`,
			"Last", "@last", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "good with media"),
	})
	reader, logs := newReader(t, dir)

	var page gallery.Page
	assertNoPanic(t, "Posts on a malformed-media CSV", func() {
		page = mustPosts(t, reader, "mixed.csv", gallery.RawQuery{Sort: "tweet_asc"})
	})

	if len(page.Items) != 4 {
		t.Fatalf("Items = %d, want 4 — a malformed media cell must not drop or crash the row", len(page.Items))
	}
	for _, id := range []string{"2", "3"} {
		post := postByID(t, page, id)
		if post.Media == nil || len(post.Media) != 0 {
			t.Errorf("post %s Media = %v, want [] (degraded to a text card)", id, post.Media)
		}
		if strings.TrimSpace(post.Text) == "" {
			t.Errorf("post %s lost its text; a malformed media cell must keep the text card", id)
		}
	}
	for _, id := range []string{"1", "4"} {
		if got := len(postByID(t, page, id).Media); got != 1 {
			t.Errorf("valid post %s Media = %d, want 1 (a sibling's bad cell must not poison it)", id, got)
		}
	}
	if !strings.Contains(logs.String(), "malformed media json") {
		t.Errorf("expected a malformed-media warning, logs = %q", logs.String())
	}

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	summary := collectionByName(t, collections, "Mixed")
	if summary.PostCount != 4 {
		t.Errorf("summary PostCount = %d, want 4", summary.PostCount)
	}
	// Only the two valid media cells count: the malformed ones contribute none.
	if summary.MediaCount != 2 {
		t.Errorf("summary MediaCount = %d, want 2", summary.MediaCount)
	}
}

// TestHardeningMalformedRowInTheMiddleIsSkipped is PRD-2 §51: a bad row in the
// middle of a file is skipped with a warning and the surrounding rows survive.
func TestHardeningMalformedRowInTheMiddleIsSkipped(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "rows.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `[]`, "A", "@a", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "before 1"),
		currentRow("https://x.com/u/status/2", `[]`, "B", "@b", "2026-09-02T00:00:00Z", "2026-09-02T00:00:00Z", "before 2"),
		// The malformed row: the wrong field count, which field-order-tolerant
		// CSV readers must reject per row rather than aborting the file.
		{"https://x.com/u/status/3", `[]`},
		currentRow("https://x.com/u/status/4", `[]`, "D", "@d", "2026-09-04T00:00:00Z", "2026-09-04T00:00:00Z", "after 1"),
		currentRow("https://x.com/u/status/5", `[]`, "E", "@e", "2026-09-05T00:00:00Z", "2026-09-05T00:00:00Z", "after 2"),
	})
	reader, logs := newReader(t, dir)

	var page gallery.Page
	assertNoPanic(t, "Posts on a mid-file malformed row", func() {
		page = mustPosts(t, reader, "rows.csv", gallery.RawQuery{Sort: "tweet_asc"})
	})

	want := []string{"1", "2", "4", "5"}
	if got := itemIDs(page); !equalStrings(got, want) {
		t.Fatalf("surviving ids = %v, want %v (only the middle row is skipped)", got, want)
	}
	if !strings.Contains(logs.String(), "skipping malformed row") {
		t.Errorf("expected a skipped-row warning, logs = %q", logs.String())
	}
	if !strings.Contains(logs.String(), "expected 7 fields, got 2") {
		t.Errorf("warning should name the field-count mismatch, logs = %q", logs.String())
	}

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if got := collectionByName(t, collections, "Rows").PostCount; got != 4 {
		t.Errorf("summary PostCount = %d, want 4", got)
	}
}

// TestHardeningLegacyHeaderStillReads pins the six-column pre-media layout
// (GAL-05): a file written before the `media` column existed reads normally and
// yields `media = []`, alongside a current-layout file.
func TestHardeningLegacyHeaderStillReads(t *testing.T) {
	dir := t.TempDir()
	writeCSV(t, dir, "legacy.csv", legacyHeader(), [][]string{
		legacyRow("https://x.com/old/status/71", "Old Timer", "@oldtimer", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "written before media existed, with a comma"),
		legacyRow("https://x.com/old/status/72", "Old Timer", "@oldtimer", "2026-01-03T00:00:00Z", "2026-01-04T00:00:00Z", "second legacy row"),
	})
	writeCSV(t, dir, "current.csv", currentHeader(), [][]string{
		currentRow("https://x.com/new/status/81", `["https://pbs.twimg.com/media/n.jpg"]`, "New Timer", "@newtimer", "2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z", "current layout"),
	})
	reader, _ := newReader(t, dir)

	var legacy gallery.Page
	assertNoPanic(t, "Posts on a legacy-header CSV", func() {
		legacy = mustPosts(t, reader, "legacy.csv", gallery.RawQuery{Sort: "tweet_asc"})
	})
	if len(legacy.Items) != 2 {
		t.Fatalf("legacy Items = %d, want 2", len(legacy.Items))
	}
	first := legacy.Items[0]
	if first.TweetID != "71" || first.Author != "Old Timer" || first.Username != "@oldtimer" {
		t.Errorf("legacy post misparsed: %+v", first)
	}
	if first.Text != "written before media existed, with a comma" {
		t.Errorf("legacy Text = %q", first.Text)
	}
	if first.Media == nil || len(first.Media) != 0 {
		t.Errorf("legacy Media = %v, want []", first.Media)
	}

	current := mustPosts(t, reader, "current.csv", gallery.RawQuery{})
	if len(current.Items) != 1 || len(current.Items[0].Media) != 1 {
		t.Fatalf("current layout beside a legacy file misparsed: %+v", current.Items)
	}

	collections, err := reader.Collections()
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	if got := collectionByName(t, collections, "Legacy").PostCount; got != 2 {
		t.Errorf("legacy summary PostCount = %d, want 2", got)
	}
}

// TestHardeningLargeCSVSummaryAndPagedQueryComplete is PRD-2 §68: a personal
// dataset of ~5,000 rows is acceptable on a local machine. Both a full summary
// and a paginated query must finish without error inside a generous bound that
// would still catch an accidental O(n²) rescan-per-row.
func TestHardeningLargeCSVSummaryAndPagedQueryComplete(t *testing.T) {
	const rows = 5000
	const bound = 10 * time.Second

	dir := t.TempDir()
	file, err := os.Create(filepath.Join(dir, "large.csv"))
	if err != nil {
		t.Fatalf("create large.csv: %v", err)
	}
	writer := csv.NewWriter(file)
	if err := writer.Write(currentHeader()); err != nil {
		t.Fatalf("write header: %v", err)
	}
	for i := 1; i <= rows; i++ {
		media := "[]"
		if i%3 == 0 {
			media = fmt.Sprintf(`["https://pbs.twimg.com/media/large%d.jpg"]`, i)
		}
		row := currentRow(
			fmt.Sprintf("https://x.com/bulk/status/%d", i),
			media,
			fmt.Sprintf("Author %d", i%17),
			fmt.Sprintf("@bulk%05d", i),
			// One distinct UTC instant per row, oldest first, so paging order
			// is deterministic.
			time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i)*time.Minute).Format(time.RFC3339),
			time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i)*time.Minute).Format(time.RFC3339),
			fmt.Sprintf("Bulk post %d with searchable haystack text.", i),
		)
		if err := writer.Write(row); err != nil {
			t.Fatalf("write row %d: %v", i, err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		t.Fatalf("flush large.csv: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close large.csv: %v", err)
	}

	reader, _ := newReader(t, dir)

	var collections []gallery.Collection
	assertNoPanic(t, "Collections on a 5,000-row CSV", func() {
		start := time.Now()
		collections, err = reader.Collections()
		if elapsed := time.Since(start); elapsed > bound {
			t.Errorf("Collections() over %d rows took %s, want <= %s", rows, elapsed, bound)
		}
	})
	if err != nil {
		t.Fatalf("Collections() error = %v", err)
	}
	summary := collectionByName(t, collections, "Large")
	if summary.PostCount != rows {
		t.Fatalf("summary PostCount = %d, want %d", summary.PostCount, rows)
	}
	// Every third row carries exactly one media URL.
	if want := rows / 3; summary.MediaCount != want {
		t.Errorf("summary MediaCount = %d, want %d", summary.MediaCount, want)
	}
	if summary.LastSavedAt == nil {
		t.Fatal("summary LastSavedAt = nil, want the newest saved_at")
	}
	if len(summary.CoverMedia) != gallery.CoverMediaLimit {
		t.Errorf("CoverMedia = %d, want %d", len(summary.CoverMedia), gallery.CoverMediaLimit)
	}

	var page1 gallery.Page
	assertNoPanic(t, "first paginated query on a 5,000-row CSV", func() {
		start := time.Now()
		page1 = mustPosts(t, reader, "large.csv", gallery.RawQuery{Sort: "saved_desc", Limit: "30"})
		if elapsed := time.Since(start); elapsed > bound {
			t.Errorf("first page query took %s, want <= %s", elapsed, bound)
		}
	})
	if len(page1.Items) != 30 {
		t.Fatalf("first page Items = %d, want 30", len(page1.Items))
	}
	if !page1.HasMore || page1.NextCursor == "" {
		t.Fatalf("first page HasMore = %v NextCursor = %q, want a next page", page1.HasMore, page1.NextCursor)
	}

	// Newest saved first, so the 5,000th row leads and row 4,971 closes page 1.
	if got := page1.Items[0].TweetID; got != "5000" {
		t.Errorf("first page head TweetID = %q, want 5000", got)
	}
	if got := page1.Items[len(page1.Items)-1].TweetID; got != "4971" {
		t.Errorf("first page tail TweetID = %q, want 4971", got)
	}

	var page2 gallery.Page
	assertNoPanic(t, "second paginated query on a 5,000-row CSV", func() {
		page2 = mustPosts(t, reader, "large.csv", gallery.RawQuery{
			Sort: "saved_desc", Limit: "30", Cursor: page1.NextCursor,
		})
	})
	if len(page2.Items) != 30 {
		t.Fatalf("second page Items = %d, want 30", len(page2.Items))
	}
	if got := page2.Items[0].TweetID; got != "4970" {
		t.Errorf("second page head TweetID = %q, want 4970 (cursor must not overlap page 1)", got)
	}

	// A search over the whole 5,000-row file must also complete.
	var searched gallery.Page
	assertNoPanic(t, "searched paginated query on a 5,000-row CSV", func() {
		start := time.Now()
		searched = mustPosts(t, reader, "large.csv", gallery.RawQuery{Q: "haystack", Sort: "saved_desc", Limit: "30"})
		if elapsed := time.Since(start); elapsed > bound {
			t.Errorf("searched query took %s, want <= %s", elapsed, bound)
		}
	})
	if len(searched.Items) != 30 || !searched.HasMore {
		t.Errorf("searched page = %d items hasMore=%v, want a full first page", len(searched.Items), searched.HasMore)
	}
}

// TestHardeningReaderNeverPanics runs the reader over a corpus of hostile CSVs
// and asserts that neither Collections nor Posts ever panics. A panic in the
// HTTP path would take the whole server down, so this is the blanket invariant
// behind the individual degradation rules (PRD-2 §50/§51/§68).
func TestHardeningReaderNeverPanics(t *testing.T) {
	corpus := []struct {
		name    string
		content string
	}{
		{"empty.csv", ""},
		{"headeronly.csv", "url,media,author,username,tweet_date,saved_at,text\n"},
		{"binary.csv", "\x00\x01\x02\xff\xfe binary \x00 garbage"},
		{"nul-in-cell.csv", "url,media,author,username,tweet_date,saved_at,text\n" +
			"https://x.com/u/status/1,\"[]\",\"Au\x00thor\",@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,text\n"},
		{"unterminated-quote.csv", "url,media,author,username,tweet_date,saved_at,text\n" +
			"https://x.com/u/status/1,\"[\"\"x\"\"]\",\"Unterminated,@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,text\n"},
		{"duplicate-columns.csv", "url,url,author,username,tweet_date,saved_at,text\n" +
			"https://x.com/u/status/1,https://x.com/u/status/2,A,@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,text\n"},
		{"no-header-columns.csv", "a,b,c\n1,2,3\n"},
		{"ragged.csv", "url,media,author,username,tweet_date,saved_at,text\n" +
			"1\n2,3\n4,5,6,7,8,9,10,11,12\n"},
		{"huge-field.csv", "url,media,author,username,tweet_date,saved_at,text\n" +
			"https://x.com/u/status/1,\"[]\",A,@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,\"" +
			strings.Repeat("x", 1<<20) + "\"\n"},
		{"bom-header.csv", "\ufeffurl,media,author,username,tweet_date,saved_at,text\n" +
			"https://x.com/u/status/1,\"[]\",A,@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,text\n"},
		{"crlf.csv", "url,media,author,username,tweet_date,saved_at,text\r\n" +
			"https://x.com/u/status/1,\"[]\",A,@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,text\r\n"},
		{"not-a-tweet-url.csv", "url,media,author,username,tweet_date,saved_at,text\n" +
			"javascript:alert(1),\"[]\",A,@a,2026-09-01T00:00:00Z,2026-09-02T00:00:00Z,text\n"},
		{"negative-date.csv", "url,media,author,username,tweet_date,saved_at,text\n" +
			"https://x.com/u/status/1,\"[]\",A,@a,0001-01-01T00:00:00Z,9999-12-31T23:59:59Z,text\n"},
	}

	dir := t.TempDir()
	for _, entry := range corpus {
		if err := os.WriteFile(filepath.Join(dir, entry.name), []byte(entry.content), 0o600); err != nil {
			t.Fatalf("write %s: %v", entry.name, err)
		}
	}
	// One syntactically valid collection guarantees Collections() has real work
	// to do while it walks the hostile neighbours.
	writeCSV(t, dir, "valid.csv", currentHeader(), [][]string{
		currentRow("https://x.com/u/status/1", `["https://pbs.twimg.com/media/ok.jpg"]`, "A", "@a",
			"2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "valid row"),
	})

	reader, _ := newReader(t, dir)

	// Collections walks every file, including the hostile ones.
	assertNoPanic(t, "Collections over the hostile corpus", func() {
		collections, err := reader.Collections()
		if err != nil {
			t.Fatalf("Collections() error = %v", err)
		}
		if len(collections) == 0 {
			t.Fatal("Collections() returned nothing; the valid file should still appear")
		}
	})

	for _, entry := range corpus {
		for _, query := range []gallery.RawQuery{
			{},
			{Sort: "tweet_asc", Limit: "100"},
			{Q: "text"},
			{Limit: "1"},
		} {
			name, raw := entry.name, query
			assertNoPanic(t, fmt.Sprintf("Posts(%q, %+v)", name, raw), func() {
				query, err := raw.Parse()
				if err != nil {
					return // a validation rejection is a fine outcome, not a panic
				}
				if _, err := reader.Posts(name, query); err != nil {
					return // a clean error is a fine outcome
				}
			})
		}
	}
}

// postByID returns the post with the given tweet_id, failing the test if absent.
func postByID(t *testing.T, page gallery.Page, id string) gallery.Post {
	t.Helper()
	for _, item := range page.Items {
		if item.TweetID == id {
			return item
		}
	}
	t.Fatalf("post %s not found in %v", id, itemIDs(page))
	return gallery.Post{}
}
