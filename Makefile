# Twitter Bookmarker — root build/test tooling.
#
# Targets:
#   make build          build the server binary + the loadable extension dist/ + the web SPA
#   make backend        build only the Go server binary
#   make extension      build only the loadable extension dist/
#   make web            build only the production SPA into web/dist/
#   make test           run the Go suite (-race), the extension suite and the web suite
#   make dev-web        run the Vite dev server (proxies /api to 127.0.0.1:43121)
#   make dev-backend    run the Go server from source (storage: $(STORAGE_DIR))
#   make run            run the built server
#   make fmt            gofmt -w the backend sources
#   make lint           gofmt check + go vet + extension typecheck + web typecheck
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
#
# Where the built web app lives: `make run` and `make dev-backend` pass
# TWITTER_BOOKMARKER_WEB_DIR=$(WEB_DIR) so the server finds the SPA no matter
# which directory it starts from. Without that override the server resolves
# <cwd>/web/dist first, then executable-relative candidates (see
# internal/config.WebDir). A missing web/dist is not fatal: the API keeps
# working and "/" explains how to build it.
#
# `make dev-web` + `make dev-backend` are meant to run together in two shells:
# Vite serves the SPA with HMR on its own port and proxies /api to 43121, so the
# Go server does not need a SPA build at all in development.
#
# `make build` composes `backend`, `extension` and `web` because that is exactly
# the production workflow of PRD-2 §84 (build the frontend, then build/run the
# backend) and always leaves web/dist present for `make run`. The Node toolchain
# was already required for the extension build; `make backend` is the Go-only
# path for anyone who wants no Node at all.

SHELL := /bin/bash

-include .env.local

BACKEND_BIN := backend/bin/twitter-bookmarker-server
STORAGE_DIR := $(if $(TWITTER_BOOKMARKER_DIR),$(TWITTER_BOOKMARKER_DIR),$(HOME)/.twitter-bookmarker)
WEB_DIR := $(CURDIR)/web/dist

.DEFAULT_GOAL := build

.PHONY: build backend extension web test dev-web dev-backend run fmt lint clean clean-storage

build: backend extension web ## Build the server binary, the loadable extension and the web SPA.

backend: ## Build only the Go server binary.
	mkdir -p backend/bin
	cd backend && go build -o bin/twitter-bookmarker-server ./cmd/server

extension: ## Build only the loadable extension dist/.
	cd extension && npm ci && npm run build

web: ## Build only the production SPA into web/dist/.
	cd web && pnpm install --frozen-lockfile && pnpm build

test: ## Run the Go suite under -race, then the extension suite, then the web suite.
	cd backend && go test ./... -race
	cd extension && npm test
	cd web && pnpm test

verify-http: ## PRD §80 acceptance over HTTP only (no browser).
	bash scripts/check-gallery-acceptance.sh

verify-web: ## Real-browser acceptance for the SPA (agent-browser; needs `make build`).
	bash scripts/check-web-acceptance.sh

verify-trace: ## Check every PRD requirement has a traceability row.
	bash scripts/check-requirement-traceability.sh

verify: verify-http verify-trace verify-web ## Run every acceptance gate. Needs `make build`.

dev-web: ## Run the Vite dev server for the SPA (proxies /api to 127.0.0.1:43121).
	@echo "==> pair with 'make dev-backend' in another shell"
	cd web && pnpm dev

dev-backend: ## Run the Go server from source (API + web/dist; pair with `make dev-web`).
	@echo "==> storage: $(STORAGE_DIR)"
	@echo "==> web:     $(WEB_DIR)"
	cd backend && TWITTER_BOOKMARKER_DIR="$(STORAGE_DIR)" TWITTER_BOOKMARKER_WEB_DIR="$(WEB_DIR)" go run ./cmd/server

run: ## Run the built server (build it first with `make build`).
	@if [ ! -x "$(BACKEND_BIN)" ]; then \
		echo "error: $(BACKEND_BIN) not found; run 'make build' first" >&2; \
		exit 1; \
	fi
	@echo "==> storage: $(STORAGE_DIR)"
	@echo "==> web:     $(WEB_DIR)"
	TWITTER_BOOKMARKER_DIR="$(STORAGE_DIR)" TWITTER_BOOKMARKER_WEB_DIR="$(WEB_DIR)" ./$(BACKEND_BIN)

fmt: ## Format the backend sources in place.
	gofmt -w backend

lint: ## Fail on unformatted Go, vet errors, or extension/web type errors.
	@unformatted="$$(gofmt -l backend)"; \
	if [ -n "$$unformatted" ]; then \
		echo "gofmt would change:" >&2; \
		echo "$$unformatted" >&2; \
		exit 1; \
	fi
	cd backend && go vet ./...
	cd extension && npm run typecheck
	cd web && pnpm run typecheck

clean: ## Remove build outputs. User CSV/index data is never touched.
	rm -rf backend/bin extension/dist web/dist

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
