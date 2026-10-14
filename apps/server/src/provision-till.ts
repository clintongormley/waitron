// `scripts/register-till.ts` is the argv/stdout shim over this module.
import { eq } from "drizzle-orm";
import { nodes, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  moduleOperationFor,
  type ModuleOperations,
  type OperationBinding,
  type SeedReport,
  type WaitronModule,
} from "@waitron/module";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import "./errors.js";
import { withRecoveryModuleOperation } from "./recovery-module-operation.js";

export interface ProvisionNodeParams {
  nodeId: NodeId;
  recovery?: {
    readonly binding: OperationBinding;
    readonly input: unknown;
    readonly secret: unknown;
  };
}

/** The location `nodeId` sells at. */
export async function nodeLocation(tx: Transaction, nodeId: NodeId): Promise<string> {
  const [row] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, nodeId));
  if (row === undefined) throw new AppError("node.not_found", { id: nodeId });
  return row.locationId;
}

export async function provisionNode(
  db: Database,
  params: ProvisionNodeParams,
  modules: readonly WaitronModule[],
): Promise<readonly SeedReport[]> {
  const nodeId = params.nodeId;
  const owners = [...modules];
  const supplied = params.recovery;
  const recovery =
    supplied === undefined
      ? undefined
      : {
          binding: {
            module: supplied.binding.module,
            action: supplied.binding.action,
            eventId: supplied.binding.eventId,
            sourceId: supplied.binding.sourceId,
            targetNodeId: supplied.binding.targetNodeId,
          },
          input: structuredClone(supplied.input),
          secret: supplied.secret,
        };
  if (
    recovery !== undefined &&
    (recovery.binding.action !== "re-register" ||
      recovery.binding.targetNodeId !== nodeId ||
      !owners.some(
        (module) =>
          module.name === recovery.binding.module && module.provisioning?.seed !== undefined,
      ))
  )
    throw new AppError("module.operation_invalid", { module: recovery.binding.module });
  const node =
    recovery === undefined
      ? undefined
      : {
          locationId: brandLocationId(await nodeLocation(db, nodeId)),
          nodeId,
        };
  const run = async (tx: Transaction, operations: ModuleOperations = new Map()) => {
    const locationId = await nodeLocation(tx, nodeId);
    if (node !== undefined && locationId !== node.locationId)
      throw new AppError("module.operation_invalid", { module: recovery!.binding.module });
    const target = node ?? { locationId: brandLocationId(locationId), nodeId };
    const seeded: SeedReport[] = [];
    for (const m of owners) {
      if (m.provisioning?.seed === undefined) continue;
      const operation = moduleOperationFor(operations, m.name, nodeId, "re-register");
      const report =
        operation === undefined
          ? await m.provisioning.seed.run(tx, target)
          : await m.provisioning.seed.run(tx, target, operation);
      moduleOperationFor(operations, m.name, nodeId, "re-register");
      seeded.push({ module: m.name, report });
    }
    for (const m of owners) moduleOperationFor(operations, m.name, nodeId, "re-register");
    return seeded;
  };
  return recovery === undefined
    ? withTransaction(db, run)
    : withRecoveryModuleOperation({ db, node: node!, modules: owners }, recovery, run);
}
