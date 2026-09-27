package storage

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
)

// Header is the exact CSV header written once per file.
//
// `media` sits directly after `url` and holds a JSON array of media URLs
// (`[]` when the tweet has none). Every row therefore has seven fields.
const Header = "url,media,author,username,tweet_date,saved_at,text"

var headerRecord = strings.Split(Header, ",")

// LegacyHeader is the pre-media header. Files still carrying it keep rebuilding
// correctly (see index.loadCSV), but they are never appended to: Save refuses
// with a SchemaMismatchError until Scripts/migrate_schema.py has run.
const LegacyHeader = "url,author,username,tweet_date,saved_at,text"

var legacyHeaderRecord = strings.Split(LegacyHeader, ",")

// IsHeaderRecord reports whether rec is exactly the current category CSV header.
func IsHeaderRecord(rec []string) bool { return recordEquals(rec, headerRecord) }

// IsLegacyHeaderRecord reports whether rec is exactly the pre-media header.
func IsLegacyHeaderRecord(rec []string) bool { return recordEquals(rec, legacyHeaderRecord) }

func recordEquals(rec, want []string) bool {
	if len(rec) != len(want) {
		return false
	}
	for i := range want {
		if rec[i] != want[i] {
			return false
		}
	}
	return true
}

// existingHeader reads the first physical line of an existing CSV file.
func existingHeader(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	line, err := bufio.NewReader(f).ReadString('\n')
	if err != nil && len(line) == 0 {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
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

	// An existing file written with the pre-media header must never receive a
	// seven-column row. The CSV layout is fixed per file, so refuse loudly
	// instead of silently corrupting the source of truth.
	if info, statErr := os.Stat(path); statErr == nil && info.Size() > 0 {
		header, headerErr := existingHeader(path)
		if headerErr != nil {
			return resp, fmt.Errorf("read csv header %s: %w", req.Filename, headerErr)
		}
		if header != Header {
			return resp, &SchemaMismatchError{Filename: req.Filename, Found: header}
		}
	}

	// Media is auxiliary: invalid entries are dropped, never rejected.
	mediaJSON, err := json.Marshal(NormalizeMedia(req.Tweet.Media))
	if err != nil {
		return resp, fmt.Errorf("encode media %s: %w", req.Filename, err)
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
		string(mediaJSON),
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
