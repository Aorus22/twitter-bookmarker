// Package model holds the domain types shared by the persistence layer and
// the HTTP API. JSON tags are the wire contract with the extension and the web
// app.
package model

// TweetInput is the raw tweet metadata accepted from the extension.
// Text is the only field that may be empty (media-only tweets). Media is
// optional: an older extension omits it and the row is stored as `[]`.
type TweetInput struct {
	URL       string   `json:"url"`
	Media     []string `json:"media"`
	Author    string   `json:"author"`
	Username  string   `json:"username"`
	TweetDate string   `json:"tweet_date"`
	Text      string   `json:"text"`
}

// IndexEntry is one saved-bookmark record, keyed by Tweet Status ID.
type IndexEntry struct {
	URL     string `json:"url"`
	Slug    string `json:"slug"`
	SavedAt string `json:"saved_at"`
}

// SaveRequest is the POST /v1/bookmarks request body.
//
// Slug identifies the target collection. Name is the human category name the
// extension knows; it is optional, and a missing or empty value falls back to a
// name derived from the slug, so an older extension that sends only a slug still
// produces a readable collection.
type SaveRequest struct {
	Slug  string     `json:"slug"`
	Name  string     `json:"name"`
	Tweet TweetInput `json:"tweet"`
}

// SaveResponse is the 201 response body.
type SaveResponse struct {
	Status  string `json:"status"`
	TweetID string `json:"tweet_id"`
	URL     string `json:"url"`
	Slug    string `json:"slug"`
	SavedAt string `json:"saved_at"`
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
