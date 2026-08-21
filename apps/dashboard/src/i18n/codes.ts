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
  // Service-status configuration (apps/server/src/tables.ts). The editor's per-item mutations reject
  // with these when a label collides, a status has been removed, or one has been deactivated.
  "status.label_taken": {
    en: "A status with that name already exists",
    es: "Ya existe un estado con ese nombre",
  },
  "status.not_found": {
    en: "That status no longer exists",
    es: "Ese estado ya no existe",
  },
  "status.inactive": {
    en: "That status is deactivated",
    es: "Ese estado está desactivado",
  },
  // Floor-plan zone + table configuration (apps/server/src/tables.ts, FP-1). The floor-plan editor's
  // per-item mutations reject with these when a zone name / table label collides, or when a zone or
  // table (or a `zoneId` naming no zone) can no longer be found.
  "zone.name_taken": {
    en: "A zone with that name already exists",
    es: "Ya existe una zona con ese nombre",
  },
  "zone.not_found": {
    en: "That zone no longer exists",
    es: "Esa zona ya no existe",
  },
  "table.label_taken": {
    en: "A table with that name already exists",
    es: "Ya existe una mesa con ese nombre",
  },
  "table.not_found": {
    en: "That table no longer exists",
    es: "Esa mesa ya no existe",
  },
  // Floor-plan spatial placement (apps/server/src/tables.ts, FP-2). The Plano editor's canvas emits a
  // placement the server refuses when a coordinate is out of range, the shape/rotation is bad, or the
  // target zone is inactive — surfaced as this one code (its params name the FIELD, never the value).
  "placement.invalid": {
    en: "That table position isn't valid",
    es: "Esa posición de la mesa no es válida",
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
  // The ingredient form's own client-side validation message: a non-empty name is required (the column
  // is NOT NULL and a nameless ingredient is a UI error), surfaced via `codeMessage` from the form's
  // `validationError`. Client-only — the server stays authoritative.
  "ingredient.name_required": {
    en: "Enter a name",
    es: "Introduce un nombre",
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
  "roster.draft_exists": {
    en: "A draft already exists for that week",
    es: "Ya existe un borrador para esa semana",
  },
  "roster.not_draft": {
    en: "That week is already published",
    es: "Esa semana ya está publicada",
  },
  "roster.not_found": {
    en: "That roster could not be found",
    es: "No se ha encontrado ese cuadrante",
  },
  "roster.already_published": {
    en: "That roster is already published",
    es: "Ese cuadrante ya está publicado",
  },
  "roster.period_already_published": {
    en: "Another version of that week was just published",
    es: "Se acaba de publicar otra versión de esa semana",
  },
  "shift.not_found": {
    en: "That shift could not be found",
    es: "No se ha encontrado ese turno",
  },
  "shift.invalid": {
    en: "Check the shift times",
    es: "Revisa las horas del turno",
  },
  "convenio.not_found": {
    en: "Configure this location's working-time rules first",
    es: "Configura primero las reglas de jornada de este local",
  },
  "swap.not_found": {
    en: "That swap could not be found",
    es: "No se ha encontrado ese cambio de turno",
  },
  "swap.not_decidable": {
    en: "That swap can no longer be decided",
    es: "Ese cambio de turno ya no se puede decidir",
  },
  // Staff self-service faults (apps/server/src/me-api.ts): you may offer only your own shift and accept
  // only what is offered to you (swap.not_permitted); a swap already accepted/decided can't be accepted
  // again (swap.not_acceptable).
  "swap.not_permitted": {
    en: "You can only offer your own shifts, and accept only swaps offered to you",
    es: "Solo puedes ofrecer tus propios turnos y aceptar los cambios que te ofrezcan",
  },
  "swap.not_acceptable": {
    en: "That swap can no longer be accepted",
    es: "Ese cambio de turno ya no se puede aceptar",
  },
  "absence.not_found": {
    en: "That absence could not be found",
    es: "No se ha encontrado esa ausencia",
  },
  // Staff self-service time-off faults (apps/server/src/me-api.ts): the requested dates overlap time
  // off you already have (absence.overlaps), or the range is back to front (absence.invalid).
  "absence.overlaps": {
    en: "That time off overlaps time off you already have",
    es: "Esa ausencia se solapa con otra que ya tienes",
  },
  "absence.invalid": {
    en: "Check the time-off dates",
    es: "Revisa las fechas de la ausencia",
  },
  // Purchase invoices (facturas recibidas). The first three are the server codes the purchasing routes
  // reject with; the last three are the form's own client-side validation messages (mirroring the op's
  // checks for UX — the server stays authoritative).
  "purchase.not_found": {
    en: "That purchase invoice could not be found",
    es: "No se ha encontrado esa factura recibida",
  },
  "purchase.duplicate": {
    en: "That supplier invoice is already recorded",
    es: "Esa factura del proveedor ya está registrada",
  },
  "purchase.invalid": {
    en: "Check the amounts and VAT breakdown",
    es: "Revisa los importes y el desglose de IVA",
  },
  "purchase.fields_required": {
    en: "Fill in the supplier, dates and total",
    es: "Rellena el proveedor, las fechas y el total",
  },
  "purchase.lines_required": {
    en: "Add at least one VAT line",
    es: "Añade al menos una línea de IVA",
  },
  "purchase.amounts_invalid": {
    en: "Check the amounts: rates 0–100, no negatives",
    es: "Revisa los importes: tipos 0–100, sin negativos",
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
 * Extract the wire error CODE from a rejected value.
 *
 * The dashboard's API client rejects with a bare `{ code }` (see api/client.ts); this pulls that code
 * out, falling back to `fallback` (default `server.internal`) when the rejection carries none — the
 * companion to `codeMessage`, which turns the code into localised copy. The body is byte-identical to
 * the `(error as { code?: string }).code ?? …` expression the screens used to hand-copy, so hoisting it
 * here cannot change what any call site computes.
 */
export function codeOf(error: unknown, fallback = "server.internal"): string {
  return (error as { code?: string }).code ?? fallback;
}

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
