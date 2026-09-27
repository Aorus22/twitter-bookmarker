/**
 * Category filename generation (PRD §8) and validation.
 *
 * Rules, in order:
 *   lowercase -> trim -> spaces to "-" -> strip unsafe filename characters
 *   -> collapse repeated "-" -> append ".csv"
 *
 * Examples: `Linux` -> `linux.csv`, `AI & LLM` -> `ai-llm.csv`,
 * `Read Later` -> `read-later.csv`.
 *
 * An empty slug falls back to `category-<short-id>.csv`. The result of
 * `slugifyFilename` ALWAYS matches {@link FILENAME_PATTERN}, which mirrors the
 * backend's own validation (PRD §8, §52).
 */

/** Filenames the backend will accept; the extension must only ever produce these. */
export const FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.csv$/;

/** Default prefix for the empty-slug fallback. */
export const FALLBACK_PREFIX = "category";

/** Characters kept in a slug after whitespace has been converted to "-". */
const UNSAFE_CHARS = /[^a-z0-9-]/g;

/** Combining marks left behind by NFD decomposition (e.g. "é" -> "e" + U+0301). */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Deterministic, filename-safe short form of a category id.
 * `crypto.randomUUID()` output sanitizes to its first 8 alphanumerics.
 */
export function shortId(id: string): string {
  const cleaned = (id ?? "").toLowerCase().replace(UNSAFE_CHARS, "");
  return cleaned.slice(0, 8) || "00000000";
}

/**
 * Convert a human category name into the CSV filename the backend will use.
 *
 * @param name Human-readable category name, e.g. "AI & LLM".
 * @param id   Category id, used only for the empty-slug fallback.
 */
export function slugifyFilename(name: string, id: string): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(UNSAFE_CHARS, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || `${FALLBACK_PREFIX}-${shortId(id)}`}.csv`;
}

/** True when `filename` is safe to send to the backend (defense in depth). */
export function isValidFilename(filename: string): boolean {
  return typeof filename === "string" && FILENAME_PATTERN.test(filename);
}
