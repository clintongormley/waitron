import { eq } from "drizzle-orm";
import { tenants } from "./schema/tenants.js";
import type { Transaction } from "./client.js";

/** The business half of the database's one taxpayer row. */
export interface Tenant {
  country: string;
  taxId: string;
  legalName: string;
}

/**
 * Reads the database's one taxpayer row. It is NOT the only way the row is reached, so a change
 * made here does not reach every reader: other code queries `tenants` directly, at least once
 * through a `cross join` rather than a `from`, so no single grep finds them all.
 *
 * Returns `null` rather than throwing when the row is absent, because callers do genuinely
 * different things with that: a throw inside the sale transaction would roll a filed sale back.
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
