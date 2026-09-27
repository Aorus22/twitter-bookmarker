package storage

import (
	"encoding/csv"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
)

// Header is the exact CSV header written once per file.
const Header = "url,author,username,tweet_date,saved_at,text"

var headerRecord = []string{"url", "author", "username", "tweet_date", "saved_at", "text"}

// IsHeaderRecord reports whether rec is exactly the category CSV header.
func IsHeaderRecord(rec []string) bool {
	if len(rec) != len(headerRecord) {
		return false
	}
	for i := range headerRecord {
		if rec[i] != headerRecord[i] {
			return false
		}
	}
	return true
}

// IndexStore is the subset of the derived index the Store needs. Declaring it
// here (rather than importing the index package) keeps storage free of an
// import cycle while preserving a single global write path.
type IndexStore interface {
	Lookup(id string) (model.IndexEntry, bool)
	Add(id string, entry model.IndexEntry)
	Persist(dir string) error
}

// Store appends bookmark rows to per-category CSVs and keeps the derived index
// up to date. The whole save critical section runs under one global mutex and
// CSV writes are synchronous, so a shutdown never loses an acknowledged save.
type Store struct {
	dir string
	idx IndexStore
	log *logging.Logger
	mu  sync.Mutex
}

// NewStore binds a Store to an injectable storage directory.
func NewStore(dir string, idx IndexStore, log *logging.Logger) *Store {
	if log == nil {
		log = logging.Discard()
	}
	return &Store{dir: dir, idx: idx, log: log}
}

// Dir returns the storage directory this store writes to.
func (s *Store) Dir() string { return s.dir }

// Save validates, normalizes, dedupes and appends one bookmark.
//
// Error classification:
//   - *ValidationError → caller maps to 400
//   - *DuplicateError  → caller maps to 409
//   - anything else    → caller maps to 500
//
// If the CSV append succeeds but index persistence fails, Save still returns
// success (CSV is the source of truth) after logging a warning.
func (s *Store) Save(req model.SaveRequest) (model.SaveResponse, error) {
	var resp model.SaveResponse

	if err := ValidateFilename(req.Filename); err != nil {
		return resp, err
	}

	canonicalURL, tweetID, err := NormalizeURL(req.Tweet.URL)
	if err != nil {
		return resp, err
	}

	author := strings.TrimSpace(req.Tweet.Author)
	if author == "" {
		return resp, &ValidationError{Reason: "author is required"}
	}
	username := strings.TrimSpace(req.Tweet.Username)
	if username == "" {
		return resp, &ValidationError{Reason: "username is required"}
	}
	tweetDate := strings.TrimSpace(req.Tweet.TweetDate)
	if tweetDate == "" {
		return resp, &ValidationError{Reason: "tweet_date is required"}
	}
	parsedDate, err := time.Parse(time.RFC3339, tweetDate)
	if err != nil {
		return resp, &ValidationError{Reason: "tweet_date must be RFC3339 (ISO 8601)"}
	}

	if s.idx == nil {
		return resp, fmt.Errorf("index is not configured")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.idx.Lookup(tweetID); ok {
		return resp, &DuplicateError{TweetID: tweetID}
	}

	path, err := SafeJoin(s.dir, req.Filename)
	if err != nil {
		return resp, err
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return resp, fmt.Errorf("open csv %s: %w", req.Filename, err)
	}

	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return resp, fmt.Errorf("stat csv %s: %w", req.Filename, err)
	}

	savedAt := time.Now().UTC().Format(time.RFC3339)
	w := csv.NewWriter(f)
	if info.Size() == 0 {
		if err := w.Write(headerRecord); err != nil {
			_ = f.Close()
			return resp, fmt.Errorf("write csv header %s: %w", req.Filename, err)
		}
	}
	row := []string{
		canonicalURL,
		author,
		username,
		parsedDate.UTC().Format(time.RFC3339),
		savedAt,
		req.Tweet.Text,
	}
	if err := w.Write(row); err != nil {
		_ = f.Close()
		return resp, fmt.Errorf("append csv row %s: %w", req.Filename, err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		_ = f.Close()
		return resp, fmt.Errorf("flush csv %s: %w", req.Filename, err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return resp, fmt.Errorf("sync csv %s: %w", req.Filename, err)
	}
	if err := f.Close(); err != nil {
		return resp, fmt.Errorf("close csv %s: %w", req.Filename, err)
	}

	entry := model.IndexEntry{URL: canonicalURL, Filename: req.Filename, SavedAt: savedAt}
	s.idx.Add(tweetID, entry)
	// Best effort: a derived cache failure must never fail an already-durable
	// CSV write. The index is rebuilt from CSVs on the next start.
	if err := s.idx.Persist(s.dir); err != nil {
		s.log.IndexPersistWarning(err)
	}
	s.log.SaveSuccess(tweetID, req.Filename)

	resp = model.SaveResponse{
		Status:   "saved",
		TweetID:  tweetID,
		URL:      canonicalURL,
		Filename: req.Filename,
		SavedAt:  savedAt,
	}
	return resp, nil
}
