import { currentLocale, pickLocale } from "./i18n.js";
import { GENERIC_ERROR } from "./strings.js";

const messages: Record<string, { en: string; es: string }> = {};

/** Merge a module's code → copy table into the registry. Called at module load. */
export function registerCodeMessages(table: Record<string, { en: string; es: string }>): void {
  Object.assign(messages, table);
}

/**
 * Resolve an error/status `code` to localised copy (default: the active locale). `l` may be a full
 * BCP-47 tag ("es-ES"): pickLocale strips the region before the lookup. An unregistered code degrades
 * to fallback copy and an unknown language to the English copy — always a readable sentence, NEVER the code.
 */
export function codeMessage(code: string, l: string = currentLocale()): string {
  // Inherited prototype members are not registered messages and must use the fallback copy.
  return pickLocale(Object.hasOwn(messages, code) ? messages[code] : GENERIC_ERROR, l);
}

/**
 * Extract the wire error CODE from a rejected value. The dashboard's API client rejects a refused
 * or unreachable request with an object carrying a string `code`; this pulls that code out, falling
 * back to `fallback` (default `server.internal`) when there is no string `code` — a browser
 * `DOMException`'s legacy `code` is a number.
 */
export function codeOf(error: unknown, fallback = "server.internal"): string {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : fallback;
}
