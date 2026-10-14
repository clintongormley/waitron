import type { WaitronModule } from "./module.js";
import { AppError } from "@waitron/shared";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  type ModuleOperationInput,
  type ModuleOperations,
} from "./operation-input.js";

export interface ModuleOperationPreparation {
  prepare<T>(
    operation: ModuleOperationInput,
    run: (prepared: ModuleOperationInput) => Promise<T>,
  ): Promise<T>;
}

export async function withPreparedModuleOperations<T>(
  modules: readonly WaitronModule[],
  operations: ModuleOperations,
  targetNodeId: string,
  action: string,
  run: (prepared: ModuleOperations) => Promise<T>,
): Promise<T> {
  const supplied = snapshotModuleOperations(operations);
  const selected = [...modules];
  const visit = async (index: number, ready: ModuleOperations): Promise<T> => {
    const module = selected[index];
    if (module === undefined) return run(ready);
    if (module.operations === undefined) return visit(index + 1, ready);
    const operation = moduleOperationFor(ready, module.name, targetNodeId, action);
    if (operation === undefined) return visit(index + 1, ready);
    let active = true;
    try {
      return await module.operations.prepare(operation, async (prepared) => {
        const next = new Map(ready);
        next.set(module.name, prepared);
        if (!active || prepared.authority !== operation.authority)
          throw new AppError("module.operation_invalid", { module: module.name });
        moduleOperationFor(next, module.name, targetNodeId, action);
        return visit(index + 1, snapshotModuleOperations(next));
      });
    } finally {
      active = false;
    }
  };
  return visit(0, supplied);
}
