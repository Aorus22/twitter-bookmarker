package index_test

import (
	"encoding/csv"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"twitter-bookmarker/internal/index"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
)

func writeCSVFile(t *testing.T, dir, name string, rows [][]string) {
	t.Helper()
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	defer f.Close()
	w := csv.NewWriter(f)
	for _, row := range rows {
		if err := w.Write(row); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		t.Fatalf("flush %s: %v", name, err)
	}
}

func header() []string {
	return []string{"url", "author", "username", "tweet_date", "saved_at", "text"}
}

func TestLoadOrRebuildMissingIndexRebuildsFromCSV(t *testing.T) {
	dir := t.TempDir()
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/123", "Foo Bar", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "one"},
		{"https://x.com/bar/status/456", "Bar", "@bar", "2026-09-26T01:00:00Z", "2026-09-27T03:02:00Z", "two"},
	})
	writeCSVFile(t, dir, "ai.csv", [][]string{
		header(),
		{"https://x.com/baz/status/789", "Baz", "@baz", "2026-09-25T01:00:00Z", "2026-09-27T04:00:00Z", "three"},
	})

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 3 {
		t.Fatalf("Count() = %d, want 3", ix.Count())
	}
	entry, ok := ix.Lookup("123")
	if !ok {
		t.Fatalf("Lookup(123) not found")
	}
	if entry.Filename != "linux.csv" {
		t.Errorf("entry.Filename = %q, want linux.csv", entry.Filename)
	}
	if entry.URL != "https://x.com/foo/status/123" {
		t.Errorf("entry.URL = %q, want canonical", entry.URL)
	}
	if entry.SavedAt != "2026-09-27T03:00:00Z" {
		t.Errorf("entry.SavedAt = %q, want 2026-09-27T03:00:00Z", entry.SavedAt)
	}
}

func TestLoadOrRebuildEmptyDir(t *testing.T) {
	dir := t.TempDir()
	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 0 {
		t.Fatalf("Count() = %d, want 0", ix.Count())
	}
	all := ix.All()
	if all == nil {
		t.Fatalf("All() = nil, want empty non-nil map")
	}
	if len(all) != 0 {
		t.Fatalf("All() len = %d, want 0", len(all))
	}
}

func TestLoadOrRebuildMissingDirYieldsEmptyIndex(t *testing.T) {
	ix, err := index.LoadOrRebuild(filepath.Join(t.TempDir(), "does-not-exist"), logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 0 {
		t.Fatalf("Count() = %d, want 0", ix.Count())
	}
}

func TestLoadOrRebuildCorruptIndexRebuildsFromCSV(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte("{ this is not json"), 0o600); err != nil {
		t.Fatalf("write corrupt index: %v", err)
	}
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/123", "Foo", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "one"},
	})

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 1 {
		t.Fatalf("Count() = %d, want 1 (rebuilt from CSV)", ix.Count())
	}
	if _, ok := ix.Lookup("123"); !ok {
		t.Fatalf("Lookup(123) not found after rebuild")
	}

	// CSV must be untouched by the rebuild.
	raw, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}
	if string(raw) != "{ this is not json" {
		t.Fatalf("rebuild must not rewrite index.json, got %q", raw)
	}
}

func TestLoadOrRebuildIndexPathIsDirectoryRebuildsFromCSV(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "index.json"), 0o700); err != nil {
		t.Fatalf("mkdir index.json: %v", err)
	}
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/123", "Foo", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "one"},
	})

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 1 {
		t.Fatalf("Count() = %d, want 1", ix.Count())
	}
}

func TestLoadOrRebuildValidIndexLoads(t *testing.T) {
	dir := t.TempDir()
	valid := `{"version":1,"tweets":{"999":{"url":"https://x.com/x/status/999","filename":"ai.csv","saved_at":"2026-01-01T00:00:00Z"}}}`
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(valid), 0o600); err != nil {
		t.Fatalf("write index: %v", err)
	}
	// A CSV containing a different tweet must NOT be merged when the index is valid.
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/111", "Foo", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "one"},
	})

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 1 {
		t.Fatalf("Count() = %d, want 1 (loaded, not rebuilt)", ix.Count())
	}
	if _, ok := ix.Lookup("999"); !ok {
		t.Fatalf("Lookup(999) not found; valid index was not loaded")
	}
	if _, ok := ix.Lookup("111"); ok {
		t.Fatalf("Lookup(111) found; valid index should not have been rebuilt")
	}
}

func TestRebuildIgnoresNonCSVAndUnsafeNames(t *testing.T) {
	dir := t.TempDir()
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/123", "Foo", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "one"},
	})
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("not csv"), 0o600); err != nil {
		t.Fatalf("write notes.txt: %v", err)
	}
	writeCSVFile(t, dir, "Bad.csv", [][]string{
		header(),
		{"https://x.com/foo/status/999", "Foo", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "bad"},
	})
	if err := os.Mkdir(filepath.Join(dir, "subdir.csv"), 0o700); err != nil {
		t.Fatalf("mkdir subdir.csv: %v", err)
	}

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 1 {
		t.Fatalf("Count() = %d, want 1", ix.Count())
	}
	if _, ok := ix.Lookup("999"); ok {
		t.Fatalf("unsafe filename Bad.csv must be ignored")
	}
}

func TestRebuildHandlesMultilineCommasAndEmoji(t *testing.T) {
	dir := t.TempDir()
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/123", "Foo, Bar 🐧", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "line one\n\nline two, with comma"},
	})

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 1 {
		t.Fatalf("Count() = %d, want 1", ix.Count())
	}
}

func TestPersistRoundTripsAndLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	ix := index.New()
	ix.Add("123", model.IndexEntry{
		URL:      "https://x.com/foo/status/123",
		Filename: "linux.csv",
		SavedAt:  "2026-09-27T03:00:00Z",
	})
	if err := ix.Persist(dir); err != nil {
		t.Fatalf("Persist() error = %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp") {
			t.Errorf("leftover temp file after Persist: %s", e.Name())
		}
	}

	raw, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}
	var file model.IndexFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("index.json is not valid JSON: %v", err)
	}
	if file.Version != 1 {
		t.Errorf("version = %d, want 1", file.Version)
	}
	if len(file.Tweets) != 1 {
		t.Fatalf("tweets = %d, want 1", len(file.Tweets))
	}

	reloaded, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	got, ok := reloaded.Lookup("123")
	if !ok {
		t.Fatalf("Lookup(123) not found after reload")
	}
	want := model.IndexEntry{
		URL:      "https://x.com/foo/status/123",
		Filename: "linux.csv",
		SavedAt:  "2026-09-27T03:00:00Z",
	}
	if got != want {
		t.Fatalf("reloaded entry = %+v, want %+v", got, want)
	}
}

func TestAllReturnsDefensiveCopy(t *testing.T) {
	ix := index.New()
	ix.Add("123", model.IndexEntry{URL: "u", Filename: "f", SavedAt: "s"})

	all := ix.All()
	delete(all, "123")
	if ix.Count() != 1 {
		t.Fatalf("mutating All() result changed the index (Count = %d)", ix.Count())
	}
}
