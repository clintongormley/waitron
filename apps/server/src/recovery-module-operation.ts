import type { Database, Transaction } from "@waitron/db";
import {
  withPreparedModuleOperations,
  type ModuleOperations,
  type OperationBinding,
  type ProvisionedNode,
  type WaitronModule,
} from "@waitron/module";
import { withRecoveryKeyOperation } from "./operation-authentication.js";

export async function withRecoveryModuleOperation<T>(
  context: {
    readonly db: Database;
    readonly node: ProvisionedNode;
    readonly modules: readonly WaitronModule[];
  },
  operation: {
    readonly binding: OperationBinding;
    readonly input: unknown;
    readonly secret: unknown;
  },
  run: (tx: Transaction, operations: ModuleOperations) => Promise<T>,
): Promise<T> {
  const { db } = context;
  const targetNodeId = context.node.nodeId;
  const modules = [...context.modules];
  const binding = Object.freeze({
    module: operation.binding.module,
    action: operation.binding.action,
    eventId: operation.binding.eventId,
    sourceId: operation.binding.sourceId,
    targetNodeId: operation.binding.targetNodeId,
  });
  const { input, secret } = operation;
  let collected: ModuleOperations = new Map();
  return withRecoveryKeyOperation(
    { db, nodeId: targetNodeId },
    binding,
    secret,
    (tx) => run(tx, collected),
    (authority, commit) =>
      withPreparedModuleOperations(
        modules,
        new Map([[binding.module, { binding, authority, input }]]),
        targetNodeId,
        binding.action,
        (ready) => {
          collected = ready;
          return commit();
        },
      ),
  );
}
