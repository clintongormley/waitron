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
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { readRecoveryCopyPreview } from "./recovery-backup-preview.js";
import {
  readArtifactIdentity,
  validateArtifact,
  validateDatabaseEntries,
  type ValidatedArtifact,
  type ValidationDeps,
  type RestoreOperationRunner,
} from "./restore.js";
import type {
  RecoveryPreparationRequest,
  PrepareRecovery,
} from "./setup-recovery-preparation-api.js";
import { prepareStreamRestore, type PrepareStreamDeps } from "./restore-stream.js";
import { parseRecoveryKit } from "@waitron/stream";
import type { createCloudRecoveryClient } from "./cloud-recovery.js";
import { VENUE_FILE } from "@waitron/store";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
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

export function createInteractiveRecoveryPreparation(options: {
  stateDir: string;
  venueDir: string;
  migrationsRoot: string | null;
  modules: readonly WaitronModule[];
  coordinator: FirstSetupCoordinator;
}) {
  const requests = new AsyncLocalStorage<{ db: Database; hold: FirstSetupHold }>();
  const sessions = new Map<
    string,
    {
      fingerprint: string;
      service: ReturnType<typeof createSelectedRecoveryPreparation>;
    }
  >();
  return {
    async prepare(
      copy: ValidatedArtifact,
      sourceId: string,
      supplied: RecoveryPreparationRequest,
      hold?: FirstSetupHold,
    ): Promise<unknown> {
      const input = structuredClone(supplied);
      const refuse = (): never => {
        throw new AppError("module.operation_invalid", { module: input.binding.module });
      };
      if (input.context.selectedSourceId !== sourceId || input.binding.sourceId !== copy.sourceId)
        return refuse();
      const run = async (currentHold: FirstSetupHold) => {
        const preview = await readRecoveryCopyPreview(copy, sourceId, options);
        const selected = { ...preview, activationSourceId: copy.sourceId };
        const { node } = readArtifactIdentity(copy.secretEntries);
        if (
          input.binding.targetNodeId !== node.nodeId ||
          selected.fiscalSelection?.module !== input.binding.module
        )
          return refuse();
        const store = await openVenueDatabase(dirname(copy.databasePath));
        try {
          await withRecoveryKeyAuthority(
            { db: store.venue, nodeId: node.nodeId },
            input.binding,
            input.nodeRecoverySecret,
            async () => {},
          );
          const key = JSON.stringify([input.binding.module, input.binding.eventId]);
          const fingerprint = createHash("sha256")
            .update(
              JSON.stringify([input.binding, input.context, selected, input.nodeRecoverySecret]),
            )
            .digest("hex");
          let cached = sessions.get(key);
          if (cached?.fingerprint !== fingerprint) {
            sessions.delete(key);
            cached = undefined;
          }
          if (!input.context.oldBoxGone || !input.context.soleRecovery) {
            sessions.delete(key);
            return refuse();
          }
          if (cached === undefined) {
            const active = () => {
              const scope = requests.getStore();
              if (scope === undefined) return refuse();
              return scope;
            };
            cached = {
              fingerprint,
              service: createSelectedRecoveryPreparation({
                ...options,
                selected,
                node,
                binding: input.binding,
                secret: input.nodeRecoverySecret,
                database: () => active().db,
                currentHold: () => active().hold,
                readIsolation: async () => ({
                  oldMachineAbsent: false,
                  oldMachineOffline: true,
                  noParallelRecovery: true,
                }),
              }),
            };
          }
          const result = await requests.run({ db: store.venue, hold: currentHold }, () =>
            cached!.service.prepare(input.proposal),
          );
          if (!sessions.has(key) && sessions.size === 16)
            sessions.delete(sessions.keys().next().value!);
          sessions.set(key, cached);
          return result;
        } finally {
          await store.close();
        }
      };
      return hold === undefined
        ? options.coordinator.run(run)
        : options.coordinator.held(hold, () => run(hold));
    },
  };
}

export function createSetupRecoveryPreparation(
  options: Parameters<typeof createInteractiveRecoveryPreparation>[0] & {
    stagingDir: string;
    cloudRecovery?: Pick<ReturnType<typeof createCloudRecoveryClient>, "preview">;
    bucket: Omit<PrepareStreamDeps, "kit" | "stateDir" | "migrationsRoot" | "oldBoxGone">;
  },
): PrepareRecovery {
  const interactive = createInteractiveRecoveryPreparation(options);
  return async (source, request, hold) => {
    const archive = async (
      input: Pick<ValidationDeps, "artifact" | "recoveryKey" | "environment">,
    ) => {
      const copy = await validateArtifact({ ...options, ...input });
      try {
        return await interactive.prepare(copy, copy.sourceId!, request, hold);
      } finally {
        await copy.discard();
      }
    };
    if (source.kind === "archive") return archive(source);
    if (source.kind === "cloud") {
      if (options.cloudRecovery === undefined) throw new AppError("setup.not_ready", {});
      return options.cloudRecovery.preview(archive, source.pointId);
    }
    const kit = parseRecoveryKit(source.kit);
    const prepared = await prepareStreamRestore({
      ...options,
      ...options.bucket,
      kit,
      oldBoxGone: request.context.oldBoxGone,
    });
    try {
      const copy = await validateDatabaseEntries(prepared.entries, prepared.databasePath, {
        ...options,
        environment: source.environment,
      });
      return await interactive.prepare(
        copy,
        `stream:${kit.venueId}:${prepared.generation}`,
        request,
        hold,
      );
    } finally {
      await prepared.discard();
    }
  };
}
