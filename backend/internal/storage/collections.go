package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"twitter-bookmarker/internal/model"
)

// The collection resource: creating, renaming, colouring and ordering a
// category, and listing what exists.
//
// This is deliberately separate from Save. A save *touches* a collection because
// a bookmark has to belong to one, and it creates the collection on first use so
// the archive keeps working for a client that never calls these endpoints at all.
// These functions are the explicit user-facing operations: "add a category",
// "rename it", "colour it", "move it to the top".

// ColorPattern is the only colour shape the backend stores: `#rrggbb`.
//
// An empty string is also accepted, meaning "no colour chosen". Anything else —
// a named colour, a three-digit hex, a CSS function — is refused rather than
// stored, because every client parses this value to paint a dot and the backend
// is the one place that can guarantee they all get something paintable.
var ColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// NormalizeColor validates a colour and lowercases it, so two spellings of the
// same colour cannot look like a change.
func NormalizeColor(raw string) (string, error) {
	color := strings.TrimSpace(raw)
	if color == "" {
		return "", nil
	}
	if !ColorPattern.MatchString(color) {
		return "", &ValidationError{Reason: "color must be #rrggbb"}
	}
	return strings.ToLower(color), nil
}

// CollectionPatch is one partial update to a collection.
//
// Pointers rather than zero values, because the three fields have different
// meanings when absent: an absent name leaves the name alone, while an empty
// colour is a real instruction ("go back to the default"). The caller builds this
// from whichever JSON fields were present.
type CollectionPatch struct {
	Name  *string
	Color *string
	Order *int
}

// IsEmpty reports whether the patch would change nothing.
func (p CollectionPatch) IsEmpty() bool {
	return p.Name == nil && p.Color == nil && p.Order == nil
}

// ListCollections returns every collection in display order.
//
// Order is data, not a query: `sort_order` is what the user arranged, and the
// slug is only the deterministic tie-break for rows that share a position (two
// collections created in the same millisecond by a client that never reordered).
//
// The counts are deliberately left at zero. A caller that wants the homepage
// summaries — post counts, cover media, the newest saved_at — reads the gallery
// API, which owns that projection; this endpoint answers "what are my
// categories", including ones nothing has been saved into yet.
func (s *Store) ListCollections() ([]model.Collection, error) {
	if s.conn == nil {
		return nil, errors.New("store is not open")
	}
	return listCollections(s.conn)
}

// Collection returns one collection by slug.
func (s *Store) Collection(slug string) (model.Collection, error) {
	if err := ValidateSlug(slug); err != nil {
		return model.Collection{}, err
	}
	if s.conn == nil {
		return model.Collection{}, errors.New("store is not open")
	}
	row := s.conn.QueryRow(
		`SELECT slug, name, color, sort_order FROM collections WHERE slug = ?`, slug,
	)
	collection, err := scanCollection(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Collection{}, &CollectionNotFoundError{Slug: slug}
	}
	return collection, err
}

// CreateCollection adds a category at the end of the list.
//
// The caller supplies both the slug and the display name: the backend does not
// own slugify rules, and the extension and the web client that build a name for
// the user already have them. The slug is validated like any other.
//
// The position is max(sort_order)+1 rather than a supplied value, because
// "appended" is the only ordering a create can mean; moving it afterwards is
// what the order endpoint is for.
//
// Error classification:
//   - *ValidationError        → caller maps to 400
//   - *CollectionExistsError  → caller maps to 409
//   - anything else           → caller maps to 500
func (s *Store) CreateCollection(slug, name, color string) (model.Collection, error) {
	if err := ValidateSlug(slug); err != nil {
		return model.Collection{}, err
	}
	// Unlike a save, which derives a name from the slug for a client that sends
	// none, creating a category *is* the name: an empty one would show as nothing
	// in all three clients, so it is refused rather than guessed at.
	if strings.TrimSpace(name) == "" {
		return model.Collection{}, &ValidationError{Reason: "name is required"}
	}
	resolved, err := collectionName(slug, name)
	if err != nil {
		return model.Collection{}, err
	}
	derived, err := Slugify(resolved)
	if err != nil {
		return model.Collection{}, err
	}
	if derived != slug {
		// A mismatch means the caller's slug and the name disagree, which the
		// API prevents by deriving the slug itself. Reporting it beats storing a
		// collection whose key does not match its name.
		return model.Collection{}, &ValidationError{
			Reason: "slug does not match the name; send the name and let the backend derive the slug",
		}
	}
	normalizedColor, err := NormalizeColor(color)
	if err != nil {
		return model.Collection{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.conn == nil {
		return model.Collection{}, errors.New("store is not open")
	}

	tx, err := s.conn.Begin()
	if err != nil {
		return model.Collection{}, fmt.Errorf("begin create collection %s: %w", slug, err)
	}
	defer func() { _ = tx.Rollback() }()

	var next int
	if err := tx.QueryRow(`SELECT coalesce(max(sort_order), -1) + 1 FROM collections`).Scan(&next); err != nil {
		return model.Collection{}, fmt.Errorf("resolve order for collection %s: %w", slug, err)
	}

	if _, err := tx.Exec(
		`INSERT INTO collections(slug, name, created_at, color, sort_order) VALUES(?, ?, ?, ?, ?)`,
		slug, resolved, nowUTC(), normalizedColor, next,
	); err != nil {
		if isUniqueViolation(err) {
			return model.Collection{}, &CollectionExistsError{Slug: slug}
		}
		return model.Collection{}, fmt.Errorf("create collection %s: %w", slug, err)
	}

	if err := tx.Commit(); err != nil {
		return model.Collection{}, fmt.Errorf("commit create collection %s: %w", slug, err)
	}

	s.log.CollectionCreated(slug)
	return model.Collection{Slug: slug, Name: resolved, Color: normalizedColor, Order: next}, nil
}

// UpdateCollection applies a partial change to one collection and returns the
// result.
//
// A new name recomputes the slug, because the slug is derived from the name and
// has always been. The bookmarks follow: they reference `collection_id`, never
// the slug, so a rename cannot orphan a single row. What does change is the URL:
// a gallery link built from the old slug stops resolving, which is the same
// trade-off the extension made before the backend owned categories.
//
// An unknown current slug is a 404, and a slug the *new* name collides with is a
// 409 rather than a silent merge.
//
// Error classification:
//   - *ValidationError        → caller maps to 400
//   - *CollectionNotFoundError → caller maps to 404
//   - *CollectionExistsError  → caller maps to 409
//   - anything else           → caller maps to 500
func (s *Store) UpdateCollection(slug string, patch CollectionPatch) (model.Collection, error) {
	if err := ValidateSlug(slug); err != nil {
		return model.Collection{}, err
	}
	if patch.IsEmpty() {
		return model.Collection{}, &ValidationError{Reason: "nothing to update"}
	}

	var (
		resolvedName  *string
		resolvedColor *string
		resolvedSlug  = slug
	)
	if patch.Name != nil {
		name, err := collectionName(slug, *patch.Name)
		if err != nil {
			return model.Collection{}, err
		}
		resolvedName = &name
		newSlug, err := Slugify(*patch.Name)
		if err != nil {
			return model.Collection{}, err
		}
		resolvedSlug = newSlug
	}
	if patch.Color != nil {
		color, err := NormalizeColor(*patch.Color)
		if err != nil {
			return model.Collection{}, err
		}
		resolvedColor = &color
	}
	if patch.Order != nil && *patch.Order < 0 {
		return model.Collection{}, &ValidationError{Reason: "order must not be negative"}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.conn == nil {
		return model.Collection{}, errors.New("store is not open")
	}

	tx, err := s.conn.Begin()
	if err != nil {
		return model.Collection{}, fmt.Errorf("begin update collection %s: %w", slug, err)
	}
	defer func() { _ = tx.Rollback() }()

	// The row must exist, and its current order is needed when the patch only
	// moves it. Reading it here also turns "unknown slug" into a 404 instead of
	// an UPDATE that touched nothing.
	var current model.Collection
	row := tx.QueryRow(
		`SELECT slug, name, color, sort_order FROM collections WHERE slug = ?`, slug,
	)
	current, err = scanCollection(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Collection{}, &CollectionNotFoundError{Slug: slug}
	}
	if err != nil {
		return model.Collection{}, fmt.Errorf("read collection %s: %w", slug, err)
	}

	name := current.Name
	if resolvedName != nil {
		name = *resolvedName
	}
	color := current.Color
	if resolvedColor != nil {
		color = *resolvedColor
	}
	order := current.Order
	if patch.Order != nil {
		order = *patch.Order
	}

	if _, err := tx.Exec(
		`UPDATE collections SET slug = ?, name = ?, color = ?, sort_order = ? WHERE slug = ?`,
		resolvedSlug, name, color, order, slug,
	); err != nil {
		if isUniqueViolation(err) {
			return model.Collection{}, &CollectionExistsError{Slug: resolvedSlug}
		}
		return model.Collection{}, fmt.Errorf("update collection %s: %w", slug, err)
	}

	if err := tx.Commit(); err != nil {
		return model.Collection{}, fmt.Errorf("commit update collection %s: %w", slug, err)
	}

	s.log.CollectionUpdated(slug, resolvedSlug)
	return model.Collection{Slug: resolvedSlug, Name: name, Color: color, Order: order}, nil
}

// ReorderCollections writes a new order for the collections named in slugs, in
// that order, and returns the whole list in its new arrangement.
//
// The caller states the order it just drew, whole. That is what makes the
// operation atomic: a request naming every collection cannot leave the list
// half-arranged, and re-sending the same list changes nothing. A slug the
// database does not know aborts the whole request — a client reordering from a
// stale list should be told to refetch, not silently given a list that omits
// whatever it had not seen.
//
// Collections the request does not mention keep their relative order and are
// placed after the named ones, so a partial list is still a well-defined
// instruction. The shift is computed in Go rather than as `sort_order + n`,
// because that arithmetic can collide with a named collection's new position; the
// list is a few dozen rows, so a full pass costs nothing and cannot be wrong.
//
// Error classification:
//   - *ValidationError        → caller maps to 400
//   - *CollectionNotFoundError → caller maps to 404
//   - anything else           → caller maps to 500
func (s *Store) ReorderCollections(slugs []string) ([]model.Collection, error) {
	if len(slugs) == 0 {
		return nil, &ValidationError{Reason: "slugs is required"}
	}
	for _, slug := range slugs {
		if err := ValidateSlug(slug); err != nil {
			return nil, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.conn == nil {
		return nil, errors.New("store is not open")
	}

	tx, err := s.conn.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin reorder collections: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Every collection as it stands now, in display order. The unnamed ones are
	// appended in exactly this order, which is what makes a partial request
	// keep whatever arrangement it did not mention.
	existing, err := listCollections(tx)
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(existing))
	for _, collection := range existing {
		known[collection.Slug] = true
	}

	seen := make(map[string]bool, len(slugs))
	reordered := make([]string, 0, len(existing))
	for _, slug := range slugs {
		if !known[slug] {
			return nil, &CollectionNotFoundError{Slug: slug}
		}
		if seen[slug] {
			return nil, &ValidationError{Reason: "slugs must not repeat"}
		}
		seen[slug] = true
		reordered = append(reordered, slug)
	}
	for _, collection := range existing {
		if !seen[collection.Slug] {
			reordered = append(reordered, collection.Slug)
		}
	}

	for index, slug := range reordered {
		if _, err := tx.Exec(
			`UPDATE collections SET sort_order = ? WHERE slug = ?`, index, slug,
		); err != nil {
			return nil, fmt.Errorf("reorder collection %s: %w", slug, err)
		}
	}

	ordered, err := listCollections(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit reorder collections: %w", err)
	}
	s.log.CollectionsReordered(len(slugs))
	return ordered, nil
}

// collectionQueryer is the subset of *sql.DB and *sql.Tx that listing needs, so
// one query serves both the plain call and the in-transaction one.
type collectionQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// rowScanner is the shape shared by *sql.Row and *sql.Rows for the collection
// columns, so one scan helper serves both.
type rowScanner interface {
	Scan(dest ...any) error
}

// listCollections reads every collection in display order from either a
// transaction or the pool.
func listCollections(q collectionQueryer) ([]model.Collection, error) {
	rows, err := q.Query(
		`SELECT slug, name, color, sort_order FROM collections
		  ORDER BY sort_order, created_at, slug`,
	)
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}
	defer rows.Close()

	collections := make([]model.Collection, 0, 16)
	for rows.Next() {
		collection, err := scanCollection(rows)
		if err != nil {
			return nil, fmt.Errorf("list collections: %w", err)
		}
		collections = append(collections, collection)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}
	return collections, nil
}

func scanCollection(row rowScanner) (model.Collection, error) {
	var collection model.Collection
	if err := row.Scan(&collection.Slug, &collection.Name, &collection.Color, &collection.Order); err != nil {
		return model.Collection{}, err
	}
	return collection, nil
}

// isUniqueViolation reports whether err is a SQLite uniqueness failure, which for
// a collection means the slug is taken.
//
// It matches the message rather than a driver error code because the pure-Go
// SQLite driver exposes no typed constraint error, and the message is the part
// of the contract that has been stable across its versions.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// nowUTC is the timestamp every write stamps, in the one format the schema uses.
func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}
