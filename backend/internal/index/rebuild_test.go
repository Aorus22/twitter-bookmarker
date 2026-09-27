package index_test

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"twitter-bookmarker/internal/index"
	"twitter-bookmarker/internal/logging"
)

// TestRebuildFromTwoCSVsYieldsAllIDs proves PRD §65 item 14 (and §23 case B):
// with index.json missing, the index is rebuilt from every category CSV.
func TestRebuildFromTwoCSVsYieldsAllIDs(t *testing.T) {
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

	want := map[string]struct {
		filename string
		savedAt  string
	}{
		"123": {"linux.csv", "2026-09-27T03:00:00Z"},
		"456": {"linux.csv", "2026-09-27T03:02:00Z"},
		"789": {"ai.csv", "2026-09-27T04:00:00Z"},
	}
	for id, wantEntry := range want {
		entry, ok := ix.Lookup(id)
		if !ok {
			t.Errorf("Lookup(%s) not found", id)
			continue
		}
		if entry.Filename != wantEntry.filename {
			t.Errorf("Lookup(%s).Filename = %q, want %q", id, entry.Filename, wantEntry.filename)
		}
		if entry.SavedAt != wantEntry.savedAt {
			t.Errorf("Lookup(%s).SavedAt = %q, want %q", id, entry.SavedAt, wantEntry.savedAt)
		}
		if !strings.HasSuffix(entry.URL, "/status/"+id) {
			t.Errorf("Lookup(%s).URL = %q, want /status/%s suffix", id, entry.URL, id)
		}
	}

	// A rebuild is in-memory only; startup must not need to write index.json.
	if _, err := os.Stat(filepath.Join(dir, "index.json")); !os.IsNotExist(err) {
		t.Errorf("LoadOrRebuild created index.json during rebuild (stat err = %v)", err)
	}
}

// TestRebuildCorruptIndexYieldsAllIDsAndCSVsByteIdentical proves PRD §65 item
// 15 (and §23 case C): a malformed index.json is discarded, the CSV files are
// the authority and must not be modified by the rebuild.
func TestRebuildCorruptIndexYieldsAllIDsAndCSVsByteIdentical(t *testing.T) {
	dir := t.TempDir()
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/123", "Foo, Bar 🐧", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "line one\n\nline two"},
	})
	writeCSVFile(t, dir, "ai.csv", [][]string{
		header(),
		{"https://x.com/baz/status/789", "Baz", "@baz", "2026-09-25T01:00:00Z", "2026-09-27T04:00:00Z", "three"},
	})

	before := snapshotFiles(t, dir, "linux.csv", "ai.csv")

	const garbage = "{ this is not json"
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(garbage), 0o600); err != nil {
		t.Fatalf("write corrupt index: %v", err)
	}

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 2 {
		t.Fatalf("Count() = %d, want 2 (rebuilt from CSV)", ix.Count())
	}
	for _, id := range []string{"123", "789"} {
		if _, ok := ix.Lookup(id); !ok {
			t.Errorf("Lookup(%s) not found after rebuild", id)
		}
	}

	// Every CSV must be byte-identical after the rebuild.
	for name, want := range before {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s after rebuild: %v", name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s changed during rebuild:\n before=%q\n after =%q", name, want, got)
		}
	}

	// The corrupt index.json must be left untouched (rebuilt in memory only).
	raw, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}
	if string(raw) != garbage {
		t.Errorf("index.json was rewritten during rebuild: %q", raw)
	}

	// No temp files may be left behind.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp") {
			t.Errorf("leftover temp file after rebuild: %s", e.Name())
		}
	}
}

// TestRebuildEmptyDirYieldsEmptyIndex proves PRD §65 item 14 (and §23 case D):
// an empty storage directory yields an empty, non-nil index.
func TestRebuildEmptyDirYieldsEmptyIndex(t *testing.T) {
	dir := t.TempDir()
	// A non-CSV file must not be scanned.
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("not csv"), 0o600); err != nil {
		t.Fatalf("write notes.txt: %v", err)
	}

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 0 {
		t.Fatalf("Count() = %d, want 0", ix.Count())
	}
	all := ix.All()
	if all == nil {
		t.Fatal("All() = nil, want empty non-nil map")
	}
	if len(all) != 0 {
		t.Fatalf("All() len = %d, want 0", len(all))
	}
}

// TestValidIndexLoadsAsIs proves PRD §65 item 14/15 (and §23 case A): a valid
// index.json is loaded verbatim and the CSVs are not rescanned or modified.
func TestValidIndexLoadsAsIs(t *testing.T) {
	dir := t.TempDir()
	valid := `{"version":1,"tweets":{"999":{"url":"https://x.com/x/status/999","filename":"ai.csv","saved_at":"2026-01-01T00:00:00Z"}}}`
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(valid), 0o600); err != nil {
		t.Fatalf("write index: %v", err)
	}
	writeCSVFile(t, dir, "linux.csv", [][]string{
		header(),
		{"https://x.com/foo/status/111", "Foo", "@foo", "2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "one"},
	})
	beforeCSV := snapshotFiles(t, dir, "linux.csv")["linux.csv"]
	beforeIndex, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}

	ix, err := index.LoadOrRebuild(dir, logging.Discard())
	if err != nil {
		t.Fatalf("LoadOrRebuild() error = %v", err)
	}
	if ix.Count() != 1 {
		t.Fatalf("Count() = %d, want 1 (loaded, not rebuilt)", ix.Count())
	}
	if _, ok := ix.Lookup("999"); !ok {
		t.Error("Lookup(999) not found; valid index was not loaded")
	}
	if _, ok := ix.Lookup("111"); ok {
		t.Error("Lookup(111) found; the CSV must not be merged when the index is valid")
	}

	// Neither the CSV nor index.json may be touched when the index is valid.
	afterCSV, err := os.ReadFile(filepath.Join(dir, "linux.csv"))
	if err != nil {
		t.Fatalf("read linux.csv: %v", err)
	}
	if !bytes.Equal(afterCSV, beforeCSV) {
		t.Errorf("linux.csv changed while loading a valid index")
	}
	afterIndex, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}
	if !bytes.Equal(afterIndex, beforeIndex) {
		t.Errorf("index.json changed while loading a valid index")
	}
}

func snapshotFiles(t *testing.T, dir string, names ...string) map[string][]byte {
	t.Helper()
	out := make(map[string][]byte, len(names))
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		out[name] = data
	}
	return out
}
