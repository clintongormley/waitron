import { generateNodeKeyPair } from "@waitron/membership";
import { getCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { setNodePublicKeyTx, withTenant, type Database } from "@waitron/db";
import { tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";

/**
 * Establish this node's membership identity (design §4) at setup: generate an Ed25519 keypair, then in
 * ONE tenant transaction seal the PRIVATE half in the box vault under `membership.node_key` and stamp
 * the PUBLIC half on `nodes.public_key` — the trust anchor boot reads (readMembershipTrustSet). Called
 * ONLY on the fresh-primary provision path (setup-api provision handler, beside sealAeat): a cloud
 * mirror runs as the primary's nodeId and never signs, so it seals no key and inherits the primary's
 * anchor through the node row adoptVenue replicates.
 *
 * The seal and the stamp are ONE logical change — the private key and its matching public key must
 * land together or not at all — so they share a single `withTenant` (CLAUDE.md §3: `withTenant` IS
 * that transaction; nothing non-DB sits between them to force a split). Both are owner-role writes
 * (`tenant_credentials` and `nodes` are FORCE-RLS, and app_user holds neither), scoped by the one
 * tenant GUC. Runs AFTER provisionVenue mints the tenant — the vault row is FK-restricted to it.
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
  await withTenant(deps.ownerDb, tenant, async (tx) => {
    await putCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: "membership.node_key",
      value: { privateKey },
    });
    await setNodePublicKeyTx(tx, nodeId, publicKey);
  });
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
