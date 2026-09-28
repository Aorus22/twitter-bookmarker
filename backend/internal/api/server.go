// Package api exposes the loopback-only HTTP contract over the persistence
// layer.
package api

import (
	"net/http"
	"strings"

	"twitter-bookmarker/internal/config"
	"twitter-bookmarker/internal/logging"
	"twitter-bookmarker/internal/model"
)

// maxBodyBytes caps the request body (PRD: strict, bounded payloads).
const maxBodyBytes = 1 << 20 // 1 MiB

// BookmarkStore is the persistence surface the API needs.
//
// Index is part of it rather than a separate interface because both read the
// same database, so there is no second thing to keep in step.
type BookmarkStore interface {
	Save(req model.SaveRequest) (model.SaveResponse, error)
	Index() (map[string]model.IndexEntry, error)
}

type server struct {
	store  BookmarkStore
	log    *logging.Logger
	static *staticHandler
}

// NewServer builds the HTTP handler. One process serves both APIs and the built
// web app (PRD-2 §11): the API patterns are registered first, so they always
// take precedence, and the root pattern serves web/dist plus the SPA fallback.
//
// Routes are registered without a method and gated by methodGate because a
// method-less catch-all shadows the ServeMux's automatic 405 (see methodGate).
//
// The dist directory is resolved through config.WebDir (TWITTER_BOOKMARKER_WEB_DIR
// override, then cwd, then executable-relative candidates) and reported once.
// A missing build never prevents construction: the API keeps working and "/"
// explains how to build the app (PROD-05).
func NewServer(store BookmarkStore, log *logging.Logger) http.Handler {
	if log == nil {
		log = logging.Discard()
	}
	webDir, webDirFound := config.WebDir()
	if webDirFound {
		log.WebAssets(webDir)
	} else {
		log.WebAssetsMissing(webDir)
	}
	s := &server{
		store:  store,
		log:    log,
		static: newStaticHandler(webDir),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", methodGate(http.MethodGet, s.handleHealth))
	mux.HandleFunc("/v1/index", methodGate(http.MethodGet, s.handleIndex))
	mux.HandleFunc("/v1/bookmarks", methodGate(http.MethodPost, s.handleSave))
	// Read-only gallery API (PRD-2 §36). A non-GET method on either pattern is
	// answered with 405, so the API can never be written to.
	mux.HandleFunc("/api/gallery/collections", methodGate(http.MethodGet, s.handleGalleryCollections))
	mux.HandleFunc("/api/gallery/collections/{slug}/posts", methodGate(http.MethodGet, s.handleGalleryPosts))

	// Unknown /api/* and /v1/* paths are API 404s for every method, never the
	// SPA shell (PROD-02, PROD-04, PRD-2 §56/§57). The trailing-slash patterns
	// cover the subtrees; the exact patterns answer /api and /v1 without the
	// ServeMux's subtree redirect.
	mux.HandleFunc("/api", s.handleUnknownAPI)
	mux.HandleFunc("/api/", s.handleUnknownAPI)
	mux.HandleFunc("/v1", s.handleUnknownAPI)
	mux.HandleFunc("/v1/", s.handleUnknownAPI)

	// Everything else is the built SPA: a real file from web/dist, or the
	// index.html fallback for a client route (PROD-01, PROD-03).
	mux.HandleFunc("/", s.handleStatic)

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
