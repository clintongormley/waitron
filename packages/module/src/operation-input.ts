import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "./operation-authority.js";

export interface ModuleOperationInput {
  readonly input: unknown;
  readonly binding: OperationBinding;
  readonly authority: OperationAuthority;
}

export type ModuleOperations = ReadonlyMap<string, ModuleOperationInput>;

export function snapshotModuleOperations(
  operations: ModuleOperations | undefined,
): ModuleOperations {
  return new Map(
    [...(operations ?? [])].map(([name, operation]) => [
      name,
      Object.freeze({ ...operation, binding: Object.freeze({ ...operation.binding }) }),
    ]),
  );
}

export function moduleOperationFor(
  operations: ModuleOperations,
  name: string,
  targetNodeId: string,
  action: string,
): ModuleOperationInput | undefined {
  const operation = operations.get(name);
  if (operation === undefined) return undefined;
  if (
    operation.binding.module !== name ||
    operation.binding.targetNodeId !== targetNodeId ||
    operation.binding.action !== action ||
    readOperationAuthority(operation.authority, operation.binding) === undefined
  )
    throw new AppError("module.operation_invalid", { module: name });
  return operation;
}
