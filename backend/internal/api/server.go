// Package api exposes the loopback-only HTTP contract over the persistence
// layer.
package api

import (
	"net/http"
	"strings"

	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
)

// maxBodyBytes caps the request body (PRD: strict, bounded payloads).
const maxBodyBytes = 1 << 20 // 1 MiB

// BookmarkStore is the persistence surface the API needs.
type BookmarkStore interface {
	Save(req model.SaveRequest) (model.SaveResponse, error)
}

// IndexReader exposes the derived index to GET /v1/index.
type IndexReader interface {
	All() map[string]model.IndexEntry
}

type server struct {
	store BookmarkStore
	idx   IndexReader
	log   *logging.Logger
}

// NewServer builds the HTTP handler. Route patterns use Go 1.22 method+path
// matching, so unmatched methods get an automatic 405.
func NewServer(store BookmarkStore, idx IndexReader, log *logging.Logger) http.Handler {
	if log == nil {
		log = logging.Discard()
	}
	s := &server{store: store, idx: idx, log: log}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /v1/index", s.handleIndex)
	mux.HandleFunc("POST /v1/bookmarks", s.handleSave)

	return withExtensionCORS(mux)
}

// withExtensionCORS echoes an extension origin only. Arbitrary web origins are
// never granted access, and "*" is never returned.
func withExtensionCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isExtensionOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			if isExtensionOrigin(origin) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isExtensionOrigin(origin string) bool {
	return strings.HasPrefix(origin, "chrome-extension://") ||
		strings.HasPrefix(origin, "moz-extension://")
}
