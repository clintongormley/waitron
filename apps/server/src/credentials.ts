import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing, Purpose } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";

/**
 * One tenant-scoped vault read. `tenant_credentials` is under FORCE ROW LEVEL SECURITY and
 * `getCredential` takes a `Transaction`, so the scope has to be established here — a bare
 * `db.transaction` sets no `app.tenant_id` and, under the real deployment role, matches no rows.
 *
 * Read per pass rather than cached at boot (design §6): a newly provisioned tenant is served
 * without a restart, a rotation takes effect without one, and a decrypted secret lives for one pass
 * instead of for the process's lifetime.
 */
export function readCredential(
  db: Database,
  ring: KeyRing,
  tenantId: TenantId,
  purpose: Purpose,
): Promise<Record<string, string>> {
  return withTenant(db, tenantId, (tx) => getCredential(tx, ring, { tenantId, purpose }));
}
