import {
  lockVenueDatabase,
  openVenueDatabase,
  readBreakGlassKeyName,
  type Database,
} from "@waitron/db";
import {
  configureModuleOperations,
  type ModuleRecoveryFacts,
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
import { AppError, isAppError } from "@waitron/shared";
import { isDeepStrictEqual } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { VENUE_FILE } from "@waitron/store";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import type { RestoreOperationRunner } from "./restore.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import "./errors.js";

interface BaseOptions {
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
}
type Isolation = Pick<
  ModuleRecoveryFacts,
  "oldMachineOffline" | "oldMachineAbsent" | "noParallelRecovery"
>;
type Options = BaseOptions &
  (
    | {
        readRecoveryFacts(binding: OperationBinding, db: Database): Promise<ModuleRecoveryFacts>;
        readIsolation?: never;
      }
    | {
        readRecoveryFacts?: never;
        readIsolation(binding: OperationBinding, db: Database): Promise<Isolation>;
      }
  );
export function createSelectedRecoveryPreparation(options: Options): {
  readonly modules: readonly WaitronModule[];
  prepare(proposal: unknown): Promise<unknown>;
  runner(input: unknown, options?: { refresh: true }): RestoreOperationRunner;
} {
  const binding = Object.freeze({ ...options.binding });
  const node = Object.freeze({ ...options.node });
  const selected = structuredClone(options.selected);
  const secret = options.secret;
  const databases = new AsyncLocalStorage<Database>();
  const database = () => databases.getStore() ?? options.database();
  const survivingHistory: unknown[] = [];
  const refuse = (): never => {
    throw new AppError("module.operation_invalid", { module: binding.module });
  };
  const captureSurvivingHistory = async () => {
    try {
      if (!(await lstat(join(options.venueDir, VENUE_FILE))).isFile()) return refuse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const reader = options.modules.find((module) => module.name === binding.module)?.operations
      ?.readRecoveryHistory;
    if (reader === undefined) return refuse();
    try {
      const target = await openVenueDatabase(options.venueDir);
      try {
        for (const evidence of await reader(target.venue))
          if (!survivingHistory.some((known) => isDeepStrictEqual(known, evidence)))
            survivingHistory.push(structuredClone(evidence));
      } finally {
        await target.close();
      }
    } catch (error) {
      if (isAppError(error)) throw error;
      return refuse();
    }
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
      const current = await (async () => {
        const db = database();
        if (options.readRecoveryFacts !== undefined) return options.readRecoveryFacts(held, db);
        const reader = options.modules.find((module) => module.name === binding.module)?.operations
          ?.readRecoveryState;
        if (reader === undefined) return refuse();
        const stored = await reader(db, node, held);
        const isolation = await options.readIsolation(held, db);
        return {
          ...stored,
          oldMachineAbsent: isolation.oldMachineAbsent,
          oldMachineOffline: isolation.oldMachineOffline,
          noParallelRecovery: isolation.noParallelRecovery,
          contextKey: JSON.stringify([
            binding,
            stored.country,
            stored.taxId,
            stored.environment,
            stored.bases,
          ]),
        };
      })();
      check();
      if (
        current.country !== selected.fiscalSelection!.country ||
        current.taxId !== selected.taxpayer.taxId ||
        current.environment !== selected.environment
      )
        return refuse();
      if (
        current.oldMachineOffline === true &&
        current.oldMachineAbsent === false &&
        current.noParallelRecovery === true
      )
        await captureSurvivingHistory();
      return {
        ...current,
        history: [
          ...current.history,
          ...survivingHistory,
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
    runner(input, entry) {
      checkSelection();
      const runner = createRecoveryRestoreRunner(modules, { binding, input }, secret);
      let refreshed = false;
      const scoped: RestoreOperationRunner = (context, run) =>
        databases.run(context.db, async () => {
          if (entry?.refresh === true && !refreshed) {
            if (contribution?.resumeRecovery === undefined) return refuse();
            await withRecoveryKeyAuthority(
              { db: context.db, nodeId: node.nodeId },
              binding,
              secret,
              (authority) => contribution.resumeRecovery!({ binding, authority }),
            );
          }
          const result = await runner(context, run);
          refreshed = true;
          return result;
        });
      scoped.checkBeforePlacement = async (context) => {
        if (context.sourceId !== binding.sourceId) return refuse();
        refreshed = false;
        await scoped(context, async () => ({ seriesId: "", reports: [] }));
      };
      return scoped;
    },
  };
}
