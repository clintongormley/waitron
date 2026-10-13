import "./errors.js";
import { open, type FileHandle } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { Database, Transaction } from "@waitron/db";
import { AppError, isUuid } from "@waitron/shared";
import {
  withPreparedModuleOperations,
  type ModuleOperations,
  type OperationBinding,
  type ProvisionedNode,
  type WaitronModule,
} from "@waitron/module";
import { withRecoveryKeyOperation } from "./operation-authentication.js";
import type { RestoreOperationRunner } from "./restore.js";

export interface RecoveryOperationInput {
  readonly binding: OperationBinding;
  readonly input: unknown;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

export function parseRecoveryOperationInput(value: unknown): RecoveryOperationInput | null {
  if (
    !exact(value, ["binding", "input"]) ||
    !exact(value.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"])
  )
    return null;
  const { module, action, eventId, sourceId, targetNodeId } = value.binding;
  if (
    !text(module) ||
    !/^[a-z][a-z0-9-]*$/.test(module) ||
    typeof action !== "string" ||
    !["restore", "re-register", "promote"].includes(action) ||
    !text(eventId) ||
    !text(sourceId) ||
    typeof targetNodeId !== "string" ||
    !isUuid(targetNodeId)
  )
    return null;
  try {
    const input = structuredClone(value.input);
    if (!isDeepStrictEqual(input, JSON.parse(JSON.stringify(input)))) return null;
    return {
      binding: { module, action, eventId, sourceId, targetNodeId: targetNodeId.toLowerCase() },
      input,
    };
  } catch {
    return null;
  }
}

export async function readRecoveryOperationFile(path: string): Promise<RecoveryOperationInput> {
  let file: FileHandle | undefined;
  try {
    if (path === "") throw new Error("empty path");
    file = await open(path, "r");
    if (!(await file.stat()).isFile()) throw new Error("not a file");
    const buffer = Buffer.alloc(131073);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 131072) throw new Error("oversized input");
    const parsed = parseRecoveryOperationInput(
      JSON.parse(buffer.subarray(0, count).toString("utf8")),
    );
    if (parsed === null) throw new Error("invalid input");
    return parsed;
  } catch {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_RECOVERY_OPERATION_FILE",
      reason: "invalid_operation",
    });
  } finally {
    await file?.close();
  }
}

export function createRecoveryRestoreRunner(
  modules: readonly WaitronModule[],
  supplied: RecoveryOperationInput,
  secret: unknown,
): RestoreOperationRunner {
  const operation = parseRecoveryOperationInput(supplied);
  if (operation === null)
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_RECOVERY_OPERATION_FILE",
      reason: "invalid_operation",
    });
  const owners = [...modules];
  if (
    operation.binding.action !== "restore" ||
    !owners.some(
      (module) => module.name === operation.binding.module && module.backup?.restore !== undefined,
    )
  )
    throw new AppError("module.operation_invalid", { module: operation.binding.module });
  return (context, run) =>
    withRecoveryModuleOperation({ ...context, modules: owners }, { ...operation, secret }, run);
}

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
