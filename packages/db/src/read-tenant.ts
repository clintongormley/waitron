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
 * Reads the database's one taxpayer row by `where id = 1`, so its readers share one query instead of
 * a copy each. It is NOT the only way the row is reached, so a change made here does not reach every
 * reader: provisioning, module seeds and the configuration export each query `tenants` directly —
 * one of them for `for update`, some with no `id` predicate at all, and at least one through a
 * `cross join` rather than a `from`. That last spelling is why no single grep finds them all, and
 * why this comment names no sites — search for the ones you need rather than trusting a list here.
 *
 * Returns `null` rather than throwing when the row is absent, because callers do genuinely
 * different things with that: the receipt and payment-slip printers degrade to printing nothing (a
 * throw inside the sale transaction would roll a filed sale back), the venue-locale reader falls
 * back to its default, and the report and dashboard routes treat it as a configuration fault and
 * throw. Deciding here would take that choice away from all of them. `null` rather than
 * `undefined` because that is what every other exported reader in this package signals absence with
 * (`readDeploymentEnvironment`, `readFenceLsn`, `readBreakGlassVerifier`, `readMirrorConfig`,
 * `readNodeMembership`, `readNodeEndorsement`).
 */
export async function readTenant(tx: Transaction): Promise<Tenant | null> {
  const [row] = await tx
    .select({
      country: tenants.country,
      taxId: tenants.taxId,
      legalName: tenants.legalName,
    })
    .from(tenants)
    .where(eq(tenants.id, 1));
  return row ?? null;
}
