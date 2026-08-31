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
  "catalogue.not_found": {
    en: "That menu could not be found",
    es: "No se ha encontrado esa carta",
  },
  "authorization.not_permitted": {
    en: "You don't have permission to do that",
    es: "No tienes permiso para hacer eso",
  },
  "pin.too_short": {
    en: "The PIN is too short",
    es: "El PIN es demasiado corto",
  },
  // Login-email management (apps/server/src/management-api staff routes → identity's setEmail). The
  // Users form's create/edit rejects with these when the address is malformed or already belongs to
  // another person in the tenant (a case-insensitive unique index on the email).
  "person.email_invalid": {
    en: "That email address isn't valid",
    es: "Esa dirección de correo no es válida",
  },
  "person.email_taken": {
    en: "That email is already in use",
    es: "Ese correo ya está en uso",
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
  // A tab is already open on the target table (TS-1's one-open-tab-per-table guard) — surfaced when a
  // booking is seated onto a table that is already busy (Bookings-1 §3b).
  "tab.already_open": {
    en: "That table already has an open tab",
    es: "Esa mesa ya tiene una cuenta abierta",
  },
  // Floor-plan spatial placement (apps/server/src/tables.ts, FP-2). The Plano editor's canvas emits a
  // placement the server refuses when a coordinate is out of range, the shape/rotation is bad, or the
  // target zone is inactive — surfaced as this one code (its params name the FIELD, never the value).
  "placement.invalid": {
    en: "That table position isn't valid",
    es: "Esa posición de la mesa no es válida",
  },
  // Kitchen-station configuration (apps/server/src/kitchen.ts, KDS-1). The Cocina editor's per-item
  // mutations (and the catalogue routing selects) reject with these when a station name collides, or
  // when a station — or a routing/default target — can no longer be found (absent, another tenant's,
  // another venue's, or deactivated, all folded into the one code server-side).
  "station.name_taken": {
    en: "A station with that name already exists",
    es: "Ya existe una estación con ese nombre",
  },
  "station.not_found": {
    en: "That station no longer exists",
    es: "Esa estación ya no existe",
  },
  // Kitchen-course configuration (apps/server/src/kitchen.ts, KDS-2). The Cursos editor's per-item
  // mutations (and the product-course select) reject with these when a course name collides, or when a
  // course — or a product's default-course target — can no longer be found (absent, another tenant's,
  // another venue's, or deactivated, all folded into the one code server-side). Mirrors `station.*`.
  "course.name_taken": {
    en: "A course with that name already exists",
    es: "Ya existe un curso con ese nombre",
  },
  "course.not_found": {
    en: "That course no longer exists",
    es: "Ese curso ya no existe",
  },
  // Device management (apps/server/src/device-api.ts, device-identity-1). The revoke route rejects with
  // this when the addressed device id names no device (absent, another tenant's, or a malformed id); the
  // generate-code route's own faults (`station.not_found`, `management.request_invalid`) are mapped above.
  "device.not_found": {
    en: "That device no longer exists",
    es: "Ese dispositivo ya no existe",
  },
  "shared.invalid_id": {
    en: "That identifier isn't valid",
    es: "Ese identificador no es válido",
  },
  // Printing management (apps/server/src/print-api.ts, printing subsystem). The Impresoras screen's
  // printer create/edit rejects with `printer.invalid_config` (a transport short of its required
  // connection fields) or `printer.not_found` (an absent/edited-away printer, also from test-print); the
  // agent revoke and a printer's agent binding reject with `agent.not_found`.
  "printer.invalid_config": {
    en: "Check the printer's connection settings",
    es: "Revisa los ajustes de conexión de la impresora",
  },
  "printer.not_found": {
    en: "That printer no longer exists",
    es: "Esa impresora ya no existe",
  },
  "agent.not_found": {
    en: "That print agent no longer exists",
    es: "Ese agente de impresión ya no existe",
  },
  "allergen.invalid_code": {
    en: "That allergen isn't valid",
    es: "Ese alérgeno no es válido",
  },
  // Option-group per-option allergen overlay (modifier↔allergen association, Task 9). The per-option
  // adds/removes editor rejects with this when an operator picks the SAME allergen in both the adds
  // picker and the removes multiselect for one option — the resulting row would both contain and not
  // contain it (packages/catalogue/src/allergens.ts).
  "allergen.add_remove_conflict": {
    en: "An allergen can't be both added and removed",
    es: "Un alérgeno no puede añadirse y quitarse a la vez",
  },
  // Option-group authoring (apps/server/src/catalogue-api.ts, Task 11). The manager's group create/edit
  // rejects with this when the min/max selection bounds are inconsistent (max below min, a negative
  // min) or a required group's minimum is below 1 — the same two rules the DB CHECKs enforce, surfaced
  // as one clean code before the write.
  "options.group_invalid": {
    en: "Check the group's min/max selection settings",
    es: "Revisa los ajustes de selección mínima/máxima del grupo",
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
  // Bookings (staff-entered table reservations, Bookings-1). The server codes the booking routes reject
  // with; `table.not_found` and `tab.already_open` (both above) cover an assigned table that no longer
  // takes a party and a table already busy at seat time. The last two here are the form's own
  // client-side validation messages (mirroring the op's checks for UX).
  "booking.not_found": {
    en: "That booking could not be found",
    es: "No se ha encontrado esa reserva",
  },
  "booking.invalid": {
    en: "The party size must be 1 or more",
    es: "El número de comensales debe ser 1 o más",
  },
  "booking.invalid_transition": {
    en: "That booking can't move to that state now",
    es: "Esa reserva no puede pasar a ese estado ahora",
  },
  "booking.table_required": {
    en: "Choose a table to seat this booking",
    es: "Elige una mesa para sentar esta reserva",
  },
  "booking.fields_required": {
    en: "Fill in the date, time, party size and name",
    es: "Rellena la fecha, la hora, los comensales y el nombre",
  },
  "booking.party_invalid": {
    en: "Party size must be a whole number of 1 or more",
    es: "Los comensales deben ser un número entero de 1 o más",
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
