import { randomUUID } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  nodes,
  venueLocationId,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { eq } from "drizzle-orm";
import { readOperationalVenueIds } from "@waitron/provisioning";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  withPreparedModuleOperations,
  type ModuleOperations,
  type WaitronModule,
} from "@waitron/module";
import { AppError, locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { ReservedIdentity } from "./mirror-bundle.js";
import "./errors.js";

/** What venue.db learns of a standby: never its private key, which only its own node.db holds. */
export interface StandbyPublicIdentity {
  nodeId: string;
  publicKey: string;
}

export interface StandbyIdentity extends StandbyPublicIdentity {
  privateKey: string;
}

/** Generate the node and key before requesting endorsement and module reservations. */
export function generateStandbyIdentity(): StandbyIdentity {
  const { publicKey, privateKey } = generateNodeKeyPair();
  return { nodeId: randomUUID(), publicKey, privateKey };
}

/**
 * The node and module reservations commit together. Modules that open series at activation receive
 * no scaffold series. The standby's `nodes` row makes repeated adoption a no-op. The enabled module
 * set chooses what establishes; each module validates its own opaque state.
 */
export async function establishReservedStandbyIdentity(
  deps: { ownerDb: Database },
  args: {
    standby: StandbyPublicIdentity;
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
  const standby = { nodeId: supplied.standby.nodeId, publicKey: supplied.standby.publicKey };
  if (await standbyNodeExists(deps.ownerDb, standby.nodeId)) return;
  await withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (prepared) =>
    withTransaction(deps.ownerDb, async (tx) => {
      if (await standbyNodeExists(tx, standby.nodeId)) return;
      if ((await readOperationalVenueIds(tx)).length === 0)
        throw new AppError("mirror.venue_not_copied", {});

      const owner = modules.find(
        (module) => module.provisioning?.standby?.series === "on-activation",
      );
      if (owner !== undefined && (reserved.series?.length ?? 0) !== 0)
        throw new AppError("module.operation_invalid", { module: owner.name });
      const venueId = await venueLocationId(tx);
      await insertReservedNodeTx(tx, {
        id: standby.nodeId,
        locationId: venueId,
        name: supplied.nodeName,
        filingModule: supplied.filingModule,
        taxModule: supplied.taxModule,
        publicKey: standby.publicKey,
        endorsement: reserved.endorsement,
      });
      const standbyNode = {
        locationId: brandLocationId(venueId),
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

async function standbyNodeExists(db: Database | Transaction, nodeId: string): Promise<boolean> {
  const rows = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nodeId));
  return rows.length > 0;
}
