import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { openVenueDatabase, readBreakGlassVerifier, type Database } from "@waitron/db";
import type { OperationBinding, OperationClient, WaitronModule } from "@waitron/module";
import {
  firstSetupAnchorFor,
  canonicalFirstSetupDirectory,
  resolveFirstSetupWorkspace,
  readDurableHostJson,
  writeDurableHostJson,
  type FirstSetupHold,
  type BackupRepairRecord,
  type BackupRepairObservation,
  type FirstSetupRoots,
  createFirstSetupBackupWorkspace,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import {
  authenticatedFirstSetupBackupPreview,
  openFirstSetupBackupSource,
  type BackupRepairSource,
  type BackupRepairSourceDeps,
} from "./first-setup-backup-source.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import { readArtifactIdentity } from "./restore.js";
import { readRecoveryCopyPreview } from "./recovery-backup-preview.js";
import { readFirstSetupBackupHistory } from "./first-setup-backup-history.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import "./errors.js";

export interface BackupRepairOptions extends FirstSetupRoots {
  environment: DeploymentEnvironment;
  modules: readonly WaitronModule[];
  host: FirstFiscalHost;
  sources: BackupRepairSourceDeps;
  workspace: ReturnType<typeof createFirstSetupBackupWorkspace>;
  log: Logger;
}
export interface BackupRepairOpenRequest {
  observation: Omit<BackupRepairObservation, "originalsDigest">;
  source: BackupRepairSource;
  nodeRecoverySecret: string;
  context: { oldBoxGone: boolean; soleRecovery: boolean };
  recoveryId?: string;
}
export interface BackupRepairSession {
  sessionId: string;
  recoveryId: string;
  preview: RecoveryBackupPreview;
  binding: OperationBinding;
}
const UNUSED_MS = 15 * 60_000;
type Selected = Awaited<ReturnType<typeof openFirstSetupBackupSource>>;
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function ownerRequired(): never {
  throw new AppError("setup.owner_required", {});
}
async function fingerprint(selected: Selected): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(selected.copy.databasePath)) hash.update(bytes);
  hash.update(JSON.stringify([selected.sourceId, selected.copy.sourceId, selected.copy.manifest]));
  for (const entry of selected.copy.secretEntries) {
    hash.update(JSON.stringify([entry.name, entry.bytes.byteLength]));
    hash.update(entry.bytes);
  }
  return hash.digest("hex");
}
async function verifier(selected: Selected): Promise<string | null> {
  const { node } = readArtifactIdentity(selected.copy.secretEntries);
  const db = await openVenueDatabase(dirname(selected.copy.databasePath));
  try {
    return await readBreakGlassVerifier(db.venue, node.nodeId);
  } finally {
    await db.close();
  }
}
export function createFirstSetupBackupRecovery(options: BackupRepairOptions) {
  let generation = 0;
  let disposed = false;
  type Entry = {
    session: BackupRepairSession;
    usedAt: number;
    discard(): Promise<void>;
    request: BackupRepairOpenRequest;
    selected: Selected;
    originalsDigest: string;
    sourceDigest: string;
    provedVerifier: string | null;
    working?: string;
    preparation?: ReturnType<typeof createSelectedRecoveryPreparation>;
    record?: Omit<
      BackupRepairRecord,
      "version" | "sequence" | "previousRecordDigest" | "recordedAt"
    >;
    evidence?: Record<string, unknown>;
  };
  let active: Entry | undefined;
  const scopes = new AsyncLocalStorage<{ hold: FirstSetupHold; db: Database }>();
  let expiry: NodeJS.Timeout | undefined;
  const drop = async () => {
    const old = active;
    active = undefined;
    clearTimeout(expiry);
    await old?.discard();
  };
  const touch = (entry: Entry) => {
    entry.usedAt = performance.now();
    clearTimeout(expiry);
    expiry = setTimeout(
      () =>
        options.host.coordinator
          .run(async () => {
            if (active === entry) await drop();
          })
          .catch(() => {}),
      UNUSED_MS + 1,
    );
    expiry.unref();
  };
  const turn = <T>(run: (hold: FirstSetupHold) => Promise<T>) =>
    options.host.resolution.withVenueExclusion(() => options.host.coordinator.run(run));
  const observation = async () => {
    const inspection = await options.host.resolution.inspectFirstSetupResolution();
    return {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision,
      ownerGeneration: inspection.ownerGeneration,
    };
  };
  const recheck = async (entry: Entry) => {
    if (disposed || active !== entry) ownerRequired();
    if (performance.now() - entry.usedAt > UNUSED_MS) {
      await drop();
      ownerRequired();
    }
    if (
      !isDeepStrictEqual(await observation(), entry.request.observation) ||
      (await options.workspace.inspect(entry.session.recoveryId)) !== entry.originalsDigest ||
      (await fingerprint(entry.selected)) !== entry.sourceDigest ||
      (await verifier(entry.selected)) !== entry.provedVerifier
    )
      conflict();
    if (entry.preparation !== undefined) {
      const latest = (await options.workspace.read()).at(-1);
      if (
        latest === undefined ||
        !isDeepStrictEqual(
          Object.fromEntries(
            Object.keys(entry.record!).map((key) => [key, latest[key as keyof BackupRepairRecord]]),
          ),
          entry.record,
        )
      )
        conflict();
    }
  };
  const admitted = async (sessionId: string) => {
    if (active === undefined || active.session.sessionId !== sessionId) ownerRequired();
    const entry = active;
    await recheck(entry);
    touch(entry);
    return entry;
  };
  const evidence = async (entry: Entry, allowMissing: boolean) => {
    const stateDir = entry.record!.target.target.stateDir;
    for (const [name, value] of Object.entries(entry.evidence!)) {
      const path = join(stateDir, "module-evidence", entry.session.binding.module, `${name}.json`);
      const current = await readDurableHostJson(path, 1024 * 1024);
      if (current === null && allowMissing) await writeDurableHostJson(path, value, 1024 * 1024);
      else if (!isDeepStrictEqual(current, value)) conflict();
    }
  };
  const preparation = async (entry: Entry) => {
    if (entry.preparation !== undefined) {
      await evidence(entry, false);
      return entry.preparation;
    }
    const module = options.host.modules.find(
      (module) => module.name === entry.session.binding.module,
    );
    const refuse = (): never => {
      throw new AppError("module.operation_invalid", { module: entry.session.binding.module });
    };
    if (module?.operations?.readRecoveryState === undefined) return refuse();
    const history = await readFirstSetupBackupHistory({
      ...options,
      module,
      withVenueExclusion: async (run) => run(),
      recheck: () => recheck(entry),
    });
    const documents: Record<string, unknown> = {};
    for (const source of module.backup?.nonDbState ?? []) {
      if (source.kind !== "preparation-history") continue;
      if (!/^[a-z][a-z0-9-]*$/.test(source.source)) return refuse();
      const retained = [
        history.documents[source.source],
        entry.session.preview.moduleEvidence?.[module.name]?.[source.source],
      ].filter((value) => value !== undefined);
      documents[source.source] = source.project({
        preparations: [],
        retained,
        recovery: { history: history.databases, setups: [], publicEvidence: [] },
      });
    }
    if (history.databases.length > 0 && Object.keys(documents).length === 0) return refuse();
    const anchor = await firstSetupAnchorFor(options);
    const source = await resolveFirstSetupWorkspace(options);
    const base = join(
      anchor.stateDir,
      "first-setup-resolutions",
      "backup-recovery",
      entry.session.recoveryId,
      "target",
    );
    const next = {
      target: {
        recoveryId: entry.session.recoveryId,
        anchor,
        source: {
          stateDir: await canonicalFirstSetupDirectory(source.stateDir),
          venueDir: await canonicalFirstSetupDirectory(source.venueDir),
        },
        target: { stateDir: join(base, "state"), venueDir: join(base, "venue") },
        generation: 1,
      },
      observation: { ...entry.request.observation, originalsDigest: entry.originalsDigest },
      sourceId: entry.selected.sourceId,
      activationSourceId: entry.selected.copy.sourceId!,
      binding: entry.session.binding,
      input: null,
      retainedEvidenceDigest: createHash("sha256").update(JSON.stringify(documents)).digest("hex"),
      phase: "prepared" as const,
    };
    if (entry.record !== undefined && !isDeepStrictEqual(entry.record, next)) conflict();
    entry.record = next;
    entry.evidence = documents;
    await recheck(entry);
    await options.workspace.append(entry.record);
    await evidence(entry, true);
    if (entry.working === undefined) {
      const directory = await mkdtemp(
        join(dirname(entry.selected.copy.databasePath), "preparation-"),
      );
      await copyFile(entry.selected.copy.databasePath, join(directory, "venue.db"));
      const copy = { ...entry.selected.copy, databasePath: join(directory, "venue.db") };
      await readRecoveryCopyPreview(copy, entry.selected.sourceId, options.sources);
      entry.working = directory;
    }
    const { node } = readArtifactIdentity(entry.selected.copy.secretEntries);
    entry.preparation = createSelectedRecoveryPreparation({
      ...entry.record.target.target,
      coordinator: options.host.coordinator,
      currentHold: () => scopes.getStore()?.hold,
      modules: options.modules,
      binding: entry.session.binding,
      node,
      secret: entry.request.nodeRecoverySecret,
      selected: entry.session.preview,
      database: () => scopes.getStore()?.db ?? ownerRequired(),
      readRecoveryFacts: async (binding, db) => {
        await recheck(entry);
        await evidence(entry, false);
        const current = await module.operations!.readRecoveryState!(db, node, binding);
        return {
          ...current,
          history: [...current.history, ...Object.values(entry.evidence!)],
          oldMachineAbsent: false,
          oldMachineOffline: entry.request.context.oldBoxGone,
          noParallelRecovery: entry.request.context.soleRecovery,
          contextKey: JSON.stringify([
            binding,
            entry.originalsDigest,
            entry.record!.retainedEvidenceDigest,
            current.country,
            current.taxId,
            current.environment,
            current.bases,
          ]),
        };
      },
    });
    return entry.preparation;
  };
  return {
    async open(
      supplied: BackupRepairOpenRequest,
      _client: OperationClient,
    ): Promise<BackupRepairSession> {
      void _client;
      if (disposed) ownerRequired();
      const request = structuredClone(supplied);
      if (request.source.kind !== "cloud" && request.source.environment !== options.environment)
        throw new AppError("restore.environment_mismatch", {
          backup: request.source.environment,
          target: options.environment,
        });
      if (request.context.oldBoxGone !== true || request.context.soleRecovery !== true)
        throw new AppError("module.operation_invalid", { module: "core" });
      if (request.recoveryId !== undefined) conflict();
      const recoveryId = randomUUID();
      const before = await turn(async () => {
        if (disposed) ownerRequired();
        if (!isDeepStrictEqual(await observation(), request.observation)) conflict();
        if ((await options.workspace.read()).length !== 0) conflict();
        return { digest: await options.workspace.inspect(recoveryId), generation: ++generation };
      });
      // Decrypted copies and key derivation stay outside the retained roots and their action lock.
      const scratch = await mkdtemp(join(tmpdir(), "waitron-backup-proof-"));
      let selected: Selected | undefined;
      let owned = true;
      const discard = async () => {
        try {
          await selected?.copy.discard();
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      };
      try {
        selected = await openFirstSetupBackupSource(
          request.source,
          {
            ...options.sources,
            stateDir: scratch,
            stagingDir: join(scratch, "staging"),
          },
          request.context,
        );
        if (selected.copy.manifest.environment !== options.environment)
          throw new AppError("restore.environment_mismatch", {
            backup: selected.copy.manifest.environment,
            target: options.environment,
          });
        const { node } = readArtifactIdentity(selected.copy.secretEntries);
        const proofBinding: OperationBinding = {
          module: "core",
          action: "restore",
          eventId: randomUUID(),
          sourceId: selected.copy.sourceId!,
          targetNodeId: node.nodeId,
        };
        const provedVerifier = await verifier(selected);
        const sourceDigest = await fingerprint(selected);
        const preview = await authenticatedFirstSetupBackupPreview(
          selected,
          proofBinding,
          request.nodeRecoverySecret,
          options.sources,
        );
        if (preview.fiscalSelection === undefined)
          throw new AppError("module.operation_invalid", { module: "core" });
        const binding = { ...proofBinding, module: preview.fiscalSelection.module };
        return await turn(async () => {
          if (disposed) ownerRequired();
          if (
            generation !== before.generation ||
            !isDeepStrictEqual(await observation(), request.observation) ||
            (await options.workspace.inspect(recoveryId)) !== before.digest ||
            (await fingerprint(selected!)) !== sourceDigest ||
            (await verifier(selected!)) !== provedVerifier ||
            (await options.workspace.read()).length !== 0
          )
            conflict();
          await drop();
          const session = {
            sessionId: randomBytes(32).toString("hex"),
            recoveryId,
            binding,
            preview,
          };
          const entry: Entry = {
            session,
            usedAt: performance.now(),
            discard,
            request,
            selected: selected!,
            originalsDigest: before.digest,
            sourceDigest,
            provedVerifier,
          };
          active = entry;
          touch(entry);
          owned = false;
          return structuredClone(session);
        });
      } finally {
        if (owned) await discard();
      }
    },
    prepare(sessionId: string, supplied: unknown, client: OperationClient): Promise<unknown> {
      const proposal = structuredClone(supplied);
      return turn(async (hold) => {
        const entry = await admitted(sessionId);
        const service = await preparation(entry);
        const store = await openVenueDatabase(entry.working!);
        try {
          const result = await scopes.run({ hold, db: store.venue }, () =>
            service.prepare(proposal, client),
          );
          await recheck(entry);
          if (
            typeof result === "object" &&
            result !== null &&
            "status" in result &&
            result.status === "selected" &&
            "input" in result
          ) {
            const next = { ...entry.record!, input: structuredClone(result.input) };
            await options.workspace.append(next);
            entry.record = next;
          }
          touch(entry);
          return result;
        } finally {
          await store.close();
        }
      });
    },
    close(sessionId: string): Promise<void> {
      return turn(async () => {
        if (active === undefined || active.session.sessionId !== sessionId) ownerRequired();
        if (performance.now() - active.usedAt > UNUSED_MS) {
          await drop();
          ownerRequired();
        }
        await drop();
      });
    },
    dispose(): Promise<void> {
      return options.host.coordinator.run(async () => {
        disposed = true;
        generation++;
        await drop();
      });
    },
  };
}
