// Package index maintains the derived, rebuildable tweet index.
//
// CSV files are the source of truth; index.json is a cache that may be
// deleted, corrupted or stale at any time. It is never allowed to destroy or
// rewrite CSV data.
package index

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

// FileName is the derived index file inside the storage directory.
const FileName = "index.json"

// Version is the index schema version.
const Version = 1

// Index is the in-memory map of Tweet Status ID -> IndexEntry.
type Index struct {
	mu     sync.RWMutex
	tweets map[string]model.IndexEntry
}

// New returns an empty index.
func New() *Index {
	return &Index{tweets: make(map[string]model.IndexEntry)}
}

// LoadOrRebuild implements the four PRD startup cases:
//
//	A: index.json exists and is valid   → load it
//	B: index.json missing               → rebuild from *.csv
//	C: index.json malformed/unreadable  → rebuild from *.csv
//	D: empty directory                  → empty index
func LoadOrRebuild(dir string, log *logging.Logger) (*Index, error) {
	if log == nil {
		log = logging.Discard()
	}

	data, err := os.ReadFile(filepath.Join(dir, FileName))
	switch {
	case err == nil:
		var file model.IndexFile
		if json.Unmarshal(data, &file) == nil && file.Version == Version {
			ix := New()
			if file.Tweets != nil {
				ix.tweets = file.Tweets
			}
			return ix, nil
		}
		return rebuild(dir, "malformed index.json", log)
	case errors.Is(err, os.ErrNotExist):
		return rebuild(dir, "missing index.json", log)
	default:
		// e.g. index.json is a directory or unreadable: treat as malformed and
		// rebuild rather than failing startup.
		return rebuild(dir, "unreadable index.json", log)
	}
}

func rebuild(dir, reason string, log *logging.Logger) (*Index, error) {
	ix := New()
	count, err := ix.rebuild(dir, log)
	if err != nil {
		return nil, err
	}
	log.IndexRebuild(dir, reason, count)
	return ix, nil
}

func (ix *Index) rebuild(dir string, log *logging.Logger) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, fmt.Errorf("scan storage directory %s: %w", dir, err)
	}

	total := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if filepath.Ext(name) != ".csv" {
			continue
		}
		// Only files this backend could have created are considered; anything
		// else in the directory is ignored.
		if err := storage.ValidateFilename(name); err != nil {
			continue
		}
		n, err := ix.loadCSV(filepath.Join(dir, name), name)
		if err != nil {
			log.FilesystemError("rebuild csv "+name, err)
			continue
		}
		total += n
	}
	return total, nil
}

// loadCSV reads one category CSV and merges its rows into the index. A
// malformed row stops that file but never aborts the whole rebuild.
//
// The column layout is decided by the file's own header record, never guessed
// from a field count: a migrated file has `media` at index 1 and `saved_at` at
// index 5, a not-yet-migrated file has `saved_at` at index 4. A file with no
// header at all is treated as the current schema.
func (ix *Index) loadCSV(path, filename string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true

	count := 0
	first := true
	savedAtIndex := 5 // current schema: url,media,author,username,tweet_date,saved_at,text
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, fmt.Errorf("read %s: %w", filename, err)
		}
		if first {
			first = false
			switch {
			case storage.IsHeaderRecord(rec):
				savedAtIndex = 5
				continue
			case storage.IsLegacyHeaderRecord(rec):
				savedAtIndex = 4
				continue
			}
		}
		if ix.addRecord(filename, rec, savedAtIndex) {
			count++
		}
	}
	return count, nil
}

// addRecord inserts a CSV row keyed by the Status ID parsed from its canonical
// URL. savedAtIndex is 5 for the current schema (media present) and 4 for the
// pre-media layout; a row needs at least that index plus its trailing text.
func (ix *Index) addRecord(filename string, rec []string, savedAtIndex int) bool {
	if len(rec) < savedAtIndex+2 {
		return false
	}
	canonical, id, err := storage.NormalizeURL(rec[0])
	if err != nil {
		return false
	}
	ix.Add(id, model.IndexEntry{URL: canonical, Filename: filename, SavedAt: rec[savedAtIndex]})
	return true
}

// RebuildAndPersist discards the on-disk index and rebuilds it from the CSVs,
// then writes the result atomically. It is the CLI path behind
// `twitter-bookmarker-server --rebuild-index`, so a data migration regenerates
// index.json with exactly the code that serves `GET /v1/index`.
func RebuildAndPersist(dir string, log *logging.Logger) (int, error) {
	if log == nil {
		log = logging.Discard()
	}
	ix := New()
	count, err := ix.rebuild(dir, log)
	if err != nil {
		return 0, err
	}
	if err := ix.Persist(dir); err != nil {
		return 0, err
	}
	log.IndexRebuild(dir, "forced rebuild", count)
	return count, nil
}

// Lookup returns the index entry for a Status ID.
func (ix *Index) Lookup(id string) (model.IndexEntry, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	e, ok := ix.tweets[id]
	return e, ok
}

// Add inserts or replaces an entry.
func (ix *Index) Add(id string, entry model.IndexEntry) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.tweets[id] = entry
}

// All returns a defensive copy of every entry (never nil).
func (ix *Index) All() map[string]model.IndexEntry {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := make(map[string]model.IndexEntry, len(ix.tweets))
	for k, v := range ix.tweets {
		out[k] = v
	}
	return out
}

// Count returns the number of indexed tweets.
func (ix *Index) Count() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.tweets)
}

// Persist writes the index atomically: temp file in the same directory, fsync,
// then rename over index.json.
func (ix *Index) Persist(dir string) error {
	file := model.IndexFile{Version: Version, Tweets: ix.All()}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal index: %w", err)
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(dir, ".index-*.json.tmp")
	if err != nil {
		return fmt.Errorf("create temp index: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		if tmpName != "" {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp index: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temp index: %w", err)
	}
	_ = tmp.Chmod(0o600)
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp index: %w", err)
	}
	if err := os.Rename(tmpName, filepath.Join(dir, FileName)); err != nil {
		return fmt.Errorf("rename temp index: %w", err)
	}
	tmpName = "" // renamed successfully; do not remove
	return nil
}
