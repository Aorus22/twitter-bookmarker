package gallery

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"sort"
	"strings"
	"time"

	"twitter-bookmarker/internal/config"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/storage"
)

// Reader reads gallery collections from one storage directory. It holds no
// derived state: every call re-opens the CSVs, so a bookmark appended while
// the server runs is visible on the next call (GAL-14).
type Reader struct {
	dir string
	log *logging.Logger
}

// New builds a Reader over dir. A nil logger is replaced by a discarding one.
func New(dir string, log *logging.Logger) *Reader {
	if log == nil {
		log = logging.Discard()
	}
	return &Reader{dir: dir, log: log}
}

// NewFromConfig resolves config.StorageDir() and builds a Reader over it.
func NewFromConfig(log *logging.Logger) (*Reader, error) {
	dir, err := config.StorageDir()
	if err != nil {
		return nil, fmt.Errorf("gallery: resolve storage directory: %w", err)
	}
	return New(dir, log), nil
}

// Dir returns the storage directory the Reader was constructed with.
func (r *Reader) Dir() string { return r.dir }

// parsedRow is one valid bookmark row plus the parsed timestamps used for
// filtering, sorting and summary computation.
type parsedRow struct {
	post      Post
	tweetTime time.Time
	savedTime time.Time
}

// columnIndexes maps the header names the reader needs onto their positions.
// A -1 position means the column is absent (only `media` is allowed to be).
type columnIndexes struct {
	url       int
	media     int
	author    int
	username  int
	tweetDate int
	savedAt   int
	text      int
}

// hasRequired reports whether every field a gallery post needs is present.
func (c columnIndexes) hasRequired() bool {
	return c.url >= 0 && c.author >= 0 && c.username >= 0 && c.tweetDate >= 0 && c.savedAt >= 0
}

// field returns record[index], or "" when the column is absent or the record is
// shorter than expected.
func (c columnIndexes) field(record []string, index int) string {
	if index < 0 || index >= len(record) {
		return ""
	}
	return record[index]
}

// resolveColumns resolves columns by header name so the current seven-column
// header and the legacy six-column header both read correctly (GAL-05).
func resolveColumns(header []string) columnIndexes {
	columns := columnIndexes{url: -1, media: -1, author: -1, username: -1, tweetDate: -1, savedAt: -1, text: -1}
	for i, raw := range header {
		name := strings.ToLower(strings.TrimSpace(raw))
		if i == 0 {
			name = strings.TrimPrefix(name, "\ufeff") // tolerate an Excel BOM
		}
		switch name {
		case "url":
			if columns.url < 0 {
				columns.url = i
			}
		case "media":
			if columns.media < 0 {
				columns.media = i
			}
		case "author":
			if columns.author < 0 {
				columns.author = i
			}
		case "username":
			if columns.username < 0 {
				columns.username = i
			}
		case "tweet_date":
			if columns.tweetDate < 0 {
				columns.tweetDate = i
			}
		case "saved_at":
			if columns.savedAt < 0 {
				columns.savedAt = i
			}
		case "text":
			if columns.text < 0 {
				columns.text = i
			}
		}
	}
	return columns
}

// readRows opens one collection CSV through storage.SafeJoin and parses it into
// valid rows. An unsafe filename returns a *storage.ValidationError; a missing
// file wraps ErrCollectionNotFound. A malformed row is skipped with a warning
// and never aborts the rest of the file (GAL-07).
func (r *Reader) readRows(filename string) ([]parsedRow, error) {
	path, err := storage.SafeJoin(r.dir, filename)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrCollectionNotFound, filename)
		}
		return nil, fmt.Errorf("gallery: open csv %s: %w", filename, err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	// Field counts are validated per row below and quotes are read leniently,
	// so one odd row cannot make the whole CSV unreadable.
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	header, err := reader.Read()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil // empty file: a collection with zero posts
		}
		return nil, fmt.Errorf("gallery: read header %s: %w", filename, err)
	}

	columns := resolveColumns(header)
	if !columns.hasRequired() {
		r.warn("gallery: csv header has no gallery columns; collection reads as empty",
			"filename", filename)
		return nil, nil
	}

	width := len(header)
	rows := make([]parsedRow, 0, 32)
	for line := 2; ; line++ {
		record, err := reader.Read()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			// encoding/csv cannot always resynchronise after a genuine parse
			// error, so keep what was read and log instead of discarding the
			// whole collection.
			r.warn("gallery: stopped reading csv after a parse error",
				"filename", filename, "line", line, "error", err)
			break
		}

		row, reason := r.parseRow(filename, line, width, columns, record)
		if reason != "" {
			r.warn("gallery: skipping malformed row",
				"filename", filename, "line", line, "reason", reason)
			continue
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// parseRow validates one CSV record and builds a Post. It returns a non-empty
// reason when the row must be skipped.
func (r *Reader) parseRow(filename string, line, width int, columns columnIndexes, record []string) (parsedRow, string) {
	if len(record) != width {
		return parsedRow{}, fmt.Sprintf("expected %d fields, got %d", width, len(record))
	}

	rawURL := strings.TrimSpace(columns.field(record, columns.url))
	author := strings.TrimSpace(columns.field(record, columns.author))
	username := strings.TrimSpace(columns.field(record, columns.username))
	tweetDate := strings.TrimSpace(columns.field(record, columns.tweetDate))
	savedAt := strings.TrimSpace(columns.field(record, columns.savedAt))
	text := columns.field(record, columns.text)

	switch {
	case rawURL == "":
		return parsedRow{}, "missing url"
	case author == "":
		return parsedRow{}, "missing author"
	case username == "":
		return parsedRow{}, "missing username"
	case tweetDate == "":
		return parsedRow{}, "missing tweet_date"
	case savedAt == "":
		return parsedRow{}, "missing saved_at"
	}

	tweetTime, err := time.Parse(time.RFC3339, tweetDate)
	if err != nil {
		return parsedRow{}, "tweet_date is not RFC3339"
	}
	savedTime, err := time.Parse(time.RFC3339, savedAt)
	if err != nil {
		return parsedRow{}, "saved_at is not RFC3339"
	}

	// tweet_id is derived from the stored URL; the CSV gains no new column
	// (GAL-08). The canonical form is what the gallery returns.
	canonicalURL, tweetID, err := storage.NormalizeURL(rawURL)
	if err != nil {
		return parsedRow{}, "url is not a canonical tweet URL"
	}

	post := Post{
		TweetID:   tweetID,
		URL:       canonicalURL,
		Media:     r.parseMedia(filename, line, columns.field(record, columns.media)),
		Author:    author,
		Username:  username,
		TweetDate: tweetTime.UTC().Format(time.RFC3339),
		SavedAt:   savedTime.UTC().Format(time.RFC3339),
		Text:      text,
	}
	return parsedRow{post: post, tweetTime: tweetTime, savedTime: savedTime}, ""
}

// parseMedia decodes the JSON `media` cell. An empty cell, `null` and invalid
// JSON all yield an empty non-nil slice; only invalid JSON logs a warning, and
// the post is still returned as a text card (GAL-06).
func (r *Reader) parseMedia(filename string, line int, raw string) []string {
	cell := strings.TrimSpace(raw)
	if cell == "" {
		return []string{}
	}
	var media []string
	if err := json.Unmarshal([]byte(cell), &media); err != nil {
		r.warn("gallery: malformed media json; treating the row as media-less",
			"filename", filename, "line", line)
		return []string{}
	}
	if media == nil {
		return []string{}
	}
	return media
}

// warn emits a read-layer warning through the shared structured logger. Only
// identifiers and metadata are logged, never tweet text.
func (r *Reader) warn(msg string, args ...any) {
	r.log.Slog().Warn(msg, args...)
}

// listCollections returns the filenames in the storage directory that are
// valid collections: regular files matching ^[a-z0-9][a-z0-9-]*\.csv$. That
// excludes index.json, *.csv.bak, temp files, dotfiles, directories and
// symlinks by construction (GAL-01).
func (r *Reader) listCollections() ([]string, error) {
	if r.dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil // no storage directory yet: the gallery is empty
		}
		return nil, fmt.Errorf("gallery: read storage directory: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if storage.ValidateFilename(entry.Name()) != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names, nil
}

// Collections returns one summary per valid collection, ordered by
// last_saved_at DESC with timestamp-less collections last (GAL-01…GAL-04). A
// single unreadable file is skipped with a warning rather than failing every
// other collection.
func (r *Reader) Collections() ([]Collection, error) {
	names, err := r.listCollections()
	if err != nil {
		return nil, err
	}

	summaries := make([]collectionSummary, 0, len(names))
	for _, name := range names {
		rows, err := r.readRows(name)
		if err != nil {
			r.warn("gallery: skipping unreadable collection", "filename", name, "error", err)
			continue
		}
		summaries = append(summaries, summarize(name, rows))
	}
	sortSummaries(summaries)

	collections := make([]Collection, 0, len(summaries))
	for _, summary := range summaries {
		collections = append(collections, summary.collection)
	}
	return collections, nil
}
