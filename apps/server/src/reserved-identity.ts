import { randomUUID } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import { putCredential, tryGetCredential, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  withTransaction,
  type Database,
} from "@waitron/db";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  withPreparedModuleOperations,
  type ModuleOperations,
  type WaitronModule,
} from "@waitron/module";
import { AppError, locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import { NODE_KEY_PURPOSE } from "./node-identity.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import "./errors.js";

export interface StandbyIdentity {
  nodeId: string;
  publicKey: string;
  privateKey: string;
}

/** Generate the node and key before requesting endorsement and module reservations. */
export function generateStandbyIdentity(): StandbyIdentity {
  const { publicKey, privateKey } = generateNodeKeyPair();
  return { nodeId: randomUUID(), publicKey, privateKey };
}

/**
 * The sealed key, node and module reservations commit together. Modules that open series at
 * activation receive no scaffold series. A sealed membership key makes repeated adoption a no-op.
 * The enabled module set chooses what establishes; each module validates its own opaque state.
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
    moduleOperations?: ModuleOperations;
  },
): Promise<void> {
  const supplied = { ...args };
  const operations = snapshotModuleOperations(supplied.moduleOperations);
  const modules = [...supplied.modules];
  const reserved = structuredClone(supplied.reserved);
  const standby = { ...supplied.standby };
  if ((await tryGetCredential(deps.ownerDb, deps.ring, { purpose: NODE_KEY_PURPOSE })) !== null)
    return;
  await withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (prepared) =>
    withTransaction(deps.ownerDb, async (tx) => {
      const existing = await tryGetCredential(tx, deps.ring, { purpose: NODE_KEY_PURPOSE });
      if (existing !== null) return;

      const owner = modules.find(
        (module) => module.provisioning?.standby?.series === "on-activation",
      );
      if (owner !== undefined && (reserved.series?.length ?? 0) !== 0)
        throw new AppError("module.operation_invalid", { module: owner.name });
      await putCredential(tx, deps.ring, {
        purpose: NODE_KEY_PURPOSE,
        value: { privateKey: standby.privateKey },
      });
      await insertReservedNodeTx(tx, {
        id: standby.nodeId,
        locationId: supplied.locationId,
        name: supplied.nodeName,
        filingModule: supplied.filingModule,
        taxModule: supplied.taxModule,
        publicKey: standby.publicKey,
        endorsement: reserved.endorsement,
      });
      const standbyNode = {
        locationId: brandLocationId(supplied.locationId),
        nodeId: brandNodeId(standby.nodeId),
      };
      for (const m of modules) {
        if (m.provisioning?.standby === undefined) continue;
        const operation = moduleOperationFor(prepared, m.name, standbyNode.nodeId, "establish");
        await m.provisioning.standby.establish(
          tx,
          standbyNode,
          reserved.modules?.[m.name],
          operation,
        );
        moduleOperationFor(prepared, m.name, standbyNode.nodeId, "establish");
      }
      await insertReservedSeriesTx(
        tx,
        (reserved.series ?? []).map((s) => ({
          nodeId: standby.nodeId,
          code: s.code,
          purpose: s.purpose,
        })),
      );
      for (const m of modules) {
        if (m.provisioning?.standby !== undefined)
          moduleOperationFor(prepared, m.name, standbyNode.nodeId, "establish");
      }
    }),
  );
}
