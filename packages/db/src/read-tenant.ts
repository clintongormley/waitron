import { eq } from "drizzle-orm";
import { tenants } from "./schema/tenants.js";
import type { Transaction } from "./client.js";

/** The business half of the database's one taxpayer row — the three columns every caller reads.
 * `id` and `createdAt` are left out: `id` is always 1 (that is how the row is found) and nothing
 * outside provisioning reads the timestamp. */
export interface Tenant {
  country: string;
  taxId: string;
  legalName: string;
}

/**
 * Reads the database's one taxpayer row — the single place the `id = 1` convention is spelled out,
 * so a change to how the taxpayer is read has one home rather than one per caller.
 *
 * Returns `undefined` rather than throwing when the row is absent, because callers do genuinely
 * different things with that: the receipt and payment-slip printers degrade to printing nothing (a
 * throw inside the sale transaction would roll a filed sale back), the venue-locale reader falls
 * back to its default, and the report and dashboard routes treat it as a configuration fault and
 * throw. Deciding here would take that choice away from all of them.
 */
export async function readTenant(tx: Transaction): Promise<Tenant | undefined> {
  const [row] = await tx
    .select({
      country: tenants.country,
      taxId: tenants.taxId,
      legalName: tenants.legalName,
    })
    .from(tenants)
    .where(eq(tenants.id, 1));
  return row;
}
