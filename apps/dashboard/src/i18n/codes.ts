import { currentLocale, pickLocale } from "./t.js";

// Localised copy for the raw error/status CODES the server and client emit.
//
// The dashboard's API client rejects with a bare `{ code }` (see api/client.ts) and several flows
// surface a status code directly. This module is the ONE place those codes become human copy, and it
// carries a load-bearing guarantee: an operator must NEVER see the raw wire code. A code that isn't in
// the table below degrades to GENERIC ("Something went wrong, try again") rather than being rendered
// verbatim — an unmapped code is a copy gap, not a string to show a user. So `codeMessage` cannot
// return a code, only ever a sentence.
//
// English is the source of truth here too, and `apps/*` is exempt from the english-only guard, so the
// Spanish below is user-facing translation, not schema vocabulary. Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "management_session.required": {
    en: "Please log in to continue",
    es: "Inicia sesión para continuar",
  },
  "management_session.expired": {
    en: "Your session has expired — please log in again",
    es: "Tu sesión ha caducado. Vuelve a iniciar sesión",
  },
  "password.invalid": {
    en: "Incorrect password, try again",
    es: "Contraseña incorrecta, inténtalo de nuevo",
  },
  "totp.invalid": {
    en: "Incorrect code, try again",
    es: "Código incorrecto, inténtalo de nuevo",
  },
  "passkey.not_registered": {
    en: "No passkey is registered for this account",
    es: "No hay ninguna passkey registrada para esta cuenta",
  },
  "passkey.verification_failed": {
    en: "Could not verify the passkey, try again",
    es: "No se pudo verificar la passkey, inténtalo de nuevo",
  },
  "passkey.challenge_expired": {
    en: "The passkey request expired, try again",
    es: "La solicitud de passkey ha caducado, inténtalo de nuevo",
  },
  "passkey.registered": {
    en: "Passkey added",
    es: "Passkey añadida",
  },
  "person.suspended": {
    en: "This account is suspended — ask a manager",
    es: "Esta cuenta está suspendida. Avisa a un responsable",
  },
  "person.not_found": {
    en: "That person could not be found",
    es: "No se ha encontrado a esa persona",
  },
  "authorization.not_permitted": {
    en: "You don't have permission to do that",
    es: "No tienes permiso para hacer eso",
  },
  "pin.too_short": {
    en: "The PIN is too short",
    es: "El PIN es demasiado corto",
  },
  "password.too_short": {
    en: "The password is too short",
    es: "La contraseña es demasiado corta",
  },
  "management.request_invalid": {
    en: "Check the form and try again",
    es: "Revisa el formulario e inténtalo de nuevo",
  },
  "layout.invalid": {
    en: "The layout isn't valid",
    es: "La disposición no es válida",
  },
  "receipt.invalid": {
    en: "The receipt settings aren't valid",
    es: "Los ajustes del recibo no son válidos",
  },
  "shared.invalid_id": {
    en: "That identifier isn't valid",
    es: "Ese identificador no es válido",
  },
  "allergen.invalid_code": {
    en: "That allergen isn't valid",
    es: "Ese alérgeno no es válido",
  },
  "product.description_required": {
    en: "Add a description in at least one language",
    es: "Añade una descripción en al menos un idioma",
  },
  "media.missing": {
    en: "No image was provided",
    es: "No se ha proporcionado ninguna imagen",
  },
  "media.read_failed": {
    en: "The image couldn't be read, try again",
    es: "No se pudo leer la imagen, inténtalo de nuevo",
  },
  "media.too_large": {
    en: "The image is too large",
    es: "La imagen es demasiado grande",
  },
  "media.unsupported_type": {
    en: "That image type isn't supported",
    es: "Ese tipo de imagen no es compatible",
  },
  "server.internal": {
    en: "Something went wrong, try again",
    es: "Algo salió mal, inténtalo de nuevo",
  },
};

// The message shown for any code not in CODE_MESSAGES. Deliberately the SAME entry as
// `server.internal`: an unmapped code and an internal error are the same thing to the operator —
// something failed and retrying is the next move — and neither ever exposes the underlying code.
// Referencing the entry (rather than re-typing its strings) keeps the two in step by construction.
const GENERIC = CODE_MESSAGES["server.internal"];

/**
 * Resolve an error/status `code` to localised copy for `locale` (default: the active locale).
 *
 * `locale` may be a full BCP-47 tag ("es-ES"): the region subtag is stripped before the lookup, so
 * "es-ES" resolves to the "es" copy. An unknown code degrades to the GENERIC message and an unknown
 * language degrades to the English copy — so the return is always a readable sentence and NEVER the
 * raw code.
 */
export function codeMessage(code: string, locale: string = currentLocale()): string {
  // Own-key check, not `?? GENERIC`: a code colliding with an Object.prototype member (`toString`,
  // `constructor`, `valueOf`, `hasOwnProperty`) resolves the inherited method — truthy, so `??` would
  // skip GENERIC and pickLocale would return undefined (an empty banner). Object.hasOwn keeps the
  // "only ever a sentence, never the raw code and never undefined" guarantee true for every string.
  const entry = Object.hasOwn(CODE_MESSAGES, code) ? CODE_MESSAGES[code] : GENERIC;
  return pickLocale(entry, locale);
}
