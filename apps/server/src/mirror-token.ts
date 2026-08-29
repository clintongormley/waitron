import { getCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { withTenant, type Database } from "@waitron/db";
import { tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";

// The mirror's per-peer sync bearer token, sealed into the credentials vault under the new purpose
// `sync.mirror_token` (design §6). It is the EXACT `sealAeatCredential`/`readCredential` shape
// (aeat-credential.ts:81-101, credentials.ts:16-23), specialised to this purpose's single `token`
// field. The token crosses from the primary in plaintext, once (design §3), and is re-sealed here
// under the mirror's OWN box key: a value sealed with the primary's key cannot be opened with the
// mirror's (AES-256-GCM authentication fails → `credentials.decrypt_failed`), which is the design's
// load-bearing cross-box fact. The token is never logged.

/**
 * Seal the sync token into the `sync.mirror_token` vault purpose for `tenantId`, on the OWNER
 * connection. `tenant_credentials` is FORCE-RLS, so `putCredential` runs under `withTenant` with
 * `app.tenant_id` set (the row's WITH CHECK is `tenant_id = current_tenant_id()`), and the tenant must
 * already exist — the seal runs AFTER `adoptVenue` inserts it (the FK is `restrict`).
 */
export function sealMirrorToken(
  ownerDb: Database,
  ring: KeyRing,
  tenantId: string,
  token: string,
): Promise<void> {
  const tenant = brandTenantId(tenantId);
  return withTenant(ownerDb, tenant, (tx) =>
    putCredential(tx, ring, { tenantId: tenant, purpose: "sync.mirror_token", value: { token } }),
  );
}

/**
 * Read the sync token back at mirror boot, as `app_user` via `withTenant` — the same role and path
 * the AEAT cert read uses (`readCredential`). Throws `credentials.decrypt_failed` if the ring cannot
 * open the sealed value (a token sealed under a different box key), or `credentials.missing` if no
 * row exists for the purpose.
 */
export function readMirrorToken(appDb: Database, ring: KeyRing, tenantId: string): Promise<string> {
  const tenant = brandTenantId(tenantId);
  return withTenant(appDb, tenant, async (tx) => {
    const c = await getCredential(tx, ring, { tenantId: tenant, purpose: "sync.mirror_token" });
    return c.token as string;
  });
}
