import "./errors.js";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { TotpKeyRing } from "@waitron/identity";
import {
  withPreparedModuleOperations,
  type OperationAuthority,
  type WaitronModule,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import {
  withAuthenticatedOperation,
  withRecoveryKeyAuthority,
} from "./operation-authentication.js";
import type { RecoveryOperationInput } from "./recovery-module-operation.js";
import type { PromotionOperationRunner } from "./promote.js";

export async function withPromotionModuleOperation<T>(
  deps: {
    readonly db: Database;
    readonly nodeId: string;
    readonly credentialKeyRing: TotpKeyRing;
    readonly modules: readonly WaitronModule[];
  },
  operation: RecoveryOperationInput,
  credentials: {
    readonly breakGlass?: unknown;
    readonly personId?: unknown;
    readonly password?: unknown;
    readonly totp?: unknown;
  },
  run: (runner: PromotionOperationRunner) => Promise<T>,
): Promise<T> {
  const { db, nodeId, credentialKeyRing } = deps;
  const modules = [...deps.modules];
  const binding = Object.freeze({ ...operation.binding });
  const input = structuredClone(operation.input);
  const invalid = (): never => {
    throw new AppError("module.operation_invalid", { module: binding.module });
  };
  if (
    binding.action !== "promote" ||
    binding.targetNodeId !== nodeId ||
    !modules.some(
      (module) =>
        module.name === binding.module && module.provisioning?.standby?.activate !== undefined,
    )
  )
    invalid();

  const scopedRun = (
    authority: OperationAuthority,
    commit: (consume: (tx: Transaction) => Promise<string>) => Promise<string>,
  ) =>
    run(async (context, consume) => {
      if (context.db !== db || context.node.nodeId !== nodeId) return invalid();
      return withPreparedModuleOperations(
        modules,
        new Map([[binding.module, { binding, authority, input }]]),
        nodeId,
        "promote",
        (ready) => commit((tx) => consume(tx, ready)),
      );
    });

  if (typeof credentials.breakGlass === "string") {
    return withRecoveryKeyAuthority(
      { db, nodeId },
      binding,
      credentials.breakGlass,
      (authority, commit) => scopedRun(authority, commit),
    );
  }

  return withAuthenticatedOperation(
    { db, credentialKeyRing },
    { binding, permission: "node.promote" },
    credentials,
    (authority) => scopedRun(authority, (consume) => withTransaction(db, consume)),
  );
}
