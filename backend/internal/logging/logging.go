// Package logging wraps log/slog with the small set of events the backend
// emits. Helpers deliberately accept only identifiers/metadata: tweet text is
// never logged.
package logging

import (
	"io"
	"log/slog"
)

// Logger is a thin, readable wrapper around a slog.Logger.
type Logger struct {
	l *slog.Logger
}

// New builds a text logger writing to w.
func New(w io.Writer) *Logger {
	return &Logger{
		l: slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}
}

// Discard returns a logger that drops everything (used by tests and as a
// nil-safety fallback).
func Discard() *Logger {
	return New(io.Discard)
}

// Slog exposes the underlying logger for packages that need it directly.
func (lg *Logger) Slog() *slog.Logger {
	if lg == nil || lg.l == nil {
		return slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return lg.l
}

// Startup reports the server name, listen address, storage dir and indexed
// tweet count.
func (lg *Logger) Startup(name, addr, storageDir string, indexed int) {
	lg.Slog().Info("Twitter Bookmarker server started",
		"server", name,
		"listening", addr,
		"storage", storageDir,
		"indexed_tweets", indexed,
	)
}

// IndexRebuild reports that the derived index was rebuilt from CSV files.
func (lg *Logger) IndexRebuild(dir, reason string, count int) {
	lg.Slog().Info("index rebuilt from csv files",
		"dir", dir,
		"reason", reason,
		"indexed_tweets", count,
	)
}

// WebAssets reports the directory the built single-page app is served from
// (PRD-2 §11).
func (lg *Logger) WebAssets(dir string) {
	lg.Slog().Info("serving built web app", "web_dist", dir)
}

// WebAssetsMissing reports that web/dist is absent. The server keeps serving
// the API; the message names the expected directory and how to build it
// (PROD-05). It is emitted once, at construction, not per request.
func (lg *Logger) WebAssetsMissing(dir string) {
	lg.Slog().Warn("built web app not found; the API is still available",
		"web_dist", dir,
		"hint", "run `make web` (or `cd web && pnpm build`), or set TWITTER_BOOKMARKER_WEB_DIR",
	)
}

// SaveSuccess reports a persisted bookmark by id + filename only.
func (lg *Logger) SaveSuccess(tweetID, filename string) {
	lg.Slog().Info("bookmark saved",
		"tweet_id", tweetID,
		"filename", filename,
	)
}

// Duplicate reports a rejected duplicate save.
func (lg *Logger) Duplicate(tweetID string) {
	lg.Slog().Info("duplicate bookmark rejected", "tweet_id", tweetID)
}

// InvalidRequest reports a payload/validation failure.
func (lg *Logger) InvalidRequest(reason string) {
	lg.Slog().Warn("invalid request", "reason", reason)
}

// FilesystemError reports a storage failure.
func (lg *Logger) FilesystemError(op string, err error) {
	lg.Slog().Error("filesystem error", "op", op, "error", err)
}

// IndexPersistWarning reports that the derived index could not be persisted
// while the CSV write already succeeded (CSV remains authoritative).
func (lg *Logger) IndexPersistWarning(err error) {
	lg.Slog().Warn("index persistence failed; csv remains authoritative", "error", err)
}

// Shutdown reports that a termination signal was received.
func (lg *Logger) Shutdown() {
	lg.Slog().Info("shutdown signal received; draining requests")
}
