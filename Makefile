# Twitter Bookmarker — root build/test tooling.
#
# Targets:
#   make build          build the Go server binary + the loadable extension dist/
#   make test           run the Go suite (-race) and the extension suite
#   make run            run the built server
#   make fmt            gofmt -w the backend sources
#   make lint           gofmt check + go vet + extension typecheck
#   make clean          remove build outputs (never touches user data)
#   make clean-storage  DESTRUCTIVE: delete the storage directory
#
# `clean` never deletes user CSV/index data; only `clean-storage` does.
#
# Where the CSVs live: `make run` passes TWITTER_BOOKMARKER_DIR to the server, so
# the location is a property of this Makefile invocation and never needs a shell
# profile. The value is resolved in this order:
#
#   1. `make run TWITTER_BOOKMARKER_DIR=/somewhere`
#   2. `.env.local` (gitignored, so a personal path is never committed):
#          TWITTER_BOOKMARKER_DIR := $(HOME)/Personal/twitter-bookmarker
#   3. the historical default, $(HOME)/.twitter-bookmarker

SHELL := /bin/bash

-include .env.local

BACKEND_BIN := backend/bin/twitter-bookmarker-server
STORAGE_DIR := $(if $(TWITTER_BOOKMARKER_DIR),$(TWITTER_BOOKMARKER_DIR),$(HOME)/.twitter-bookmarker)

.DEFAULT_GOAL := build

.PHONY: build test run fmt lint clean clean-storage

build: ## Build the server binary and the loadable extension.
	mkdir -p backend/bin
	cd backend && go build -o bin/twitter-bookmarker-server ./cmd/server
	cd extension && npm ci && npm run build

test: ## Run the Go suite under -race, then the extension suite.
	cd backend && go test ./... -race
	cd extension && npm test

run: ## Run the built server (build it first with `make build`).
	@if [ ! -x "$(BACKEND_BIN)" ]; then \
		echo "error: $(BACKEND_BIN) not found; run 'make build' first" >&2; \
		exit 1; \
	fi
	@echo "==> storage: $(STORAGE_DIR)"
	TWITTER_BOOKMARKER_DIR="$(STORAGE_DIR)" ./$(BACKEND_BIN)

fmt: ## Format the backend sources in place.
	gofmt -w backend

lint: ## Fail on unformatted Go, vet errors, or extension type errors.
	@unformatted="$$(gofmt -l backend)"; \
	if [ -n "$$unformatted" ]; then \
		echo "gofmt would change:" >&2; \
		echo "$$unformatted" >&2; \
		exit 1; \
	fi
	cd backend && go vet ./...
	cd extension && npm run typecheck

clean: ## Remove build outputs. User CSV/index data is never touched.
	rm -rf backend/bin extension/dist

clean-storage: ## DESTRUCTIVE: delete the storage directory (all CSVs + index).
	@echo ""
	@echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
	@echo "!!  DESTRUCTIVE COMMAND                                             !!"
	@echo "!!  This permanently deletes EVERY category CSV and the derived     !!"
	@echo "!!  index under:                                                   !!"
	@echo "!!      $(STORAGE_DIR)/"
	@echo "!!                                                                  !!"
	@echo "!!  Those CSVs are the durable source of truth and are not backed   !!"
	@echo "!!  up anywhere else. There is no undo.                             !!"
	@echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
	@echo ""
	@echo "Contents about to be deleted:"
	@ls -la "$(STORAGE_DIR)" 2>/dev/null || echo "  ($(STORAGE_DIR) does not exist)"
	@echo ""
	rm -rf "$(STORAGE_DIR)"
	@echo "Removed $(STORAGE_DIR)."
