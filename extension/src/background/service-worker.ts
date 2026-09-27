/**
 * Extension service worker (Manifest V3).
 *
 * Phase 2 scope: exist, bundle cleanly as an ES module, and publish the message
 * contract scaffolding. Phase 4 replaces the `not_implemented` replies with the
 * real backend HTTP client (`GET /health`, `GET /v1/index`, `POST /v1/bookmarks`)
 * so that all backend traffic is centralized here (PRD §25, §53).
 */

import { isExtensionMessage } from "../shared/messages.ts";
import type { ExtensionMessage, ExtensionResponse } from "../shared/messages.ts";

chrome.runtime.onInstalled.addListener(() => {
  console.info("[twitter-bookmarker] service worker installed");
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void,
  ): boolean => {
    if (!isExtensionMessage(message)) return false;

    switch (message.type) {
      case "HEALTH_CHECK":
        // Phase 4: GET {BACKEND_BASE_URL}/health
        sendResponse({ ok: false, connected: false });
        return false;
      case "GET_SAVED_INDEX":
        // Phase 4: GET {BACKEND_BASE_URL}/v1/index
        sendResponse({ ok: false, index: null, error: "not_implemented" });
        return false;
      case "SAVE_TWEET":
        // Phase 4: POST {BACKEND_BASE_URL}/v1/bookmarks
        sendResponse({ ok: false, error: "not_implemented" });
        return false;
    }
  },
);
