import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** Canonicalized by `planVenue` on write, so the stored row and a fresh plan's `ensure-taxpayer`
 * action compare byte-for-byte. */
export interface TaxpayerIdentity {
  country: string;
  taxId: string;
}

export async function readTaxpayerIdentities(
  target: Pick<Database, "execute">,
): Promise<TaxpayerIdentity[]> {
  const rows = await target.execute<{ country: string; tax_id: string }>(
    sql`select country, tax_id from taxpayer`,
  );
  return rows.rows.map((row) => ({ country: row.country, taxId: row.tax_id }));
}

export async function hasOperationalVenue(target: Pick<Database, "execute">): Promise<boolean> {
  const rows = await target.execute(sql`select 1 from settings where module = 'venue' limit 1`);
  return rows.rows.length > 0;
}

export function assertOperationalVenue(present: boolean): void {
  if (!present) throw new AppError("provisioning.second_venue", {});
}

export function assertNoOperationalVenue(present: boolean): void {
  if (present) throw new AppError("provisioning.second_venue", {});
}

/**
 * The one-taxpayer-per-database decision, in ONE place: `provisionVenue`, the `venue` CLI and
 * `adoptFromPrimary` all call this before stamping or applying. The SAME identity and an empty
 * database both pass; the caller decides what a same-identity match means.
 */
export function assertNoForeignTaxpayer(
  present: readonly TaxpayerIdentity[],
  applied: TaxpayerIdentity,
  database: string,
): void {
  if (present.some((t) => t.country !== applied.country || t.taxId !== applied.taxId)) {
    throw new AppError("provisioning.foreign_taxpayer", { database });
  }
}
