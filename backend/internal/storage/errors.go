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
