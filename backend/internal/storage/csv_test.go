package storage_test

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"twitter-bookmarker/internal/index"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

func newTestStore(t *testing.T) (*storage.Store, *index.Index, string) {
	t.Helper()
	dir := t.TempDir()
	idx, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	return storage.NewStore(dir, idx, logging.Discard()), idx, dir
}

func saveReq(filename, rawURL, text string) model.SaveRequest {
	return model.SaveRequest{
		Filename: filename,
		Tweet: model.TweetInput{
			URL:       rawURL,
			Author:    "Foo Bar",
			Username:  "@foo",
			TweetDate: "2026-09-27T01:00:00Z",
			Text:      text,
		},
	}
}

func readAll(t *testing.T, dir, name string) [][]string {
	t.Helper()
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	defer f.Close()
	recs, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatalf("read csv %s: %v", name, err)
	}
	return recs
}

func dataRows(t *testing.T, dir, name string) [][]string {
	t.Helper()
	recs := readAll(t, dir, name)
	if len(recs) > 0 && storage.IsHeaderRecord(recs[0]) {
		return recs[1:]
	}
	return recs
}

func TestSaveWritesHeaderOnceThenAppends(t *testing.T) {
	store, _, dir := newTestStore(t)

	if _, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "first")); err != nil {
		t.Fatalf("first Save() error = %v", err)
	}
	if _, err := store.Save(saveReq("linux.csv", "https://x.com/bar/status/456", "second")); err != nil {
		t.Fatalf("second Save() error = %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read linux.csv: %v", err)
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if lines[0] != storage.Header {
		t.Fatalf("header = %q, want %q", lines[0], storage.Header)
	}
	for i, line := range lines {
		if i > 0 && strings.HasPrefix(line, "url,media,author") {
			t.Fatalf("header repeated on line %d: %q", i+1, line)
		}
	}
	if len(lines) != 3 {
		t.Fatalf("line count = %d, want 3 (header + 2 rows)", len(lines))
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != 2 {
		t.Fatalf("data rows = %d, want 2", len(rows))
	}
}

func TestCSVRoundTripSpecialCharacters(t *testing.T) {
	store, _, dir := newTestStore(t)

	author := "Foo, Bar 🐧"
	text := "Hello, \"world\" 🐧\n\nLine two — ünïcode 🎉, tabs\tand commas"

	req := saveReq("linux.csv", "https://x.com/foo/status/123?s=20#x", text)
	req.Tweet.Author = author
	resp, err := store.Save(req)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rows := dataRows(t, dir, "linux.csv")
	if len(rows) != 1 {
		t.Fatalf("data rows = %d, want 1", len(rows))
	}
	row := rows[0]
	if len(row) != 7 {
		t.Fatalf("field count = %d, want 7", len(row))
	}
	if row[0] != resp.URL || row[0] != "https://x.com/foo/status/123" {
		t.Errorf("url field = %q, want canonical URL", row[0])
	}
	if row[1] != "[]" {
		t.Errorf("media field = %q, want []", row[1])
	}
	if row[2] != author {
		t.Errorf("author field = %q, want %q", row[2], author)
	}
	if row[6] != text {
		t.Errorf("text field = %q, want %q", row[6], text)
	}

	// encoding/csv (not manual escaping) must have quoted the tricky fields.
	raw, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	if !strings.Contains(string(raw), `"Foo, Bar 🐧"`) {
		t.Errorf("expected quoting in raw csv, got:\n%s", raw)
	}
}

func TestSaveMediaOnlyTweetHasEmptyText(t *testing.T) {
	store, _, dir := newTestStore(t)

	if _, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "")); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	rows := dataRows(t, dir, "linux.csv")
	if len(rows) != 1 {
		t.Fatalf("data rows = %d, want 1", len(rows))
	}
	if len(rows[0]) != 7 {
		t.Fatalf("field count = %d, want 7", len(rows[0]))
	}
	if rows[0][6] != "" {
		t.Fatalf("text field = %q, want empty", rows[0][6])
	}
}

func TestSaveNormalizesURLAndTweetDate(t *testing.T) {
	store, _, dir := newTestStore(t)

	req := saveReq("linux.csv", "https://x.com/foo/status/123?s=20#x", "hi")
	req.Tweet.TweetDate = "2026-09-27T08:00:00+07:00"
	resp, err := store.Save(req)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if resp.URL != "https://x.com/foo/status/123" {
		t.Errorf("response url = %q, want canonical", resp.URL)
	}
	if resp.TweetID != "123" {
		t.Errorf("response tweet_id = %q, want 123", resp.TweetID)
	}

	row := dataRows(t, dir, "linux.csv")[0]
	if row[4] != "2026-09-27T01:00:00Z" {
		t.Errorf("tweet_date field = %q, want 2026-09-27T01:00:00Z (UTC normalized)", row[4])
	}
}

func TestSaveGeneratesUTCSavedAt(t *testing.T) {
	store, _, dir := newTestStore(t)

	before := time.Now().UTC().Add(-time.Minute)
	resp, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "hi"))
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	after := time.Now().UTC().Add(time.Minute)

	parsed, err := time.Parse(time.RFC3339, resp.SavedAt)
	if err != nil {
		t.Fatalf("saved_at %q is not RFC3339: %v", resp.SavedAt, err)
	}
	if parsed.Location() != time.UTC {
		t.Errorf("saved_at location = %v, want UTC", parsed.Location())
	}
	if parsed.Before(before) || parsed.After(after) {
		t.Errorf("saved_at %v outside [%v, %v]", parsed, before, after)
	}
	if row := dataRows(t, dir, "linux.csv")[0]; row[5] != resp.SavedAt {
		t.Errorf("csv saved_at = %q, response saved_at = %q", row[5], resp.SavedAt)
	}
}

func TestDuplicateRejectedGlobally(t *testing.T) {
	store, idx, dir := newTestStore(t)

	if _, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "first")); err != nil {
		t.Fatalf("first Save() error = %v", err)
	}

	// Same Status ID, different username casing, query string and filename.
	_, err := store.Save(saveReq("ai.csv", "https://x.com/renamed/status/123?s=20", "dupe"))
	var dup *storage.DuplicateError
	if !errors.As(err, &dup) {
		t.Fatalf("second Save() error = %v, want *storage.DuplicateError", err)
	}
	if dup.TweetID != "123" {
		t.Errorf("duplicate tweet id = %q, want 123", dup.TweetID)
	}
	if !errors.Is(err, storage.ErrDuplicate) {
		t.Errorf("errors.Is(err, ErrDuplicate) = false, want true")
	}
	if idx.Count() != 1 {
		t.Errorf("index count = %d, want 1", idx.Count())
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != 1 {
		t.Errorf("linux.csv data rows = %d, want 1", len(rows))
	}
	if _, statErr := os.Stat(filepath.Join(dir, "ai.csv")); !errors.Is(statErr, os.ErrNotExist) {
		t.Errorf("ai.csv should not exist after duplicate rejection (stat err = %v)", statErr)
	}
}

func TestConcurrentDuplicateSavesProduceExactlyOneRow(t *testing.T) {
	store, idx, dir := newTestStore(t)

	const workers = 20
	var successes, duplicates, other atomic.Int64

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // maximize contention
			_, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123?s=20", "concurrent"))
			var dup *storage.DuplicateError
			switch {
			case err == nil:
				successes.Add(1)
			case errors.As(err, &dup):
				duplicates.Add(1)
			default:
				other.Add(1)
				t.Errorf("unexpected Save() error: %v", err)
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := successes.Load(); got != 1 {
		t.Errorf("successes = %d, want 1", got)
	}
	if got := duplicates.Load(); got != int64(workers-1) {
		t.Errorf("duplicates = %d, want %d", got, workers-1)
	}
	if got := other.Load(); got != 0 {
		t.Errorf("other errors = %d, want 0", got)
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != 1 {
		t.Fatalf("linux.csv data rows = %d, want exactly 1", len(rows))
	}
	if idx.Count() != 1 {
		t.Fatalf("index count = %d, want 1", idx.Count())
	}
}

func TestIndexPersistFailureDoesNotFailSave(t *testing.T) {
	dir := t.TempDir()
	idx := index.New()
	store := storage.NewStore(dir, idx, logging.Discard())

	// Force Persist to fail: the rename target is a non-empty directory.
	if err := os.Mkdir(filepath.Join(dir, "index.json"), 0o700); err != nil {
		t.Fatalf("mkdir index.json: %v", err)
	}

	resp, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "still saved"))
	if err != nil {
		t.Fatalf("Save() error = %v, want success despite index persistence failure", err)
	}
	if resp.Status != "saved" {
		t.Fatalf("response status = %q, want saved", resp.Status)
	}
	if idx.Count() != 1 {
		t.Fatalf("in-memory index count = %d, want 1", idx.Count())
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != 1 {
		t.Fatalf("linux.csv data rows = %d, want 1", len(rows))
	}
}

func TestSaveValidationErrors(t *testing.T) {
	store, _, _ := newTestStore(t)

	base := saveReq("linux.csv", "https://x.com/foo/status/123", "hi")

	tests := []struct {
		name   string
		mutate func(*model.SaveRequest)
	}{
		{"bad filename", func(r *model.SaveRequest) { r.Filename = "../x.csv" }},
		{"unslugged filename", func(r *model.SaveRequest) { r.Filename = "AI & LLM.csv" }},
		{"empty filename", func(r *model.SaveRequest) { r.Filename = "" }},
		{"bad url host", func(r *model.SaveRequest) { r.Tweet.URL = "https://example.com/foo/status/1" }},
		{"no status id", func(r *model.SaveRequest) { r.Tweet.URL = "https://x.com/i/bookmarks" }},
		{"missing author", func(r *model.SaveRequest) { r.Tweet.Author = "  " }},
		{"missing username", func(r *model.SaveRequest) { r.Tweet.Username = "" }},
		{"missing tweet_date", func(r *model.SaveRequest) { r.Tweet.TweetDate = "" }},
		{"bad tweet_date", func(r *model.SaveRequest) { r.Tweet.TweetDate = "27-09-2026" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := base
			tc.mutate(&req)
			_, err := store.Save(req)
			var invalid *storage.ValidationError
			if !errors.As(err, &invalid) {
				t.Fatalf("Save() error = %v, want *storage.ValidationError", err)
			}
		})
	}
}

func TestSaveLogsIdentifierButNeverTweetText(t *testing.T) {
	dir := t.TempDir()
	idx := index.New()
	var buf bytes.Buffer
	store := storage.NewStore(dir, idx, logging.New(&buf))

	const secret = "TOP-SECRET-TWEET-BODY-9137"
	if _, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", secret)); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	logged := buf.String()
	if strings.Contains(logged, secret) {
		t.Fatalf("log output leaked tweet text: %s", logged)
	}
	if !strings.Contains(logged, "123") || !strings.Contains(logged, "linux.csv") {
		t.Fatalf("log output missing tweet id/filename: %s", logged)
	}
}

func TestSaveManyDistinctTweetsToSameFile(t *testing.T) {
	store, idx, dir := newTestStore(t)

	const n = 50
	for i := 0; i < n; i++ {
		req := saveReq("linux.csv", fmt.Sprintf("https://x.com/foo/status/%d", 1000+i), fmt.Sprintf("tweet %d", i))
		if _, err := store.Save(req); err != nil {
			t.Fatalf("Save(%d) error = %v", i, err)
		}
	}
	if idx.Count() != n {
		t.Fatalf("index count = %d, want %d", idx.Count(), n)
	}
	if rows := dataRows(t, dir, "linux.csv"); len(rows) != n {
		t.Fatalf("data rows = %d, want %d", len(rows), n)
	}
}

func TestSaveWritesMediaAsJSONArray(t *testing.T) {
	store, _, dir := newTestStore(t)

	req := saveReq("linux.csv", "https://x.com/foo/status/123", "art")
	req.Tweet.Media = []string{
		"https://pbs.twimg.com/media/AAA?format=jpg&name=small",
		"https://pbs.twimg.com/media/BBB.jpg",
		"https://pbs.twimg.com/media/BBB.jpg",
		"https://example.com/not-media.jpg",
	}
	if _, err := store.Save(req); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	row := dataRows(t, dir, "linux.csv")[0]
	if len(row) != 7 {
		t.Fatalf("field count = %d, want 7", len(row))
	}
	var media []string
	if err := json.Unmarshal([]byte(row[1]), &media); err != nil {
		t.Fatalf("media column %q is not a JSON array: %v", row[1], err)
	}
	want := []string{
		"https://pbs.twimg.com/media/AAA.jpg",
		"https://pbs.twimg.com/media/BBB.jpg",
	}
	if !reflect.DeepEqual(media, want) {
		t.Errorf("media column = %#v, want %#v (canonicalized, deduped, host-filtered)", media, want)
	}
}

func TestSaveRefusesPreMigrationFile(t *testing.T) {
	store, _, dir := newTestStore(t)

	// A file the previous schema version left behind: legacy header, legacy row.
	legacy := storage.LegacyHeader + "\n" +
		"https://x.com/old/status/999,Old,@old,2026-09-01T00:00:00Z,2026-09-01T01:00:00Z,\"already here\"\n"
	path := filepath.Join(dir, "linux.csv")
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("write legacy csv: %v", err)
	}

	_, err := store.Save(saveReq("linux.csv", "https://x.com/foo/status/123", "new"))
	if err == nil {
		t.Fatal("Save() on a pre-migration file succeeded; it must refuse")
	}
	var mismatch *storage.SchemaMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("Save() error = %v (%T), want *storage.SchemaMismatchError", err, err)
	}
	if mismatch.Filename != "linux.csv" {
		t.Errorf("SchemaMismatchError.Filename = %q, want linux.csv", mismatch.Filename)
	}

	// The source of truth must be byte-for-byte untouched.
	raw, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("read csv: %v", readErr)
	}
	if string(raw) != legacy {
		t.Fatalf("legacy csv was modified:\n%s", raw)
	}
}

func TestSaveAcceptsMigratedFileWithMedia(t *testing.T) {
	store, _, dir := newTestStore(t)

	req := saveReq("linux.csv", "https://x.com/foo/status/123", "one")
	req.Tweet.Media = []string{"https://pbs.twimg.com/media/AAA.jpg"}
	if _, err := store.Save(req); err != nil {
		t.Fatalf("first Save() error = %v", err)
	}

	second := saveReq("linux.csv", "https://x.com/bar/status/456", "two")
	if _, err := store.Save(second); err != nil {
		t.Fatalf("append Save() error = %v", err)
	}

	rows := dataRows(t, dir, "linux.csv")
	if len(rows) != 2 {
		t.Fatalf("data rows = %d, want 2", len(rows))
	}
	if rows[0][1] != `["https://pbs.twimg.com/media/AAA.jpg"]` {
		t.Errorf("row 1 media = %q", rows[0][1])
	}
	if rows[1][1] != "[]" {
		t.Errorf("row 2 media = %q, want []", rows[1][1])
	}
}
