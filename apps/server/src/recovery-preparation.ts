import { lockVenueDatabase, readBreakGlassKeyName, type Database } from "@waitron/db";
import {
  configureModuleOperations,
  type ModuleOperationHost,
  type OperationBinding,
  type ProvisionedNode,
  type WaitronModule,
} from "@waitron/module";
import {
  createModuleOperationHost,
  createRecoveryPreparationHost,
  type FirstSetupCoordinator,
  type FirstSetupHold,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { isDeepStrictEqual } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import type { RestoreOperationRunner } from "./restore.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import "./errors.js";

interface Options {
  stateDir: string;
  venueDir: string;
  coordinator: FirstSetupCoordinator;
  currentHold?(): FirstSetupHold | undefined;
  modules: readonly WaitronModule[];
  binding: OperationBinding;
  node: ProvisionedNode;
  secret: unknown;
  database(): Database;
  selected: RecoveryBackupPreview;
  readRecoveryFacts(
    binding: OperationBinding,
    db: Database,
  ): ReturnType<NonNullable<ModuleOperationHost["readRecoveryFacts"]>>;
}
export function createSelectedRecoveryPreparation(options: Options): {
  readonly modules: readonly WaitronModule[];
  prepare(proposal: unknown): Promise<unknown>;
  runner(input: unknown): RestoreOperationRunner;
} {
  const binding = Object.freeze({ ...options.binding });
  const node = Object.freeze({ ...options.node });
  const selected = structuredClone(options.selected);
  const secret = options.secret;
  const databases = new AsyncLocalStorage<Database>();
  const database = () => databases.getStore() ?? options.database();
  const refuse = (): never => {
    throw new AppError("module.operation_invalid", { module: binding.module });
  };
  const checkSelection = () => {
    if (
      !selected.nodeRecoveryKeyName?.trim() ||
      selected.fiscalSelection?.module !== binding.module ||
      binding.sourceId !== (selected.activationSourceId ?? selected.sourceId) ||
      binding.targetNodeId !== node.nodeId ||
      node.nodeId !== selected.nodeId ||
      !["restore", "re-register"].includes(binding.action)
    )
      refuse();
  };
  const authorize = async (held: OperationBinding) => {
    checkSelection();
    if (!isDeepStrictEqual(held, binding)) refuse();
    const db = database();
    if ((await readBreakGlassKeyName(db, node.nodeId)) !== selected.nodeRecoveryKeyName) refuse();
    await withRecoveryKeyAuthority({ db, nodeId: node.nodeId }, binding, secret, async () => {});
  };
  const scoped = createRecoveryPreparationHost({
    stateDir: options.stateDir,
    venueDir: options.venueDir,
    coordinator: options.coordinator,
    currentHold: options.currentHold,
    authorize,
    withVenueExclusion: async (run) => {
      const lock = await lockVenueDatabase(options.venueDir);
      try {
        return await run();
      } finally {
        lock.release();
      }
    },
    readRecoveryFacts: async (held, check) => {
      checkSelection();
      const current = await options.readRecoveryFacts(held, database());
      check();
      if (
        current.country !== selected.fiscalSelection!.country ||
        current.taxId !== selected.taxpayer.taxId ||
        current.environment !== selected.environment
      )
        return refuse();
      return {
        ...current,
        history: [
          ...current.history,
          ...Object.values(selected.moduleEvidence?.[binding.module] ?? {}),
        ],
        contextKey: JSON.stringify([
          binding,
          selected.sourceId,
          selected.createdAt,
          selected.nodeRecoveryKeyName,
          selected.fiscalSelection,
          current.contextKey,
        ]),
      };
    },
  });
  const host = createModuleOperationHost({}, scoped);
  const modules = configureModuleOperations(options.modules, host);
  const contribution = modules.find((module) => module.name === binding.module)?.operations;
  return {
    modules,
    async prepare(proposal) {
      checkSelection();
      if (contribution?.recovery === undefined) return refuse();
      return withRecoveryKeyAuthority(
        { db: database(), nodeId: node.nodeId },
        binding,
        secret,
        (authority) => contribution.recovery!({ binding, authority }, proposal),
      );
    },
    runner(input) {
      checkSelection();
      const runner = createRecoveryRestoreRunner(modules, { binding, input }, secret);
      return (context, run) => databases.run(context.db, () => runner(context, run));
    },
  };
}
