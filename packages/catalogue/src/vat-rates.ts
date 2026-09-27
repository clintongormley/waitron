import { decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

export const VAT_CLASSES = ["general", "reduced", "super_reduced", "zero"] as const;
export type VatClass = (typeof VAT_CLASSES)[number];

/**
 * One rate of a class and the local calendar date (`YYYY-MM-DD`, inclusive) it takes effect. `from:
 * null` is the first entry only, and covers every date before the next entry's.
 */
export interface DatedRate {
  from: string | null;
  rate: string;
}

/** Each class's rates, oldest first. */
export type VatRateTable = Readonly<Record<VatClass, readonly DatedRate[]>>;

// The standing Spanish VAT set, checked 2026-08-05 against AEAT's page
// `/Sede/iva/calculo-iva-repercutido-clientes/tipos-impositivos-iva.html`
// on sede.agenciatributaria.gob.es. A legal change ships as a new dated entry, never an edit.
export const VAT_RATE_TABLE: VatRateTable = {
  general: [{ from: null, rate: "21.00" }],
  reduced: [{ from: null, rate: "10.00" }],
  super_reduced: [{ from: null, rate: "4.00" }],
  zero: [{ from: null, rate: "0.00" }],
};

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertCalendarDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !CALENDAR_DATE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`VAT rates: "${value}" is not a calendar date (YYYY-MM-DD)`);
  }
}

// Only a table that passed is remembered, so a malformed one is refused on every lookup.
const wellFormed = new WeakSet<VatRateTable>();

function assertWellFormed(table: VatRateTable): void {
  if (wellFormed.has(table)) return;
  for (const vatClass of VAT_CLASSES) {
    const entries = table[vatClass];
    if (entries[0]?.from !== null) {
      throw new Error(`VAT rates: the first entry for ${vatClass} must have from: null`);
    }
    for (let i = 1; i < entries.length; i += 1) {
      const from = entries[i]!.from;
      const previous = entries[i - 1]!.from;
      if (from === null || (previous !== null && from <= previous)) {
        throw new Error(`VAT rates: the entries for ${vatClass} must be dated oldest first`);
      }
      assertCalendarDate(from);
    }
  }
  wellFormed.add(table);
}

function rateIn(entries: readonly DatedRate[], date: string): Decimal {
  let rate = entries[0]!.rate;
  for (const entry of entries.slice(1)) {
    if (entry.from! <= date) rate = entry.rate;
  }
  return decimal(rate);
}

/** The rate `vatClass` carries on the local calendar date `date` (`YYYY-MM-DD`). */
export function vatRateOn(
  vatClass: VatClass,
  date: string,
  table: VatRateTable = VAT_RATE_TABLE,
): Decimal {
  assertCalendarDate(date);
  assertWellFormed(table);
  return rateIn(table[vatClass], date);
}

/** Every class's rate on the local calendar date `date` (`YYYY-MM-DD`). */
export function vatRatesOn(
  date: string,
  table: VatRateTable = VAT_RATE_TABLE,
): Readonly<Record<VatClass, Decimal>> {
  assertCalendarDate(date);
  assertWellFormed(table);
  return {
    general: rateIn(table.general, date),
    reduced: rateIn(table.reduced, date),
    super_reduced: rateIn(table.super_reduced, date),
    zero: rateIn(table.zero, date),
  };
}

/** The calendar date of `instant` at `offsetMinutes` east of UTC, as `YYYY-MM-DD`. */
export function localCalendarDate(instant: Date, offsetMinutes: number): string {
  return new Date(instant.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** This process's local calendar date today, for pricing that files no rate. */
export function localToday(): string {
  const now = new Date();
  return localCalendarDate(now, -now.getTimezoneOffset());
}
