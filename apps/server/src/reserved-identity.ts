import { randomUUID } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import { putCredential, tryGetCredential, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  withTenant,
  type Database,
} from "@waitron/db";
import { writeReservedSif } from "@waitron/fiscal-verifactu";
import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
import { NODE_KEY_PURPOSE } from "./node-identity.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import "./errors.js";

export interface StandbyIdentity {
  nodeId: string;
  publicKey: string;
  privateKey: string;
}

/** Mint a standby's own identity in memory (design §6 R2): a fresh nodeId + Ed25519 keypair. Generated
 * BEFORE the adopt fetch so the public half + nodeId can be sent to the primary for endorsement +
 * number allocation; the private half is sealed by `establishReservedStandbyIdentity` after the tenant
 * exists (the vault FK is restrict). */
export function generateStandbyIdentity(): StandbyIdentity {
  const { publicKey, privateKey } = generateNodeKeyPair();
  return { nodeId: randomUUID(), publicKey, privateKey };
}

/**
 * Persist the standby's complete dormant identity on the cloud's own database (design §6 R2), all
 * inert until an R3 promotion activates it. IDEMPOTENT (design §8 / Slice-4 follow-up b): if the
 * membership key is already sealed, an earlier adopt attempt already established the identity — return
 * without minting a fresh keypair or a second reserved SIF (a re-fetch may have burned one cheap
 * primary number, which is acceptable; §7). Otherwise ONE owner tenant transaction seals the private
 * key, inserts the standby's own node (public_key + endorsement), persists the reserved SIF with the
 * PRIMARY-supplied number, and inserts the reserved series.
 */
export async function establishReservedStandbyIdentity(
  deps: { ownerDb: Database; ring: KeyRing },
  args: {
    tenantId: string;
    locationId: string;
    standby: StandbyIdentity;
    nodeName: string;
    filingModule: string | null;
    taxModule: string | null;
    reserved: ReservedIdentity;
  },
): Promise<void> {
  const tenant = brandTenantId(args.tenantId);
  await withTenant(deps.ownerDb, tenant, async (tx) => {
    const existing = await tryGetCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: NODE_KEY_PURPOSE,
    });
    if (existing !== null) return; // already established — idempotent no-op

    await putCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: NODE_KEY_PURPOSE,
      value: { privateKey: args.standby.privateKey },
    });
    await insertReservedNodeTx(tx, {
      id: args.standby.nodeId,
      tenantId: args.tenantId,
      locationId: args.locationId,
      name: args.nodeName,
      filingModule: args.filingModule,
      taxModule: args.taxModule,
      publicKey: args.standby.publicKey,
      endorsement: args.reserved.endorsement,
    });
    await writeReservedSif(tx, {
      tenantId: tenant,
      nodeId: brandNodeId(args.standby.nodeId),
      nif: args.reserved.nif,
      idSistemaInformatico: args.reserved.idSistemaInformatico,
      numeroInstalacion: args.reserved.numeroInstalacion,
    });
    await insertReservedSeriesTx(
      tx,
      args.reserved.series.map((s) => ({
        tenantId: args.tenantId,
        nodeId: args.standby.nodeId,
        code: s.code,
        purpose: s.purpose,
      })),
    );
  });
}
