import { currentLocale, resolveNameTable, type NameTable } from "@waitron/dashboard-kit";
import type { AllergenDeclaration } from "../api/client.js";

// Each table is a local, `string`-keyed copy of a server token set; api/client.ts says why the
// dashboard does not import `@waitron/catalogue`'s main entry.

const ROLE_NAMES: NameTable = {
  staff: { en: "Staff", es: "Empleado" },
  supervisor: { en: "Supervisor", es: "Supervisor" },
  manager: { en: "Manager", es: "Encargado" },
  admin: { en: "Admin", es: "Administrador" },
};

const STATUS_NAMES: NameTable = {
  pending: { en: "Pending", es: "Pendiente" },
  active: { en: "Active", es: "Activo" },
  suspended: { en: "Disabled", es: "Desactivado" },
};

const VAT_CLASS_NAMES: NameTable = {
  general: { en: "General", es: "General" },
  reduced: { en: "Reduced", es: "Reducido" },
  super_reduced: { en: "Super-reduced", es: "Superreducido" },
  zero: { en: "No tax", es: "Sin impuestos" },
};

const UNIT_NAMES: NameTable = {
  each: { en: "Per unit", es: "Por unidad" },
  weight: { en: "By weight", es: "Por peso" },
};

// These must read as three distinct strings: a screen reader and a colour-blind operator have to
// tell them apart without relying on colour.
const ALLERGEN_STATE_NAMES: NameTable = {
  pending: { en: "Pending", es: "Pendiente" },
  none: { en: "None", es: "Ninguno" },
  declared: { en: "Declared", es: "Declarado" },
};

// Regulated text (Regulation (EU) No 1169/2011, Annex II), copied from
// `apps/till/src/i18n/allergen-names.ts`; `scripts/allergen-names-drift.test.ts` pins the two equal.
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

const ABSENCE_KIND_NAMES: NameTable = {
  holiday: { en: "Holiday", es: "Vacaciones" },
  sick_leave: { en: "Sick leave", es: "Baja" },
  leave: { en: "Leave", es: "Permiso" },
  unpaid: { en: "Unpaid leave", es: "Permiso sin sueldo" },
};

// Feminine agreement: "ausencia" is feminine.
const ABSENCE_STATUS_NAMES: NameTable = {
  requested: { en: "Requested", es: "Solicitada" },
  approved: { en: "Approved", es: "Aprobada" },
  rejected: { en: "Rejected", es: "Rechazada" },
};

// Masculine agreement: "cambio" is masculine.
const SWAP_STATUS_NAMES: NameTable = {
  requested: { en: "Requested", es: "Solicitado" },
  accepted: { en: "Accepted", es: "Aceptado" },
  approved: { en: "Approved", es: "Aprobado" },
  rejected: { en: "Rejected", es: "Rechazado" },
};

const SWAP_DIRECTION_NAMES: NameTable = {
  offered_to_me: { en: "Offered to me", es: "Me lo ofrecen" },
  requested_by_me: { en: "Requested by me", es: "Lo pido yo" },
};

const PURCHASE_REGIME_NAMES: NameTable = {
  general: { en: "General regime", es: "Régimen general" },
  equivalence_surcharge: { en: "Equivalence surcharge", es: "Recargo de equivalencia" },
};

const PURCHASE_VAT_KIND_NAMES: NameTable = {
  ordinary: { en: "Ordinary", es: "Corriente" },
  capital: { en: "Capital goods", es: "Bien de inversión" },
};

// "USB" and "TCP" stay as-is in both columns: they are protocol names.
const PRINT_TRANSPORT_NAMES: NameTable = {
  usb: { en: "USB", es: "USB" },
  network_tcp: { en: "Network (TCP)", es: "Red (TCP)" },
  bluetooth: { en: "Bluetooth", es: "Bluetooth" },
  cloud_poll: { en: "Cloud poll", es: "Sondeo en la nube" },
};

const PRINT_JOB_STATUS_NAMES: NameTable = {
  queued: { en: "Queued", es: "En cola" },
  printing: { en: "Printing", es: "Imprimiendo" },
  done: { en: "Done", es: "Hecho" },
  failed: { en: "Failed", es: "Fallido" },
};

const PRINT_MODE_NAMES: NameTable = {
  auto: { en: "Automatic", es: "Automático" },
  on_request: { en: "On request", es: "Bajo petición" },
  never: { en: "Never", es: "Nunca" },
};

const DRAWER_OPEN_POLICY_NAMES: NameTable = {
  gated: { en: "Supervisor approval required", es: "Requiere autorización de un responsable" },
  open: { en: "Any operator", es: "Cualquier operario" },
};

export function roleName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(ROLE_NAMES, value, locale);
}

export function transportName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(PRINT_TRANSPORT_NAMES, value, locale);
}

export function jobStatusName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(PRINT_JOB_STATUS_NAMES, value, locale);
}

export function printModeName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(PRINT_MODE_NAMES, value, locale);
}

export function drawerPolicyName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(DRAWER_OPEN_POLICY_NAMES, value, locale);
}

export function breachKindName(kind: string, locale: string = currentLocale()): string {
  return resolveNameTable(BREACH_KIND_NAMES, kind, locale);
}

export function absenceKindName(kind: string, locale: string = currentLocale()): string {
  return resolveNameTable(ABSENCE_KIND_NAMES, kind, locale);
}

export function absenceStatusName(status: string, locale: string = currentLocale()): string {
  return resolveNameTable(ABSENCE_STATUS_NAMES, status, locale);
}

export function swapStatusName(status: string, locale: string = currentLocale()): string {
  return resolveNameTable(SWAP_STATUS_NAMES, status, locale);
}

export function swapDirectionName(direction: string, locale: string = currentLocale()): string {
  return resolveNameTable(SWAP_DIRECTION_NAMES, direction, locale);
}

export function statusName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(STATUS_NAMES, value, locale);
}

export function vatClassName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(VAT_CLASS_NAMES, value, locale);
}

export function unitName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(UNIT_NAMES, value, locale);
}

export type AllergenState = "pending" | "none" | "declared";

/**
 * `null` is PENDING (not yet reviewed, never "allergen-free"); `{}` is reviewed with none. The two
 * must stay distinct, so this is a `=== null` test, not a falsy or length one.
 */
export function allergenState(allergens: AllergenDeclaration): AllergenState {
  if (allergens === null) return "pending";
  return Object.keys(allergens).length === 0 ? "none" : "declared";
}

export function allergenStateName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(ALLERGEN_STATE_NAMES, value, locale);
}

export function allergenName(code: string, locale: string = currentLocale()): string {
  return resolveNameTable(ALLERGEN_NAMES, code, locale);
}

// Key order in ALLERGEN_NAMES is the option order in allergen-dietary-picker.ts.
export const ALLERGEN_CODES: readonly string[] = Object.keys(ALLERGEN_NAMES);

export function regimeName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(PURCHASE_REGIME_NAMES, value, locale);
}

export function vatKindName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(PURCHASE_VAT_KIND_NAMES, value, locale);
}
