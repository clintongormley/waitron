import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing, Purpose } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";

/**
 * Read the credential for this tenant on each pass. Provisioning and rotation
 * therefore take effect without a restart, and decrypted secrets are not cached
 * for the lifetime of the process.
 */
export function readCredential(
  db: Database,
  ring: KeyRing,
  tenantId: TenantId,
  purpose: Purpose,
): Promise<Record<string, string>> {
  return withTenant(db, tenantId, (tx) => getCredential(tx, ring, { tenantId, purpose }));
}
