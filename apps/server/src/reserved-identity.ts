import { randomUUID } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import { putCredential, tryGetCredential, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  withTransaction,
  type Database,
} from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import { NODE_KEY_PURPOSE } from "./node-identity.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import "./errors.js";

export interface StandbyIdentity {
  nodeId: string;
  publicKey: string;
  privateKey: string;
}

/** Mint a standby's own identity in memory: a fresh nodeId + Ed25519 keypair. Generated BEFORE the
 * adopt fetch so the public half + nodeId can be sent to the primary for endorsement + number
 * allocation; the private half is sealed by `establishReservedStandbyIdentity` after the tenant
 * exists. */
export function generateStandbyIdentity(): StandbyIdentity {
  const { publicKey, privateKey } = generateNodeKeyPair();
  return { nodeId: randomUUID(), publicKey, privateKey };
}

/**
 * Persist the standby's complete dormant identity on the cloud's own database, inert until a
 * promotion activates it. IDEMPOTENT: if the membership key is already sealed, an earlier adopt
 * attempt already established the identity, so return without re-establishing anything. Otherwise
 * ONE transaction seals the private key, inserts the standby's own node (public_key + endorsement),
 * hands each module its own reservation to establish, and inserts the reserved series.
 *
 * `args.reserved` is WIRE input from the primary. The carrier never inspects `reserved.modules`: each
 * module validates its own state inside `establish` and throws there, which rolls this transaction back
 * — so a malformed reservation leaves no node row behind. Which modules establish is decided by THIS
 * node's enabled set (`args.modules`), never by the bundle's key set: state for a module disabled here
 * is ignored, and a module enabled here whose state the bundle does not carry — no entry, or no
 * `modules` key at all — is handed `undefined` and refuses inside its own `establish`. Hence the
 * optional chain on `reserved.modules` and the `?? []` on `reserved.series`: a bundle missing either
 * key must reach the module's refusal, not a `TypeError` from this carrier.
 */
export async function establishReservedStandbyIdentity(
  deps: { ownerDb: Database; ring: KeyRing },
  args: {
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
  await withTransaction(deps.ownerDb, async (tx) => {
    const existing = await tryGetCredential(tx, deps.ring, { purpose: NODE_KEY_PURPOSE });
    if (existing !== null) return; // already established — idempotent no-op

    await putCredential(tx, deps.ring, {
      purpose: NODE_KEY_PURPOSE,
      value: { privateKey: args.standby.privateKey },
    });
    await insertReservedNodeTx(tx, {
      id: args.standby.nodeId,
      locationId: args.locationId,
      name: args.nodeName,
      filingModule: args.filingModule,
      taxModule: args.taxModule,
      publicKey: args.standby.publicKey,
      endorsement: args.reserved.endorsement,
    });
    const standbyNode = {
      locationId: brandLocationId(args.locationId),
      nodeId: brandNodeId(args.standby.nodeId),
    };
    for (const m of args.modules) {
      if (m.provisioning?.standby === undefined) continue;
      await m.provisioning.standby.establish(tx, standbyNode, args.reserved.modules?.[m.name]);
    }
    await insertReservedSeriesTx(
      tx,
      (args.reserved.series ?? []).map((s) => ({
        nodeId: args.standby.nodeId,
        code: s.code,
        purpose: s.purpose,
      })),
    );
  });
}
