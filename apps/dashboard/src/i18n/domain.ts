import { currentLocale, pickLocale } from "./t.js";
import type { AllergenDeclaration } from "../api/client.js";

// Localised DISPLAY NAMES for the enum tokens the server hands the dashboard — roles, statuses,
// VAT classes, sale units, allergen-declaration states, and the 14 EU allergen codes. The dashboard
// receives these as raw string tokens (see api/client.ts's local type copies) and must render human
// copy for them, so this module owns the token → name tables.
//
// Each table is `string`-keyed on purpose: the dashboard is deliberately DECOUPLED from
// `@waitron/catalogue` (a runtime import would drag its barrel — and through it `@waitron/db` and Node
// builtins — into the browser bundle; see api/client.ts and widgets/allergen-picker.ts). So these are
// LOCAL copies of the token sets, exactly as the client's payload types are local copies, not imports.
//
// English is the source of truth and `apps/*` is exempt from the english-only guard, so the Spanish
// below is user-facing translation, not schema vocabulary.

type NameTable = Record<string, { en: string; es: string }>;

/**
 * Shared resolver for every table below. Resolution mirrors `apps/till/src/i18n/allergen-names.ts`:
 * the region subtag is stripped ("es-ES" → "es"), then the language's name if present, else the
 * English name, else — for a token that isn't in the table at all — the raw value, so an unknown
 * token renders as itself rather than as an empty string or a throw.
 */
function resolve(table: NameTable, value: string, locale: string): string {
  // Own-key check, not truthiness: a token colliding with an Object.prototype member (`toString`,
  // `constructor`, …) would resolve the inherited method and return undefined instead of the raw
  // token, so an unknown token must be gated on Object.hasOwn before the pickLocale lookup.
  return Object.hasOwn(table, value) ? pickLocale(table[value], locale) : value;
}

const ROLE_NAMES: NameTable = {
  staff: { en: "Staff", es: "Empleado" },
  supervisor: { en: "Supervisor", es: "Supervisor" },
  manager: { en: "Manager", es: "Encargado" },
  admin: { en: "Admin", es: "Administrador" },
};

const STATUS_NAMES: NameTable = {
  active: { en: "Active", es: "Activo" },
  suspended: { en: "Suspended", es: "Suspendido" },
};

const VAT_CLASS_NAMES: NameTable = {
  general: { en: "General", es: "General" },
  reduced: { en: "Reduced", es: "Reducido" },
  super_reduced: { en: "Super-reduced", es: "Superreducido" },
  zero: { en: "Zero", es: "Cero" },
};

const UNIT_NAMES: NameTable = {
  each: { en: "Per unit", es: "Por unidad" },
  weight: { en: "By weight", es: "Por peso" },
};

// The three allergen-declaration states the till renders. These MUST read as three distinct strings:
// a screen reader and a colour-blind operator have to tell them apart without relying on colour.
const ALLERGEN_STATE_NAMES: NameTable = {
  pending: { en: "Pending", es: "Pendiente" },
  none: { en: "None", es: "Ninguno" },
  declared: { en: "Declared", es: "Declarado" },
};

// Display names for the 14 EU allergens (Regulation (EU) No 1169/2011, Annex II). The Spanish column
// is copied VERBATIM from `apps/till/src/i18n/allergen-names.ts`, whose `es` text was checked against
// the official Spanish text of Annex II (Diario Oficial de la Unión Europea, L 304/43-44, 22.11.2011).
// Kept as a plain `string`-keyed table, NOT `AllergenCode` from `@waitron/catalogue`, for the same
// bundle-decoupling reason as the tables above.
const ALLERGEN_NAMES: NameTable = {
  gluten: { en: "Cereals containing gluten", es: "Cereales con gluten" },
  crustaceans: { en: "Crustaceans", es: "Crustáceos" },
  eggs: { en: "Eggs", es: "Huevos" },
  fish: { en: "Fish", es: "Pescado" },
  peanuts: { en: "Peanuts", es: "Cacahuetes" },
  soybeans: { en: "Soybeans", es: "Soja" },
  milk: { en: "Milk", es: "Leche" },
  nuts: { en: "Nuts", es: "Frutos de cáscara" },
  celery: { en: "Celery", es: "Apio" },
  mustard: { en: "Mustard", es: "Mostaza" },
  sesame: { en: "Sesame seeds", es: "Granos de sésamo" },
  sulphites: { en: "Sulphur dioxide and sulphites", es: "Dióxido de azufre y sulfitos" },
  lupin: { en: "Lupin", es: "Altramuces" },
  molluscs: { en: "Molluscs", es: "Moluscos" },
};

// The 7 advisory roster-breach kinds `validateRoster` reports (`@waitron/workforce`'s
// RosterBreachKind), shown in the publish banner. A raw string-keyed LOCAL copy of the token set, same
// bundle-decoupling reason as the tables above.
const BREACH_KIND_NAMES: NameTable = {
  rest_too_short: {
    en: "Too little rest between shifts",
    es: "Descanso insuficiente entre turnos",
  },
  exceeds_daily_max: { en: "Over the daily maximum", es: "Supera el máximo diario" },
  exceeds_weekly_max: { en: "Over the weekly maximum", es: "Supera el máximo semanal" },
  overtime_cap_exceeded: { en: "Over the overtime cap", es: "Supera el límite de horas extra" },
  weekly_rest_insufficient: { en: "Insufficient weekly rest", es: "Descanso semanal insuficiente" },
  break_owed: { en: "A break is owed", es: "Se debe un descanso" },
  night_work: { en: "Night work", es: "Trabajo nocturno" },
};

// The four absence kinds (@waitron/workforce absence_kind), shown on the approvals screen. Raw
// string-keyed LOCAL copy, same bundle-decoupling reason as the tables above.
const ABSENCE_KIND_NAMES: NameTable = {
  holiday: { en: "Holiday", es: "Vacaciones" },
  sick_leave: { en: "Sick leave", es: "Baja" },
  leave: { en: "Leave", es: "Permiso" },
  unpaid: { en: "Unpaid leave", es: "Permiso sin sueldo" },
};

// The three absence statuses (@waitron/workforce absence_status), shown on the staff self-service
// portal so a staff member sees where each of their own requests stands. Raw string-keyed LOCAL copy,
// same bundle-decoupling reason as the tables above. (Feminine agreement — "ausencia" is feminine.)
const ABSENCE_STATUS_NAMES: NameTable = {
  requested: { en: "Requested", es: "Solicitada" },
  approved: { en: "Approved", es: "Aprobada" },
  rejected: { en: "Rejected", es: "Rechazada" },
};

// The four shift-swap statuses (@waitron/workforce shift_swap_status), shown on the staff self-service
// portal. Raw string-keyed LOCAL copy, same bundle-decoupling reason as the tables above. (Masculine
// agreement — "cambio" is masculine.)
const SWAP_STATUS_NAMES: NameTable = {
  requested: { en: "Requested", es: "Solicitado" },
  accepted: { en: "Accepted", es: "Aceptado" },
  approved: { en: "Approved", es: "Aprobado" },
  rejected: { en: "Rejected", es: "Rechazado" },
};

// Which side of a swap the staff member is on (@waitron/workforce SwapDirection), shown on the staff
// self-service portal so the two directions read distinctly. Raw string-keyed LOCAL copy, same
// bundle-decoupling reason as the tables above.
const SWAP_DIRECTION_NAMES: NameTable = {
  offered_to_me: { en: "Offered to me", es: "Me lo ofrecen" },
  requested_by_me: { en: "Requested by me", es: "Lo pido yo" },
};

// The two purchase-invoice VAT regimes (@waitron/purchasing PurchaseRegime), shown on the purchases
// screen/form. Raw string-keyed LOCAL copy, same bundle-decoupling reason as the tables above.
const PURCHASE_REGIME_NAMES: NameTable = {
  general: { en: "General regime", es: "Régimen general" },
  equivalence_surcharge: { en: "Equivalence surcharge", es: "Recargo de equivalencia" },
};

// The two purchase-invoice VAT kinds (@waitron/purchasing PurchaseVatKind), the desglose line's
// box-split marker. Raw string-keyed LOCAL copy, same bundle-decoupling reason as the tables above.
const PURCHASE_VAT_KIND_NAMES: NameTable = {
  ordinary: { en: "Ordinary", es: "Corriente" },
  capital: { en: "Capital goods", es: "Bien de inversión" },
};

// The three printer transports (@waitron/printing PrintTransport / the `print_transport` pgEnum), shown
// on the Impresoras screen. Raw string-keyed LOCAL copy, same bundle-decoupling reason as the tables
// above. "USB" / "TCP" stay as-is in both columns (they are the wire/protocol names).
const PRINT_TRANSPORT_NAMES: NameTable = {
  usb: { en: "USB", es: "USB" },
  network_tcp: { en: "Network (TCP)", es: "Red (TCP)" },
  cloud_poll: { en: "Cloud poll", es: "Sondeo en la nube" },
};

// The four print-job statuses (@waitron/printing PrintJobStatus / the `print_job_status` pgEnum), shown
// on the Impresoras screen's recent-jobs list. Raw string-keyed LOCAL copy, same bundle-decoupling
// reason as the tables above.
const PRINT_JOB_STATUS_NAMES: NameTable = {
  queued: { en: "Queued", es: "En cola" },
  printing: { en: "Printing", es: "Imprimiendo" },
  done: { en: "Done", es: "Hecho" },
  failed: { en: "Failed", es: "Fallido" },
};

// The three receipt print modes (the `receipt_print_mode` pgEnum), the per-location toggle on the
// Impresoras screen. Raw string-keyed LOCAL copy, same bundle-decoupling reason as the tables above.
const PRINT_MODE_NAMES: NameTable = {
  auto: { en: "Automatic", es: "Automático" },
  on_request: { en: "On request", es: "Bajo petición" },
  never: { en: "Never", es: "Nunca" },
};

// The two cash-drawer-open policies (the `drawer_open_policy` pgEnum), the per-location toggle on the
// Impresoras screen. `gated` = a manager must authorize an out-of-sale drawer open (the SECURE default);
// `open` = any operator may. Raw string-keyed LOCAL copy, same bundle-decoupling reason as above.
const DRAWER_OPEN_POLICY_NAMES: NameTable = {
  gated: { en: "Manager approval required", es: "Requiere autorización de un responsable" },
  open: { en: "Any operator", es: "Cualquier operario" },
};

/** A person's management role (staff / supervisor / manager / admin) → its display name. */
export function roleName(value: string, locale: string = currentLocale()): string {
  return resolve(ROLE_NAMES, value, locale);
}

/** A printer transport (usb / network_tcp / cloud_poll) → its display name (raw-value fallback). */
export function transportName(value: string, locale: string = currentLocale()): string {
  return resolve(PRINT_TRANSPORT_NAMES, value, locale);
}

/** A print-job status (queued / printing / done / failed) → its display name (raw-value fallback). */
export function jobStatusName(value: string, locale: string = currentLocale()): string {
  return resolve(PRINT_JOB_STATUS_NAMES, value, locale);
}

/** A receipt print mode (auto / on_request / never) → its display name (raw-value fallback). */
export function printModeName(value: string, locale: string = currentLocale()): string {
  return resolve(PRINT_MODE_NAMES, value, locale);
}

/** A cash-drawer-open policy (gated / open) → its display name (raw-value fallback). */
export function drawerPolicyName(value: string, locale: string = currentLocale()): string {
  return resolve(DRAWER_OPEN_POLICY_NAMES, value, locale);
}

/** An advisory roster-breach kind → its display name (raw-value fallback for an unmapped kind). */
export function breachKindName(kind: string, locale: string = currentLocale()): string {
  return resolve(BREACH_KIND_NAMES, kind, locale);
}

/** An absence kind (holiday / sick_leave / leave / unpaid) → its display name (raw-value fallback). */
export function absenceKindName(kind: string, locale: string = currentLocale()): string {
  return resolve(ABSENCE_KIND_NAMES, kind, locale);
}

/** An absence status (requested / approved / rejected) → its display name (raw-value fallback). */
export function absenceStatusName(status: string, locale: string = currentLocale()): string {
  return resolve(ABSENCE_STATUS_NAMES, status, locale);
}

/** A shift-swap status (requested / accepted / approved / rejected) → its display name (raw fallback). */
export function swapStatusName(status: string, locale: string = currentLocale()): string {
  return resolve(SWAP_STATUS_NAMES, status, locale);
}

/** A swap direction (offered_to_me / requested_by_me) → its display name (raw-value fallback). */
export function swapDirectionName(direction: string, locale: string = currentLocale()): string {
  return resolve(SWAP_DIRECTION_NAMES, direction, locale);
}

/** A person's account status (active / suspended) → its display name. */
export function statusName(value: string, locale: string = currentLocale()): string {
  return resolve(STATUS_NAMES, value, locale);
}

/** A product's VAT class (general / reduced / super_reduced / zero) → its display name. */
export function vatClassName(value: string, locale: string = currentLocale()): string {
  return resolve(VAT_CLASS_NAMES, value, locale);
}

/** A product's sale unit (each / weight) → its display name. */
export function unitName(value: string, locale: string = currentLocale()): string {
  return resolve(UNIT_NAMES, value, locale);
}

/** The three allergen-declaration states a pill renders, keyed off the §7 / §1 invariant. */
export type AllergenState = "pending" | "none" | "declared";

/**
 * The three-state read of an allergen declaration (design §7, the till's null/{}/{…} distinction —
 * `apps/till/src/screens/till-allergen-screen.ts`): `null` is PENDING (not yet reviewed — a compliance
 * gap, NEVER "allergen-free"), `{}` is reviewed-with-none, a non-empty map is declared. `null` and `{}`
 * MUST stay distinct — collapsing them is the exact defect the invariant exists to prevent, so it is a
 * `=== null` test, not a falsy/length-only one. Shared by every widget that renders an allergen pill
 * (`product-list`, `ingredient-list`) so the compliance invariant has ONE definition, beside the
 * `allergenStateName` that localises its output.
 */
export function allergenState(allergens: AllergenDeclaration): AllergenState {
  if (allergens === null) return "pending";
  return Object.keys(allergens).length === 0 ? "none" : "declared";
}

/** An allergen-declaration state (pending / none / declared) → its display name. */
export function allergenStateName(value: string, locale: string = currentLocale()): string {
  return resolve(ALLERGEN_STATE_NAMES, value, locale);
}

/** An EU allergen code → its display name. */
export function allergenName(code: string, locale: string = currentLocale()): string {
  return resolve(ALLERGEN_NAMES, code, locale);
}

/** A purchase-invoice VAT regime (general / equivalence_surcharge) → its display name (raw-value
 * fallback for an unmapped regime). */
export function regimeName(value: string, locale: string = currentLocale()): string {
  return resolve(PURCHASE_REGIME_NAMES, value, locale);
}

/** A purchase-invoice VAT kind (ordinary / capital) → its display name (raw-value fallback). */
export function vatKindName(value: string, locale: string = currentLocale()): string {
  return resolve(PURCHASE_VAT_KIND_NAMES, value, locale);
}
