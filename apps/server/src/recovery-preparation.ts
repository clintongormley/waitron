import {
  lockVenueDatabase,
  openVenueDatabase,
  readBreakGlassKeyName,
  type Database,
} from "@waitron/db";
import {
  configureModuleOperations,
  type ModuleOperationHost,
  type ModuleRecoveryFacts,
  type OperationBinding,
  type OperationClient,
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
import { chmod, copyFile, lstat, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  StageRecovery,
  DiscardStagedRecovery,
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
  testClock?: ModuleOperationHost["testClock"];
  /** Recovery states already read from this same unchanging database, keyed by node and binding. */
  rememberedStates?(): Map<string, unknown> | undefined;
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
  prepare(proposal: unknown, client: OperationClient): Promise<unknown>;
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
        const remembered = options.rememberedStates?.();
        const memoKey = JSON.stringify([node, held]);
        let stored = remembered?.get(memoKey) as Awaited<ReturnType<typeof reader>> | undefined;
        if (stored === undefined) {
          stored = await reader(db, node, held);
          remembered?.set(memoKey, stored);
        }
        stored = structuredClone(stored);
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
          {
            reference: "backup-created",
            complete: true,
            records: [],
            timeFloorMs: Date.parse(selected.createdAt),
          },
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
  const host = createModuleOperationHost({}, { ...scoped, testClock: options.testClock });
  const modules = configureModuleOperations(options.modules, host);
  const contribution = modules.find((module) => module.name === binding.module)?.operations;
  return {
    modules,
    async prepare(proposal, client) {
      checkSelection();
      if (contribution?.recovery === undefined) return refuse();
      return withRecoveryKeyAuthority(
        { db: database(), nodeId: node.nodeId },
        binding,
        secret,
        (authority) => contribution.recovery!({ binding, authority }, proposal, client),
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
  testClock?: ModuleOperationHost["testClock"];
}) {
  const requests = new AsyncLocalStorage<{
    db: Database;
    hold: FirstSetupHold;
    rememberedStates?: Map<string, unknown>;
  }>();
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
      hold: FirstSetupHold | undefined,
      client: OperationClient,
      /** For a copy migrated once and never written again: its preview, and its states as read. */
      staged?: { preview: RecoveryBackupPreview; rememberedStates: Map<string, unknown> },
    ): Promise<unknown> {
      const input = structuredClone(supplied);
      const refuse = (): never => {
        throw new AppError("module.operation_invalid", { module: input.binding.module });
      };
      if (input.context.selectedSourceId !== sourceId || input.binding.sourceId !== copy.sourceId)
        return refuse();
      const run = async (currentHold: FirstSetupHold) => {
        const preview = staged?.preview ?? (await readRecoveryCopyPreview(copy, sourceId, options));
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
                rememberedStates: () => requests.getStore()?.rememberedStates,
                readIsolation: async () => ({
                  oldMachineAbsent: false,
                  oldMachineOffline: true,
                  noParallelRecovery: true,
                }),
              }),
            };
          }
          const result = await requests.run(
            { db: store.venue, hold: currentHold, rememberedStates: staged?.rememberedStates },
            () => cached!.service.prepare(input.proposal, client),
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

/** Inside `stagingDir`; boot removes it whole, since each copy in it is a decrypted venue database. */
export const STAGED_RECOVERY_DIR = "staged-recovery";
export const STAGED_RECOVERY_UNUSED_MS = 60 * 60_000;
export async function clearStagedRecoveries(stagingDir: string): Promise<void> {
  await rm(join(stagingDir, STAGED_RECOVERY_DIR), { recursive: true, force: true });
}

interface StagedCopy {
  readonly id: string;
  readonly eventId: string;
  /** Left exactly as validated. Its decrypted secret entries stay in memory for as long as the
   * copy is kept. */
  readonly copy: ValidatedArtifact & { readonly sourceId: string };
  /** A copy of `copy` inside its folder, migrated once when staged; requests only read it. */
  readonly working: string;
  readonly preview: RecoveryBackupPreview;
  readonly rememberedStates: Map<string, unknown>;
  usedAt: number;
  users: number;
  retired: boolean;
}

export function createSetupRecoveryPreparation(
  options: Parameters<typeof createInteractiveRecoveryPreparation>[0] & {
    stagingDir: string;
    cloudRecovery?: Pick<ReturnType<typeof createCloudRecoveryClient>, "preview">;
    bucket: Omit<PrepareStreamDeps, "kit" | "stateDir" | "migrationsRoot" | "oldBoxGone">;
  },
): PrepareRecovery & {
  stage: StageRecovery;
  discard: DiscardStagedRecovery;
  clearStaged(): Promise<void>;
} {
  const interactive = createInteractiveRecoveryPreparation(options);
  const stagedDir = join(options.stagingDir, STAGED_RECOVERY_DIR);
  let staged: StagedCopy | undefined;
  // Ids a later upload replaced in this process, the last 64 of them, so their page stops rather
  // than uploading again; any other id the box does not hold is answered as missing.
  const replaced = new Set<string>();
  let expiry: NodeJS.Timeout | undefined;
  const release = async (entry: StagedCopy) => {
    entry.retired = true;
    if (entry.users === 0) await entry.copy.discard();
  };
  const drop = async (entry: StagedCopy) => {
    if (staged !== entry) return;
    staged = undefined;
    clearTimeout(expiry);
    await release(entry);
  };
  const touch = (entry: StagedCopy) => {
    entry.usedAt = Date.now();
    clearTimeout(expiry);
    // Boot clears whatever a failed delete leaves behind.
    expiry = setTimeout(() => drop(entry).catch(() => {}), STAGED_RECOVERY_UNUSED_MS + 1);
    expiry.unref();
  };
  // Read at each use as well as by the timer, so a clock moved past the hour is refused at once.
  const live = async () => {
    const entry = staged;
    if (entry !== undefined && Date.now() - entry.usedAt > STAGED_RECOVERY_UNUSED_MS)
      await drop(entry);
    return staged;
  };
  const refuseStaged = (): never => {
    throw new AppError("setup.request_invalid", { field: "stagedId" });
  };
  const missingStaged = (): never => {
    throw new AppError("restore.staged_copy_missing", {});
  };
  const prepare: PrepareRecovery = async (source, request, hold, client) => {
    const archive = async (
      input: Pick<ValidationDeps, "artifact" | "recoveryKey" | "environment">,
    ) => {
      const copy = await validateArtifact({ ...options, ...input });
      try {
        return await interactive.prepare(copy, copy.sourceId!, request, hold, client);
      } finally {
        await copy.discard();
      }
    };
    if (source.kind === "staged") {
      const entry = await live();
      if (replaced.has(source.stagedId)) return refuseStaged();
      if (entry?.id !== source.stagedId) return missingStaged();
      if (entry.eventId !== request.binding.eventId) return refuseStaged();
      entry.users += 1;
      touch(entry);
      try {
        return await interactive.prepare(
          { ...entry.copy, databasePath: entry.working, discard: async () => {} },
          entry.copy.sourceId,
          request,
          hold,
          client,
          entry,
        );
      } finally {
        entry.users -= 1;
        if (entry.retired) await release(entry);
        else touch(entry);
      }
    }
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
        client,
      );
    } finally {
      await prepared.discard();
    }
  };
  const stage: StageRecovery = async (eventId, source) => {
    const copy = await validateArtifact({ ...options, ...source, stagingDir: stagedDir });
    let working: string;
    let preview: RecoveryBackupPreview;
    try {
      const folder = join(dirname(copy.databasePath), "working");
      await mkdir(folder, { mode: 0o700 });
      working = join(folder, VENUE_FILE);
      await copyFile(copy.databasePath, working);
      await chmod(working, 0o600);
      preview = await readRecoveryCopyPreview(
        { ...copy, databasePath: working },
        copy.sourceId,
        options,
      );
    } catch (error) {
      await copy.discard();
      throw error;
    }
    const previous = await live();
    const entry: StagedCopy = {
      id: randomUUID(),
      eventId,
      copy,
      working,
      preview,
      rememberedStates: new Map(),
      usedAt: Date.now(),
      users: 0,
      retired: false,
    };
    staged = entry;
    touch(entry);
    if (previous !== undefined) {
      if (replaced.size === 64) replaced.delete(replaced.values().next().value!);
      replaced.add(previous.id);
      await release(previous);
    }
    return { stagedId: entry.id };
  };
  const discard: DiscardStagedRecovery = async (stagedId) => {
    const entry = staged;
    if (entry !== undefined && entry.id === stagedId) await drop(entry);
  };
  const clearStaged = async () => {
    const entry = staged;
    if (entry !== undefined) await drop(entry);
    await clearStagedRecoveries(options.stagingDir);
  };
  return Object.assign(prepare, { stage, discard, clearStaged });
}
