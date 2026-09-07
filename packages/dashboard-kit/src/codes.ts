import { currentLocale, pickLocale } from "./i18n.js";

// The dashboard's error/status CODE → localised copy resolver. Lifted from
// apps/dashboard/src/i18n/codes.ts, backed by a registry a module fills at load rather than the app's
// module-level CODE_MESSAGES literal. It carries a load-bearing guarantee: an operator must NEVER see
// a raw wire code — an unregistered code degrades to GENERIC, so codeMessage returns only ever a
// sentence, never a code and never undefined.

// The message shown for any code not in the registry — the same copy as `server.internal`: an unmapped
// code and an internal error are the same thing to the operator (something failed, retry is the move).
const GENERIC = { en: "Something went wrong, try again", es: "Algo salió mal, inténtalo de nuevo" };

const messages: Record<string, { en: string; es: string }> = {};

/** Merge a module's code → copy table into the registry. Called at module load. */
export function registerCodeMessages(table: Record<string, { en: string; es: string }>): void {
  Object.assign(messages, table);
}

/**
 * Resolve an error/status `code` to localised copy (default: the active locale). `l` may be a full
 * BCP-47 tag ("es-ES"): pickLocale strips the region before the lookup. An unregistered code degrades
 * to GENERIC and an unknown language to the English copy — always a readable sentence, NEVER the code.
 */
export function codeMessage(code: string, l: string = currentLocale()): string {
  // Object.hasOwn, NOT `?? GENERIC`: a code colliding with an Object.prototype member (`toString`,
  // `constructor`, `hasOwnProperty`) resolves the inherited member (truthy) under a `??`, skipping
  // GENERIC — pickLocale then returns undefined, a blank banner. The own-key check keeps the "only
  // ever a sentence, never the raw code and never undefined" guarantee true for EVERY string.
  return pickLocale(Object.hasOwn(messages, code) ? messages[code] : GENERIC, l);
}

/**
 * Extract the wire error CODE from a rejected value. The dashboard's API client rejects with a bare
 * `{ code }`; this pulls that code out, falling back to `fallback` (default `server.internal`) when the
 * rejection carries none — the companion to codeMessage.
 */
export function codeOf(error: unknown, fallback = "server.internal"): string {
  return (error as { code?: string }).code ?? fallback;
}
