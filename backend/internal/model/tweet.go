// Package model holds the domain types shared by the persistence layer and
// the HTTP API. JSON tags mirror the PRD shapes exactly.
package model

// TweetInput is the raw tweet metadata accepted from the extension.
// Text is the only field that may be empty (media-only tweets). Media is
// optional: an older extension omits it and the row is written with `[]`.
type TweetInput struct {
	URL       string   `json:"url"`
	Media     []string `json:"media"`
	Author    string   `json:"author"`
	Username  string   `json:"username"`
	TweetDate string   `json:"tweet_date"`
	Text      string   `json:"text"`
}

// IndexEntry is one derived index record, keyed by Tweet Status ID.
type IndexEntry struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
	SavedAt  string `json:"saved_at"`
}

// IndexFile is the on-disk derived index (index.json).
type IndexFile struct {
	Version int                   `json:"version"`
	Tweets  map[string]IndexEntry `json:"tweets"`
}

// SaveRequest is the POST /v1/bookmarks request body.
type SaveRequest struct {
	Filename string     `json:"filename"`
	Tweet    TweetInput `json:"tweet"`
}

// SaveResponse is the 201 response body.
type SaveResponse struct {
	Status   string `json:"status"`
	TweetID  string `json:"tweet_id"`
	URL      string `json:"url"`
	Filename string `json:"filename"`
	SavedAt  string `json:"saved_at"`
}

// DuplicateResponse is the 409 response body.
type DuplicateResponse struct {
	Status  string `json:"status"`
	TweetID string `json:"tweet_id"`
}

// IndexResponse is the GET /v1/index response body.
type IndexResponse struct {
	Items map[string]IndexEntry `json:"items"`
}

// HealthResponse is the GET /health response body.
type HealthResponse struct {
	Status string `json:"status"`
}

// ErrorResponse is the shape used for 400/500 responses. The exact error body
// shape is an implementation detail; only the status codes are contractual.
type ErrorResponse struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}
