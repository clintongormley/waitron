import { currentLocale } from "./t.js";

// Localised copy for the raw error CODES the schedule routes reject with. The till's API client rejects
// with a bare `{ code }` (see api/client.ts), and this module is the ONE place a schedule code becomes
// human copy for an error banner. It carries a load-bearing guarantee: an operator must NEVER see the
// raw wire code. A code that isn't in the table below degrades to the GENERIC sentence rather than being
// rendered verbatim — an unmapped code is a copy gap, not a string to show a user — so `codeMessage`
// can only ever return a sentence, never a code (the #82 dashboard-i18n pattern, dashboard/src/i18n/codes.ts).
//
// English is the source of truth here too, and `apps/*` is exempt from the english-only guard, so the
// Spanish is user-facing translation, not schema vocabulary. Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "swap.not_permitted": {
    en: "You can only offer your own shifts and accept swaps offered to you",
    es: "Solo puedes ofrecer tus propios turnos y aceptar los cambios que te ofrezcan",
  },
  "swap.not_acceptable": {
    en: "That swap can no longer be accepted",
    es: "Ese cambio ya no se puede aceptar",
  },
  "swap.not_found": {
    en: "That swap could not be found",
    es: "No se ha encontrado ese cambio de turno",
  },
  "shift.not_found": {
    en: "That shift could not be found",
    es: "No se ha encontrado ese turno",
  },
  "absence.overlaps": {
    en: "You already have time off that overlaps those dates",
    es: "Ya tienes una ausencia que se solapa con esas fechas",
  },
  "session.required": {
    en: "Your shift session has ended — please log in again",
    es: "Tu sesión ha terminado. Vuelve a iniciar sesión",
  },
  "management.request_invalid": {
    en: "Check the form and try again",
    es: "Revisa el formulario e inténtalo de nuevo",
  },
  "shared.invalid_id": {
    en: "That request isn't valid",
    es: "Esa solicitud no es válida",
  },
  "server.internal": {
    en: "Something went wrong, try again",
    es: "Algo salió mal, inténtalo de nuevo",
  },
};

// The message for any code not in CODE_MESSAGES. Deliberately the SAME entry as `server.internal`: an
// unmapped code and an internal error are the same thing to the operator — something failed, retry —
// and neither ever exposes the underlying code. Referencing the entry keeps the two in step.
const GENERIC = CODE_MESSAGES["server.internal"]!;

/**
 * Resolve an error `code` to localised copy for `locale` (default: the active locale). `locale` may be
 * a full BCP-47 tag ("es-ES"): the region subtag is stripped before the lookup, so "es-ES" resolves to
 * "es". An unknown code degrades to the GENERIC message and an unknown language to the English copy — so
 * the return is always a readable sentence and NEVER the raw code.
 */
export function codeMessage(code: string, locale: string = currentLocale()): string {
  // Own-key check, not `?? GENERIC`: a code colliding with an Object.prototype member (`toString`,
  // `constructor`, …) would resolve the inherited method under a bare lookup. Object.hasOwn keeps the
  // "only ever a sentence" guarantee true for every string input.
  const entry = Object.hasOwn(CODE_MESSAGES, code) ? CODE_MESSAGES[code]! : GENERIC;
  const language = locale.split("-")[0];
  return language === "es" ? entry.es : entry.en;
}
