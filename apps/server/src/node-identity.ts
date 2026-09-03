import { generateNodeKeyPair } from "@waitron/membership";
import { getCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { setNodePublicKey, withTenant, type Database } from "@waitron/db";
import { tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";

/**
 * Establish this node's membership identity (design §4) at setup: generate an Ed25519 keypair, seal
 * the PRIVATE half in the box vault under `membership.node_key`, and stamp the PUBLIC half on
 * `nodes.public_key` — the trust anchor boot reads (readMembershipTrustSet). Called ONLY on the
 * fresh-primary provision path (setup-api provision handler, beside sealAeat): a cloud mirror runs as
 * the primary's nodeId and never signs, so it seals no key and inherits the primary's anchor through
 * the node row adoptVenue replicates.
 *
 * The order mirrors sealMirrorToken: the vault row is FK-restricted to the tenant, so this runs AFTER
 * provisionVenue mints it. `nodes` is FORCE-RLS, so both the seal (tenant_credentials WITH CHECK) and
 * the stamp (nodes policy) run under `withTenant` on the owner connection.
 *
 * Two transactions (the seal, then the stamp via setNodePublicKey's own `withTenant`), non-atomic —
 * safe by idempotent re-run on the already-non-atomic provision path (provision.ts): a retry
 * regenerates the keypair, upserts the sealed private key (putCredential onConflictDoUpdate), and
 * overwrites `nodes.public_key`, and nothing has signed yet (the private key is the Slice-5 signer's,
 * unused at setup), so no chain depends on the half-written state a mid-run failure leaves.
 */
export interface EstablishIdentityDeps {
  ownerDb: Database;
  ring: KeyRing;
}

export async function establishNodeIdentity(
  deps: EstablishIdentityDeps,
  tenantId: string,
  nodeId: string,
): Promise<void> {
  const tenant = brandTenantId(tenantId);
  const { publicKey, privateKey } = generateNodeKeyPair();
  await withTenant(deps.ownerDb, tenant, (tx) =>
    putCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: "membership.node_key",
      value: { privateKey },
    }),
  );
  await setNodePublicKey(deps.ownerDb, tenantId, nodeId, publicKey);
}

/**
 * Unseal the node's identity PRIVATE key (base64 PKCS8) as `app_user` under `withTenant` — the same
 * role/path readMirrorToken uses. The Slice-5 signer's entry point (mint + sign a membership
 * document); exercised now by the establish round-trip. Throws `credentials.decrypt_failed` (a key
 * sealed under a different box key) or `credentials.missing` (never established).
 */
export function readNodeIdentityKey(
  appDb: Database,
  ring: KeyRing,
  tenantId: string,
): Promise<string> {
  const tenant = brandTenantId(tenantId);
  return withTenant(appDb, tenant, async (tx) => {
    const c = await getCredential(tx, ring, { tenantId: tenant, purpose: "membership.node_key" });
    return c.privateKey as string;
  });
}
