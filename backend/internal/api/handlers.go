package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"twitter-bookmarker/internal/model"
	"twitter-bookmarker/internal/storage"
)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, model.HealthResponse{Status: "ok"})
}

// handleIndex answers GET /v1/index with every saved tweet keyed by Status ID.
//
// It reads straight from the database, so it can never disagree with what the
// gallery serves. A read failure is a 500 rather than an empty index: answering
// `{"items":{}}` on error would tell the extension that nothing is saved and
// invite it to save duplicates.
func (s *server) handleIndex(w http.ResponseWriter, _ *http.Request) {
	if s.store == nil {
		writeJSON(w, http.StatusInternalServerError, model.ErrorResponse{
			Status: "error",
			Reason: "internal error",
		})
		return
	}

	items, err := s.store.Index()
	if err != nil {
		s.log.FilesystemError("index", err)
		writeJSON(w, http.StatusInternalServerError, model.ErrorResponse{
			Status: "error",
			Reason: "internal error",
		})
		return
	}
	if items == nil {
		items = map[string]model.IndexEntry{}
	}
	writeJSON(w, http.StatusOK, model.IndexResponse{Items: items})
}

func (s *server) handleSave(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeJSON(w, http.StatusInternalServerError, model.ErrorResponse{
			Status: "error",
			Reason: "internal error",
		})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var req model.SaveRequest
	if err := dec.Decode(&req); err != nil {
		reason := "invalid payload"
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			reason = "request body too large"
		}
		s.log.InvalidRequest(reason)
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{Status: "error", Reason: reason})
		return
	}
	if dec.More() {
		s.log.InvalidRequest("unexpected trailing data")
		writeJSON(w, http.StatusBadRequest, model.ErrorResponse{Status: "error", Reason: "invalid payload"})
		return
	}

	resp, err := s.store.Save(req)
	if err != nil {
		var dup *storage.DuplicateError
		var invalid *storage.ValidationError
		switch {
		case errors.As(err, &dup):
			s.log.Duplicate(dup.TweetID)
			writeJSON(w, http.StatusConflict, model.DuplicateResponse{
				Status:  "duplicate",
				TweetID: dup.TweetID,
			})
		case errors.As(err, &invalid):
			s.log.InvalidRequest(invalid.Reason)
			writeJSON(w, http.StatusBadRequest, model.ErrorResponse{
				Status: "error",
				Reason: invalid.Reason,
			})
		default:
			s.log.FilesystemError("save bookmark", err)
			writeJSON(w, http.StatusInternalServerError, model.ErrorResponse{
				Status: "error",
				Reason: "internal error",
			})
		}
		return
	}

	writeJSON(w, http.StatusCreated, resp)
}
