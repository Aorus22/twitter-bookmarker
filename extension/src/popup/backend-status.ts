/**
 * Popup — backend connection status (PRD §43, §44).
 *
 * On popup open, probe `GET {BACKEND_BASE_URL}/health` from the extension
 * context with a short AbortController timeout:
 *   `200 {"status":"ok"}` -> `● Connected`, anything else -> `● Disconnected`.
 *
 * The extension never starts the backend; a failed probe is simply Disconnected
 * and never becomes an unhandled rejection.
 */

import { BACKEND_BASE_URL, HEALTH_PATH, HEALTH_TIMEOUT_MS } from "../shared/constants.ts";
import type { HealthResponse } from "../shared/types.ts";

/** The `GET /health` URL used by the popup. */
export function healthUrl(): string {
  return `${BACKEND_BASE_URL}${HEALTH_PATH}`;
}

/** True only for a `200` response whose body has `status: "ok"`. */
export async function probeBackend(timeoutMs: number = HEALTH_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;

    const body = (await response.json().catch(() => null)) as HealthResponse | null;
    return body !== null && body.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface BackendStatusPanel {
  /** Run a fresh health probe and render the result. */
  check(): Promise<void>;
}

function requireEl<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`popup markup is missing #${id}`);
  return element as unknown as T;
}

export function initBackendStatus(): BackendStatusPanel {
  const statusEl = requireEl<HTMLParagraphElement>("backend-status");
  const retryButton = requireEl<HTMLButtonElement>("backend-retry");
  const textEl = statusEl.querySelector<HTMLSpanElement>(".status-text");

  let checking = false;

  function setState(state: "checking" | "connected" | "disconnected"): void {
    statusEl.classList.remove("status--checking", "status--connected", "status--disconnected");
    statusEl.classList.add(`status--${state}`);

    if (textEl) {
      textEl.textContent =
        state === "checking" ? "Checking\u2026" : state === "connected" ? "Connected" : "Disconnected";
    }
    retryButton.disabled = state === "checking";
  }

  async function check(): Promise<void> {
    if (checking) return;
    checking = true;
    setState("checking");

    // `probeBackend` already swallows fetch failures; this catch is belt-and-braces
    // so a health probe can never surface as an unhandled rejection.
    const connected = await probeBackend().catch(() => false);

    checking = false;
    setState(connected ? "connected" : "disconnected");
  }

  retryButton.addEventListener("click", () => {
    void check();
  });

  return { check };
}
