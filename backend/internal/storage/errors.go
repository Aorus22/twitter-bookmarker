package storage

import "errors"

// ValidationError marks a request problem that the API must map to HTTP 400.
type ValidationError struct {
	Reason string
}

func (e *ValidationError) Error() string { return e.Reason }

// DuplicateError marks a globally duplicate Tweet Status ID (HTTP 409).
//
// Slug is the collection the tweet is already saved in, so the caller can offer
// to move it there instead of having to guess or ask again.
type DuplicateError struct {
	TweetID string
	Slug    string
}

func (e *DuplicateError) Error() string {
	return "tweet " + e.TweetID + " is already saved"
}

// Unwrap makes errors.Is(err, ErrDuplicate) work.
func (e *DuplicateError) Unwrap() error { return ErrDuplicate }

// ErrDuplicate is the sentinel duplicate error.
var ErrDuplicate = errors.New("duplicate tweet")

// NotFoundError marks a Tweet Status ID that is not in the live set (HTTP 404).
//
// A tweet that was deleted lives in `deleted_bookmarks`, not in `bookmarks`, so
// deleting or moving it twice is a not-found rather than a silent success: the
// caller asked for a change that did not happen.
type NotFoundError struct {
	TweetID string
}

func (e *NotFoundError) Error() string {
	return "tweet " + e.TweetID + " is not saved"
}

// Unwrap makes errors.Is(err, ErrNotFound) work.
func (e *NotFoundError) Unwrap() error { return ErrNotFound }

// ErrNotFound is the sentinel not-found error.
var ErrNotFound = errors.New("tweet not found")

// CollectionNotFoundError marks a collection slug the database does not know
// (HTTP 404): a move into a folder that was renamed or never existed, a rename
// of something already gone, or a slug missing from a reorder list.
type CollectionNotFoundError struct {
	Slug string
}

func (e *CollectionNotFoundError) Error() string {
	return "collection " + e.Slug + " does not exist"
}

// Unwrap makes errors.Is(err, ErrCollectionNotFound) work.
func (e *CollectionNotFoundError) Unwrap() error { return ErrCollectionNotFound }

// ErrCollectionNotFound is the sentinel collection-not-found error.
var ErrCollectionNotFound = errors.New("collection not found")

// CollectionExistsError marks a create or rename whose slug is already taken
// (HTTP 409).
//
// The slug is derived from the name, so this is what a second "AI & LLM" looks
// like: not a duplicate name check, but the database's own uniqueness constraint
// reported as a conflict the caller can act on. Slug carries the existing
// collection so the client can say which one was in the way.
type CollectionExistsError struct {
	Slug string
}

func (e *CollectionExistsError) Error() string {
	return "collection " + e.Slug + " already exists"
}

// Unwrap makes errors.Is(err, ErrCollectionExists) work.
func (e *CollectionExistsError) Unwrap() error { return ErrCollectionExists }

// ErrCollectionExists is the sentinel duplicate-collection error.
var ErrCollectionExists = errors.New("collection already exists")
