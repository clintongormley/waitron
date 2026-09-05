import { randomUUID } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import { putCredential, tryGetCredential, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  withTenant,
  type Database,
} from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
} from "@waitron/shared";
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
 * without minting a fresh keypair or re-establishing anything (a re-fetch may have burned one cheap
 * primary allocation, which is acceptable; §7). Otherwise ONE owner tenant transaction seals the
 * private key, inserts the standby's own node (public_key + endorsement), hands each module its own
 * reservation to establish, and inserts the reserved series.
 *
 * `args.reserved` is WIRE input from the primary. The carrier never inspects `reserved.modules`: each
 * module validates its own state inside `establish` and throws there, which rolls this transaction back
 * — so a malformed reservation leaves no node row behind.
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
    /** The enabled set, in composition order — those declaring `provisioning.standby` establish. */
    modules: readonly WaitronModule[];
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
    const standbyNode = {
      tenantId: tenant,
      locationId: brandLocationId(args.locationId),
      nodeId: brandNodeId(args.standby.nodeId),
    };
    for (const m of args.modules) {
      if (m.provisioning?.standby === undefined) continue;
      await m.provisioning.standby.establish(tx, standbyNode, args.reserved.modules[m.name]);
    }
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
