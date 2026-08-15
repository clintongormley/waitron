import { currentLocale, pickLocale } from "./t.js";

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

/** A person's management role (staff / supervisor / manager / admin) → its display name. */
export function roleName(value: string, locale: string = currentLocale()): string {
  return resolve(ROLE_NAMES, value, locale);
}

/** An advisory roster-breach kind → its display name (raw-value fallback for an unmapped kind). */
export function breachKindName(kind: string, locale: string = currentLocale()): string {
  return resolve(BREACH_KIND_NAMES, kind, locale);
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

/** An allergen-declaration state (pending / none / declared) → its display name. */
export function allergenStateName(value: string, locale: string = currentLocale()): string {
  return resolve(ALLERGEN_STATE_NAMES, value, locale);
}

/** An EU allergen code → its display name. */
export function allergenName(code: string, locale: string = currentLocale()): string {
  return resolve(ALLERGEN_NAMES, code, locale);
}
