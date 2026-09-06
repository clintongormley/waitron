import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** The `(country, tax_id)` fiscal identity of one obligado — the taxpayer a database serves.
 * Canonicalized by `planVenue` on write, so the stored row and a fresh plan's `ensure-tenant` action
 * compare byte-for-byte. */
export interface ObligadoIdentity {
  country: string;
  taxId: string;
}

/** The `(country, tax_id)` of every obligado in the target database. Every tenant-creation path reads
 * this before applying and hands it to `assertNoForeignObligado`. Runs over the owner-admin
 * connection, which owns `tenants` and so may read it. */
export async function readObligadoIdentities(target: Database): Promise<ObligadoIdentity[]> {
  const rows = await target.execute<{ country: string; tax_id: string }>(
    sql`select country, tax_id from tenants`,
  );
  return rows.rows.map((row) => ({ country: row.country, taxId: row.tax_id }));
}

/**
 * The one-obligado-per-database fiscal-safety DECISION, in ONE place. Every tenant-creation entry
 * point — the setup-api provision handler (`provisionVenue`), the `venue` CLI, and the mirror adopt
 * orchestrator (`adoptFromPrimary`) — calls this before stamping or applying: with row-level security
 * dropped on the premise of one obligado per database, `withTenant` no longer filters rows by tenant
 * (`packages/db/src/tenancy.ts`), so a second `(country, tax_id)` in the same database would expose
 * one business's rows to the other — a cross-tenant leak a hash-chained fiscal record (§5) cannot take
 * back. Refuses if any EXISTING identity differs from the one being applied; the SAME identity and an
 * empty database both pass (the caller decides what a same-identity match means). `applied` is the
 * plan's canonicalized `ensure-tenant` identity, so it compares like-for-like against the stored rows
 * `present` carries.
 */
export function assertNoForeignObligado(
  present: readonly ObligadoIdentity[],
  applied: ObligadoIdentity,
  database: string,
): void {
  if (present.some((t) => t.country !== applied.country || t.taxId !== applied.taxId)) {
    throw new AppError("provisioning.foreign_obligado", { database });
  }
}
