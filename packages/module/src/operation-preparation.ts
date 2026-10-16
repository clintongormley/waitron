import type { OperationBinding } from "./operation-authority.js";
import type { InitialSetupContext } from "./initial-setup.js";
import type { WaitronModule } from "./module.js";
import { AppError } from "@waitron/shared";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  type ModuleOperationInput,
  type ModuleOperations,
} from "./operation-input.js";

export interface ModuleOperationHost {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readRetiredSetup?(module: string): Promise<
    readonly {
      readonly context: InitialSetupContext;
      readonly input: unknown;
      readonly publicEvidence: readonly unknown[];
    }[]
  >;
  readPublicEvidence(
    binding: OperationBinding,
  ): Promise<{ trust: unknown; current: unknown } | undefined>;
}

export function configureModuleOperations(
  modules: readonly WaitronModule[],
  host: ModuleOperationHost,
): readonly WaitronModule[] {
  return modules.map((module) => {
    const operations = module.operations?.configure?.(host) ?? module.operations;
    const initialSetup = module.provisioning?.initialSetup;
    const configuredSetup = initialSetup?.configure?.(host) ?? initialSetup;
    if (module.operations?.configure === undefined && initialSetup?.configure === undefined)
      return module;
    return {
      ...module,
      operations,
      ...(configuredSetup === initialSetup
        ? {}
        : {
            provisioning: { ...module.provisioning, initialSetup: configuredSetup },
          }),
    };
  });
}

export interface ModuleOperationPreparation {
  configure?(host: ModuleOperationHost): ModuleOperationPreparation;
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
