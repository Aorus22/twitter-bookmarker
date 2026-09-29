// Package api exposes the HTTP contract over the persistence layer. It is
// loopback-only by default; when it is moved onto another interface, every
// request from a peer that is not this machine must carry a bearer token.
package api

import (
	"crypto/subtle"
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
//
// Delete and Reassign are the curation surface. They live here, on the bookmark
// resource, and deliberately *not* under /api/gallery: the gallery API stays
// strictly GET-only (API-07, PRD-2 §36), so a read path can never be turned into
// a write path by adding a method to it. Curation is an explicit, user-initiated
// mutation of a bookmark, which is what /v1/bookmarks already is.
type BookmarkStore interface {
	Save(req model.SaveRequest) (model.SaveResponse, error)
	Index() (map[string]model.IndexEntry, error)
	Delete(tweetID string) error
	Reassign(tweetID, slug string) error
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
	// Curation (PRD-2 §5 amended). Two separate single-method patterns rather
	// than one path accepting DELETE and PUT: methodGate then stays a one-method
	// gate, and "set this bookmark's collection" reads as the sub-resource it is.
	// Registered before the /v1/ catch-all, which only sees paths no pattern
	// matched.
	mux.HandleFunc("/v1/bookmarks/{tweet_id}", methodGate(http.MethodDelete, s.handleDeleteBookmark))
	mux.HandleFunc("/v1/bookmarks/{tweet_id}/collection", methodGate(http.MethodPut, s.handleReassignBookmark))
	// Read-only gallery API (PRD-2 §36). A non-GET method on either pattern is
	// answered with 405, so the gallery API can never be written to. Curation is
	// on /v1/bookmarks above, which keeps this guarantee intact rather than
	// carving an exception into it.
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

	return withExtensionCORS(withToken(mux, config.Token()))
}

// protectedPathPrefixes are the API surfaces a token covers when one is
// configured. /health and the built web app stay open: neither answers with
// bookmark data, and /health is how a client checks reachability before it has
// proved anything. This list is deliberately written from the routes registered
// above rather than from a wildcard, so a new route has to be added knowingly.
func isProtectedPath(path string) bool {
	for _, prefix := range []string{"/v1", "/api"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// withToken requires a bearer token from peers that are not on this machine.
//
// Loopback is exempt, and that is the whole point: the desktop extension and a
// browser on the same host keep working with no configuration, exactly as
// before, while moving the listener onto the LAN stops being a way to publish
// the bookmarks to the network. The exemption is decided from the connection's
// own RemoteAddr and never from X-Forwarded-For, so it cannot be forged by a
// remote caller; running this server behind a reverse proxy would therefore put
// every request behind the token, which is the safe direction.
func withToken(next http.Handler, token string) http.Handler {
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isProtectedPath(r.URL.Path) || config.IsLoopback(r.RemoteAddr) {
			next.ServeHTTP(w, r)
			return
		}
		if !bearerMatches(token, r.Header.Get("Authorization")) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="twitter-bookmarker"`)
			writeJSON(w, http.StatusUnauthorized, model.ErrorResponse{
				Status: "error",
				Reason: "unauthorized",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bearerMatches compares the Authorization header against the configured token
// in constant time, so a wrong token cannot be recovered by timing.
//
// An empty expected token matches nothing. withToken already returns early in
// that case, but the guard lives here too: a future caller that forgets the
// early return must not end up accepting an empty credential.
func bearerMatches(expected, header string) bool {
	const scheme = "Bearer "
	if expected == "" {
		return false
	}
	if len(header) < len(scheme) || !strings.EqualFold(header[:len(scheme)], scheme) {
		return false
	}
	presented := strings.TrimSpace(header[len(scheme):])
	// ConstantTimeCompare returns 0 for different lengths as well, so the length
	// check is folded in rather than branched on.
	return subtle.ConstantTimeCompare([]byte(presented), []byte(expected)) == 1
}

// withExtensionCORS echoes an extension origin only. Arbitrary web origins are
// never granted access, and "*" is never returned.
//
// It wraps the token check rather than sitting inside it, because a browser never
// sends Authorization on a preflight: an OPTIONS request has to be answered here,
// with the headers that let the real request follow, before any authentication
// happens.
func withExtensionCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isExtensionOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
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
