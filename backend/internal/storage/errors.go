package storage

import "errors"

// ValidationError marks a request problem that the API must map to HTTP 400.
type ValidationError struct {
	Reason string
}

func (e *ValidationError) Error() string { return e.Reason }

// DuplicateError marks a globally duplicate Tweet Status ID (HTTP 409).
type DuplicateError struct {
	TweetID string
}

func (e *DuplicateError) Error() string {
	return "tweet " + e.TweetID + " is already saved"
}

// Unwrap makes errors.Is(err, ErrDuplicate) work.
func (e *DuplicateError) Unwrap() error { return ErrDuplicate }

// ErrDuplicate is the sentinel duplicate error.
var ErrDuplicate = errors.New("duplicate tweet")

// SchemaMismatchError marks a CSV file whose header predates the current
// schema, i.e. one that still uses the pre-media six-column layout. The API
// maps it to HTTP 500: the request itself was fine, the on-disk data needs the
// one-off migration documented in Scripts/README.md of the data repository.
type SchemaMismatchError struct {
	Filename string
	Found    string
}

func (e *SchemaMismatchError) Error() string {
	return "csv " + e.Filename + " has an outdated header (" + e.Found +
		"); run Scripts/migrate_schema.py before saving"
}
