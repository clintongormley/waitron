import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  openVenueDatabase,
  withTransaction,
  lockVenueDatabase,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { readRecoveryKeyName, readRecoveryKeyVerifier } from "@waitron/node-db";
import type { OperationBinding, OperationClient, WaitronModule } from "@waitron/module";
import {
  assertNoStartAgainDeletion,
  canonicalFirstSetupDirectory,
  canonicalFirstSetupRoots,
  isEmptiedTombstone,
  readDurableHostJson,
  writeDurableHostJson,
  type FirstSetupHold,
  type BackupRepairRecord,
  type BackupRepairObservation,
  type FirstSetupRoots,
  createFirstSetupBackupWorkspace,
} from "@waitron/provisioning";
import { AppError, isAppError } from "@waitron/shared";
import { NODE_FILE } from "@waitron/store";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { createCloudRecoveryClient, type CloudRecoveryOptions } from "./cloud-recovery.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import {
  authenticatedFirstSetupBackupPreview,
  openFirstSetupBackupSource,
  type BackupRepairSource,
  type BackupRepairSourceDeps,
} from "./first-setup-backup-source.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import {
  assertStagedNodeCopy,
  copyStagedCopy,
  openStagedCopy,
  readArtifactNode,
  resolveArtifactNode,
  writeStagedNodeCopy,
  writeValidated,
  restoreFromArtifact,
} from "./restore.js";
import {
  readCloudRecoveryState,
  readSnapshotRecoveryBinding,
  assertSnapshotRecoveryTarget,
  type SavedCloudRecoveryState,
} from "./cloud-recovery-v2.js";
import { currentBackupVerificationTarget } from "./backup-verification-target.js";
import { refuseIfArchiveSourceLive } from "./restore-stream.js";
import { readRecoveryCopyPreview } from "./recovery-backup-preview.js";
import { readFirstSetupBackupHistory } from "./first-setup-backup-history.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import {
  persistBackupRepairPublication,
  readBackupRepairPublication,
  openBackupRepairPublication,
} from "./first-setup-backup-publication.js";
import "./errors.js";

export interface BackupRepairOptions extends FirstSetupRoots {
  environment: DeploymentEnvironment;
  modules: readonly WaitronModule[];
  host: FirstFiscalHost;
  sources: BackupRepairSourceDeps;
  workspace: ReturnType<typeof createFirstSetupBackupWorkspace>;
  log: Logger;
  cloud?: Omit<CloudRecoveryOptions, "stateDir">;
}
export interface BackupRepairOpenRequest {
  observation: Omit<BackupRepairObservation, "originalsDigest">;
  source: BackupRepairSource;
  nodeRecoverySecret: string;
  context: { oldBoxGone: boolean; soleRecovery: boolean };
  recoveryId?: string;
}
export type BackupRepairResumeRequest = Omit<BackupRepairOpenRequest, "source" | "recoveryId"> & {
  recoveryId: string;
};
export interface BackupRepairSession {
  sessionId: string;
  recoveryId: string;
  preview: RecoveryBackupPreview;
  binding: OperationBinding;
  input?: unknown;
}
export interface BackupRepairResumeSession extends BackupRepairSession {
  input: unknown;
}
const UNUSED_MS = 15 * 60_000;
// Owner decision 1 (A1042, 14:38): a recovery runs while an open or a step is in flight, or for 5
// minutes after its last renewal or step. A lapsed session comes back on A's next renewal or step
// until something relies on it being stopped and seals it; a failure is final at once.
const LEASE_MS = 5 * 60_000;
export type BackupRepairActivity =
  | { state: "running"; startedAt: string; lastActiveAt: string }
  | {
      state: "stopped";
      startedAt: string;
      lastActiveSource: "memory" | "saved-step";
      lastActiveAt: string;
      phase: BackupRepairRecord["phase"];
      recoveryId: string;
      failed: boolean;
      cloud: boolean;
    };
type Selected = Awaited<ReturnType<typeof openFirstSetupBackupSource>>;
function cloudIdentity(state: SavedCloudRecoveryState) {
  const { phase, ...identity } = state;
  void phase;
  return identity;
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function ownerRequired(): never {
  throw new AppError("setup.owner_required", {});
}
async function fingerprint(selected: Selected): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(selected.copy.databasePath)) hash.update(bytes);
  assertStagedNodeCopy(dirname(selected.copy.databasePath));
  for await (const bytes of createReadStream(join(dirname(selected.copy.databasePath), NODE_FILE)))
    hash.update(bytes);
  hash.update(JSON.stringify([selected.sourceId, selected.copy.sourceId, selected.copy.manifest]));
  hash.update(JSON.stringify(["node.dump", selected.copy.nodeDump.byteLength]));
  hash.update(selected.copy.nodeDump);
  for (const entry of selected.copy.secretEntries) {
    hash.update(JSON.stringify([entry.name, entry.bytes.byteLength]));
    hash.update(entry.bytes);
  }
  return hash.digest("hex");
}
async function verifier(selected: Selected): Promise<string | null> {
  const node = await readArtifactNode(selected.copy);
  const db = await openStagedCopy(dirname(selected.copy.databasePath));
  try {
    return await readRecoveryKeyVerifier(db.node, node.nodeId);
  } finally {
    await db.close();
  }
}
export function createFirstSetupBackupRecovery(options: BackupRepairOptions) {
  let generation = 0;
  let disposed = false;
  const openings = new Map<Promise<void>, string>();
  let disposal: Promise<void> | undefined;
  const opening = () => {
    let finish!: () => void;
    const pending = new Promise<void>((done) => {
      finish = done;
    });
    openings.set(pending, new Date().toISOString());
    return () => {
      openings.delete(pending);
      finish();
    };
  };
  type Entry = {
    session: BackupRepairSession;
    usedAt: number;
    startedAt: string;
    lastActiveAt: string;
    lastActiveMono: number;
    failed?: { at: string };
    sealed?: { at: string };
    discard(): Promise<void>;
    request: BackupRepairOpenRequest | BackupRepairResumeRequest;
    resumed?: boolean;
    sourceReopened?: boolean;
    publicationDigest?: string;
    rebuildSource?: "archive" | "stream";
    cloudState?: SavedCloudRecoveryState;
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
  let recent: Entry | undefined;
  // A step runs inside the turn, and the fence seals outside it, so a step in flight must read as running.
  const steps = new Set<{ entry: Entry }>();
  const lease = () => {
    const at = new Date().toISOString();
    return { startedAt: at, lastActiveAt: at, lastActiveMono: performance.now() };
  };
  const refresh = (entry: Entry) => {
    entry.lastActiveMono = performance.now();
    entry.lastActiveAt = new Date().toISOString();
  };
  // A Cloud wait holds no session, so each tab holds it under a holder id it makes itself. Only a
  // seal makes a recovery id's wait final (owner decision 1, A1042).
  type CloudWait = {
    startedAt: string;
    lastActiveAt: string;
    holders: Map<string, number>;
    sealed?: { at: string };
  };
  const cloudWaits = new Map<string, CloudWait>();
  const cloudWait = () =>
    pendingCloudId === undefined ? undefined : cloudWaits.get(pendingCloudId);
  const held = (renewedMono: number) => performance.now() - renewedMono <= LEASE_MS;
  const cloudLeased = () => {
    const wait = cloudWait();
    return (
      !disposed && wait?.sealed === undefined && [...(wait?.holders.values() ?? [])].some(held)
    );
  };
  // A wait is made only while no journal exists, so a journal written before a restart gets none,
  // and it leases only while the recovery has not started placing.
  const holdCloud = (
    id: string,
    record: BackupRepairRecord | undefined,
    holder: string | undefined,
  ) => {
    let wait = cloudWaits.get(id);
    if (wait === undefined) {
      if (record !== undefined) return;
      const { startedAt, lastActiveAt } = lease();
      wait = { startedAt, lastActiveAt, holders: new Map() };
      cloudWaits.set(id, wait);
    }
    if (
      wait.sealed !== undefined ||
      holder === undefined ||
      (record !== undefined && record.phase !== "prepared")
    )
      return;
    wait.holders.set(holder, performance.now());
    retiredHolders.delete(holder);
    wait.lastActiveAt = new Date().toISOString();
  };
  const handOver = (recoveryId: string) => cloudWaits.get(recoveryId)?.holders.clear();
  // The latest record, when it is `abandoned`, as last read or as a discard gave it: a renewal
  // has no turn to read it in.
  let tombstone: { recoveryId: string; at: string } | undefined;
  // Only a caller that belonged to the discarded recovery is told it was discarded. A Cloud holder
  // is known only in memory; a session id carries a hash binding it to its recovery, so it still
  // matches after a restart.
  const retiredHolders = new Map<string, string>();
  const sessionTag = (recoveryId: string, nonce: string) =>
    createHash("sha256").update(`${recoveryId}\0${nonce}`).digest("hex").slice(0, 32);
  const newSessionId = (recoveryId: string) => {
    const nonce = randomBytes(16).toString("hex");
    return nonce + sessionTag(recoveryId, nonce);
  };
  const observe = (last: BackupRepairRecord | undefined) => {
    tombstone =
      last?.phase === "abandoned"
        ? { recoveryId: last.target.recoveryId, at: last.recordedAt }
        : undefined;
    if (last !== undefined && tombstone === undefined) retiredHolders.clear();
    return tombstone;
  };
  // An unreadable journal leaves the refusal the caller would give anyway.
  const readTombstone = () =>
    options.workspace.read().then(
      (records) => observe(records.at(-1)),
      () => undefined,
    );
  const discarded = (found: { at: string } | undefined) => {
    if (found !== undefined)
      throw new AppError("setup.recovery_discarded", { discardedAt: found.at });
  };
  const refuseDiscarded = async (recoveryId: string) => {
    const found = await readTombstone();
    if (found?.recoveryId === recoveryId) discarded(found);
  };
  const refuseDiscardedSession = (sessionId: string, found = tombstone) => {
    if (
      found !== undefined &&
      sessionId.slice(32) === sessionTag(found.recoveryId, sessionId.slice(0, 32))
    )
      discarded(found);
  };
  // A Cloud call can wait 30 s for Cloud before it takes its lease, so it reads as running meanwhile.
  const cloudCalls = new Map<object, string>();
  const cloudCall = <T>(run: () => Promise<T>) =>
    turn(async () => {
      const call = {};
      cloudCalls.set(call, new Date().toISOString());
      try {
        return await run();
      } finally {
        cloudCalls.delete(call);
      }
    });
  const fail = (entry: Entry) => {
    entry.failed ??= { at: new Date().toISOString() };
    // A failure is final at once, so no later Check may revive the failed recovery's wait.
    const wait = cloudWaits.get(entry.session.recoveryId);
    if (wait !== undefined) wait.sealed ??= entry.failed;
  };
  const live = (entry: Entry | undefined): entry is Entry =>
    entry !== undefined &&
    !disposed &&
    active === entry &&
    entry.failed === undefined &&
    entry.sealed === undefined &&
    performance.now() - entry.usedAt <= UNUSED_MS;
  const leased = (entry: Entry | undefined): boolean =>
    live(entry) && performance.now() - entry.lastActiveMono <= LEASE_MS;
  const inFlight = (entry: Entry) => [...steps].some((step) => step.entry === entry);
  const enter = (sessionId: string) => {
    const entry = active;
    if (
      disposed ||
      entry === undefined ||
      entry.session.sessionId !== sessionId ||
      entry.failed !== undefined ||
      entry.sealed !== undefined
    )
      return undefined;
    const step = { entry };
    steps.add(step);
    refresh(entry);
    return step;
  };
  const leave = (step: { entry: Entry } | undefined) => {
    if (step === undefined) return;
    steps.delete(step);
    if (step.entry.failed === undefined) refresh(step.entry);
  };
  const runningInMemory = () =>
    openings.size > 0 ||
    cloudCalls.size > 0 ||
    steps.size > 0 ||
    (active !== undefined && leased(active)) ||
    cloudLeased();
  let pendingCloudId: string | undefined;
  const cloudScratch: string[] = [];
  const clouds = new Map<
    string,
    { client: ReturnType<typeof createCloudRecoveryClient>; stateDir: string }
  >();
  const cloudFor = async (id: string) => {
    if (options.cloud === undefined) throw new AppError("setup.not_ready", {});
    let cloud = clouds.get(id);
    if (cloud === undefined) {
      const stateDir = join(
        await canonicalFirstSetupDirectory(options.stateDir),
        "first-setup-resolutions",
        "backup-recovery",
        id,
        "cloud",
      );
      cloud = { stateDir, client: createCloudRecoveryClient({ ...options.cloud, stateDir }) };
      clouds.set(id, cloud);
    }
    return cloud;
  };
  const scratchCloud = async (id: string) => {
    if (clouds.has(id)) return;
    if (options.cloud === undefined) throw new AppError("setup.not_ready", {});
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-repair-cloud-"));
    cloudScratch.push(stateDir);
    clouds.set(id, { stateDir, client: createCloudRecoveryClient({ ...options.cloud, stateDir }) });
  };
  // A seal bars only its id's wait. With no journal, a Start, Start again or open that succeeds
  // moves the sealed id's Cloud client, and with it the Cloud request, to a new id with a new wait,
  // so an approval Cloud already granted is kept. Check never moves it.
  const pendingSealed = () =>
    pendingCloudId !== undefined && cloudWaits.get(pendingCloudId)?.sealed !== undefined;
  const takeOver = (sealed: string, id: string = randomUUID()) => {
    const cloud = clouds.get(sealed);
    if (cloud !== undefined) clouds.set(id, cloud);
    clouds.delete(sealed);
    pendingCloudId = id;
    const { startedAt, lastActiveAt } = lease();
    cloudWaits.set(id, { startedAt, lastActiveAt, holders: new Map() });
    return id;
  };
  const saveCloud = async (entry: Entry, destination: string) => {
    const cloud = await cloudFor(entry.session.recoveryId);
    const state = await readCloudRecoveryState(cloud.stateDir);
    if (state === undefined || !isDeepStrictEqual(state, entry.cloudState)) conflict();
    const previous = await readCloudRecoveryState(destination);
    if (previous !== undefined && !isDeepStrictEqual(cloudIdentity(previous), cloudIdentity(state)))
      conflict();
    await writeDurableHostJson(join(destination, "cloud-recovery.json"), state, 65536);
  };
  const admitCloud = async (entry: Entry) => {
    const state = entry.cloudState;
    if (state === undefined) return;
    const targetState = await readCloudRecoveryState(entry.record!.target.target.stateDir);
    if (
      targetState === undefined ||
      !isDeepStrictEqual(cloudIdentity(state), cloudIdentity(targetState))
    )
      conflict();
    if (state.version === 2) {
      if (state.snapshotVerification?.archiveSha256 !== entry.record!.activationSourceId)
        conflict();
      const snapshot = await readSnapshotRecoveryBinding(entry.record!.target.target.stateDir, {
        managedCloud: { requestId: state.requestId, pointId: state.pointId! },
        snapshotVerification: state.snapshotVerification,
      });
      if (snapshot?.publicKey !== state.publicKey) conflict();
      assertSnapshotRecoveryTarget(snapshot.verification, currentBackupVerificationTarget());
    }
  };
  const scopes = new AsyncLocalStorage<{
    hold: FirstSetupHold;
    db: Database;
    nodeDb: NodeDatabase;
    placing?: true;
  }>();
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
    await refuseDiscarded(entry.session.recoveryId);
    await assertNoStartAgainDeletion(options.venueDir);
    // The session's observation and digests never change, so a refusal here would repeat on every step.
    const refuse = (): never => {
      fail(entry);
      return conflict();
    };
    if (
      !isDeepStrictEqual(await observation(), entry.request.observation) ||
      (await options.workspace.inspect(entry.session.recoveryId)) !== entry.originalsDigest ||
      (await fingerprint(entry.selected)) !== entry.sourceDigest ||
      (await verifier(entry.selected)) !== entry.provedVerifier
    )
      refuse();
    if (
      entry.publicationDigest !== undefined &&
      (await readBackupRepairPublication(entry.record!)).digest !== entry.publicationDigest
    )
      refuse();
    if (entry.preparation !== undefined || entry.resumed) {
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
        refuse();
    }
    if (
      entry.cloudState !== undefined &&
      !isDeepStrictEqual(
        await readCloudRecoveryState((await cloudFor(entry.session.recoveryId)).stateDir),
        entry.cloudState,
      )
    )
      refuse();
  };
  // A failed session is refused by `unfailed`, after the step's own journal and phase checks.
  const admitted = async (sessionId: string) => {
    if (
      active === undefined ||
      active.session.sessionId !== sessionId ||
      active.sealed !== undefined
    ) {
      refuseDiscardedSession(sessionId, await readTombstone());
      ownerRequired();
    }
    const entry = active;
    await recheck(entry);
    if (entry.failed === undefined) touch(entry);
    return entry;
  };
  const unfailed = (entry: Entry) => {
    if (entry.failed !== undefined) ownerRequired();
  };
  // A seal deletes the copy under a failed session's checks, so what they then throw is the seal's doing.
  const sealedUnder = (entry: Entry | undefined, error: unknown): never => {
    if (entry?.sealed !== undefined && !isAppError(error)) ownerRequired();
    throw error;
  };
  const existingTarget = async (record: NonNullable<Entry["record"]>) => {
    for (const directory of Object.values(record.target.target))
      if ((await canonicalFirstSetupDirectory(directory)) !== directory) conflict();
    const info = await lstat(join(record.target.target.venueDir, "venue.db")).catch(() =>
      conflict(),
    );
    if (!info.isFile() || info.isSymbolicLink()) conflict();
  };
  const emptyTarget = async (
    record: NonNullable<Entry["record"]>,
    cloud?: SavedCloudRecoveryState,
  ) => {
    for (const directory of Object.values(record.target.target))
      if ((await canonicalFirstSetupDirectory(directory)) !== directory) conflict();
    const allowedVenue = new Set([
      "venue.lock",
      "venue.lock-journal",
      "venue.holder.json",
      "venue.holder.json.partial",
      "first-setup-resolutions",
    ]);
    if ((await readdir(record.target.target.venueDir)).some((name) => !allowedVenue.has(name)))
      conflict();
    const allowedState = new Set([
      "module-preparation-state.json",
      "module-evidence",
      "first-setup-resolutions",
    ]);
    if (cloud !== undefined) {
      const current = await readCloudRecoveryState(record.target.target.stateDir);
      if (current !== undefined && !isDeepStrictEqual(cloudIdentity(current), cloudIdentity(cloud)))
        conflict();
      allowedState.add("cloud-recovery.json");
    }
    if ((await readdir(record.target.target.stateDir)).some((name) => !allowedState.has(name)))
      conflict();
  };
  const evidence = async (
    entry: Entry,
    allowMissing: boolean,
    restoreTarget = false,
    checkTarget = true,
  ) => {
    const stateDir = entry.record!.target.target.stateDir;
    const retainedPath = join(dirname(dirname(stateDir)), "retained-evidence.json");
    const retained = await readDurableHostJson(retainedPath, 1024 * 1024);
    if (
      createHash("sha256").update(JSON.stringify(entry.evidence)).digest("hex") !==
      entry.record!.retainedEvidenceDigest
    )
      conflict();
    if (retained === null && allowMissing)
      await writeDurableHostJson(retainedPath, entry.evidence, 1024 * 1024);
    else if (!isDeepStrictEqual(retained, entry.evidence)) conflict();
    if (!checkTarget) return;
    for (const [name, value] of Object.entries(entry.evidence!)) {
      const path = join(stateDir, "module-evidence", entry.session.binding.module, `${name}.json`);
      const current = await readDurableHostJson(path, 1024 * 1024);
      if ((current === null && allowMissing) || restoreTarget)
        await writeDurableHostJson(path, value, 1024 * 1024);
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
    const anchor = await canonicalFirstSetupRoots(options);
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
        source: anchor,
        target: { stateDir: join(base, "state"), venueDir: join(base, "venue") },
        generation: 1,
      },
      observation: { ...entry.request.observation, originalsDigest: entry.originalsDigest },
      sourceId: entry.selected.sourceId,
      activationSourceId: entry.selected.copy.sourceId!,
      binding: entry.session.binding,
      input: entry.record?.input ?? null,
      retainedEvidenceDigest: createHash("sha256").update(JSON.stringify(documents)).digest("hex"),
      phase: entry.record?.phase ?? ("prepared" as const),
    };
    if (entry.record !== undefined && !isDeepStrictEqual(entry.record, next)) conflict();
    entry.record = next;
    entry.evidence = documents;
    await recheck(entry);
    await options.workspace.append(entry.record);
    if (entry.cloudState !== undefined) {
      const cloudDir = join(dirname(dirname(entry.record.target.target.stateDir)), "cloud");
      await saveCloud(entry, cloudDir);
      clouds.set(entry.session.recoveryId, {
        stateDir: cloudDir,
        client: createCloudRecoveryClient({ ...options.cloud!, stateDir: cloudDir }),
      });
    }
    await evidence(entry, true);
    if (entry.working === undefined) {
      const directory = await mkdtemp(
        join(dirname(entry.selected.copy.databasePath), "preparation-"),
      );
      const copy = {
        ...entry.selected.copy,
        databasePath: await copyStagedCopy(entry.selected.copy, directory),
      };
      await readRecoveryCopyPreview(copy, entry.selected.sourceId, options.sources);
      entry.working = directory;
    }
    return buildPreparation(entry);
  };
  const buildPreparation = async (entry: Entry) => {
    const module = options.host.modules.find(
      (module) => module.name === entry.session.binding.module,
    );
    if (module?.operations?.readRecoveryState === undefined)
      throw new AppError("module.operation_invalid", { module: entry.session.binding.module });
    const node = await readArtifactNode(entry.selected.copy);
    entry.preparation = createSelectedRecoveryPreparation({
      ...entry.record!.target.target,
      coordinator: options.host.coordinator,
      currentHold: () => scopes.getStore()?.hold,
      modules: options.modules,
      binding: entry.session.binding,
      node,
      secret: entry.request.nodeRecoverySecret,
      selected: entry.session.preview,
      database: () => scopes.getStore()?.db ?? ownerRequired(),
      nodeDatabase: () => scopes.getStore()?.nodeDb ?? ownerRequired(),
      readRecoveryFacts: async (binding, db) => {
        await recheck(entry);
        if (entry.sourceReopened && scopes.getStore()?.placing !== true)
          await emptyTarget(entry.record!, entry.cloudState);
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
  // A discarded recovery reads as none, and its Cloud approval is never used again. Until it is
  // emptied a new one is refused, as the workspace would; status still offers Start again.
  const liveRecords = async (starting = true) => {
    const records = await options.workspace.read(),
      last = records.at(-1);
    observe(last);
    if (last?.phase !== "abandoned") return records;
    if (
      starting &&
      !(await isEmptiedTombstone(
        { venueDir: options.venueDir, stateDir: options.stateDir },
        last.target.recoveryId,
      ))
    )
      throw new AppError("setup.start_again_incomplete", {});
    if (pendingCloudId === last.target.recoveryId) {
      clouds.delete(pendingCloudId);
      pendingCloudId = undefined;
    }
    return [];
  };
  return {
    status() {
      return turn(async () => {
        if (disposed) ownerRequired();
        try {
          const record = (await liveRecords(false)).at(-1);
          return record === undefined
            ? { phase: "unstarted" as const, proofRequired: true }
            : { phase: record.phase, recoveryId: record.target.recoveryId, proofRequired: true };
        } catch {
          return { phase: "uncertain" as const, proofRequired: true };
        }
      });
    },
    cloudStart(holder?: string) {
      return cloudCall(async () => {
        if (disposed) ownerRequired();
        if (active !== undefined) conflict();
        const record = (await liveRecords()).at(-1);
        if (record !== undefined) {
          const directory = dirname(dirname(record.target.target.stateDir));
          if (
            record.phase !== "prepared" ||
            record.input !== null ||
            (await readCloudRecoveryState(join(directory, "cloud"))) !== undefined ||
            (await readDurableHostJson(join(directory, "publication.json"), 32 * 1024 * 1024)) !==
              null
          )
            conflict();
          pendingCloudId = record.target.recoveryId;
          clouds.delete(pendingCloudId);
        }
        const sealed = record === undefined && pendingSealed();
        pendingCloudId ??= randomUUID();
        await scratchCloud(pendingCloudId);
        generation++;
        const id = pendingCloudId;
        const answer = await (await cloudFor(id)).client.start();
        holdCloud(sealed ? takeOver(id) : id, record, holder);
        return answer;
      });
    },
    cloudStatus(holder?: string) {
      return cloudCall(async () => {
        if (disposed) ownerRequired();
        if (active !== undefined) conflict();
        const record = (await liveRecords()).at(-1);
        pendingCloudId ??= record?.target.recoveryId;
        if (pendingCloudId === undefined) conflict();
        const id = pendingCloudId;
        const answer = await (await cloudFor(id)).client.status();
        holdCloud(id, record, holder);
        return answer;
      });
    },
    cloudStartAgain(holder?: string) {
      return cloudCall(async () => {
        if (disposed) ownerRequired();
        if (active !== undefined) conflict();
        const record = (await liveRecords()).at(-1);
        if (pendingCloudId === undefined) conflict();
        if (
          record !== undefined &&
          (record.phase !== "prepared" ||
            (await readDurableHostJson(
              join(dirname(dirname(record.target.target.stateDir)), "publication.json"),
              32 * 1024 * 1024,
            )) !== null)
        )
          conflict();
        const sealed = record === undefined && pendingSealed();
        generation++;
        const id = pendingCloudId;
        const answer = await (await cloudFor(id)).client.startAgain();
        holdCloud(sealed ? takeOver(id) : id, record, holder);
        return answer;
      });
    },
    async open(
      supplied: BackupRepairOpenRequest,
      _client: OperationClient,
    ): Promise<BackupRepairSession> {
      const finish = opening();
      try {
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
        const before = await turn(async () => {
          if (disposed) ownerRequired();
          if (request.recoveryId !== undefined) await refuseDiscarded(request.recoveryId);
          await assertNoStartAgainDeletion(options.venueDir);
          if (!isDeepStrictEqual(await observation(), request.observation)) conflict();
          const records = await liveRecords();
          const record = records.at(-1);
          const sealedId =
            request.recoveryId === undefined && request.source.kind === "cloud" && pendingSealed()
              ? pendingCloudId
              : undefined;
          const recoveryId =
            request.recoveryId ??
            (request.source.kind === "cloud" && sealedId === undefined
              ? pendingCloudId
              : undefined) ??
            randomUUID();
          if (
            request.recoveryId === undefined
              ? records.length !== 0
              : record === undefined ||
                record.target.recoveryId !== recoveryId ||
                !["prepared", "placement-started"].includes(record.phase) ||
                !isDeepStrictEqual(request.observation, {
                  inspectionId: record.observation.inspectionId,
                  revision: record.observation.revision,
                  ownerGeneration: record.observation.ownerGeneration,
                })
          )
            conflict();
          const digest = await options.workspace.inspect(recoveryId);
          if (record !== undefined && digest !== record.observation.originalsDigest) conflict();
          return { digest, generation: ++generation, record, recoveryId, sealedId };
        });
        const { recoveryId, sealedId } = before;
        const cloudId = sealedId ?? recoveryId;
        // A Start since the first turn may have moved the sealed id's client to a new id.
        const cloudClient = async () => {
          if (sealedId !== undefined && !clouds.has(sealedId)) conflict();
          return (await cloudFor(cloudId)).client;
        };
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
              ...(request.source.kind === "cloud"
                ? {
                    cloudRecovery: options.cloud === undefined ? undefined : await cloudClient(),
                  }
                : {}),
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
          const node = await readArtifactNode(selected.copy);
          if (
            before.record !== undefined &&
            (selected.sourceId !== before.record.sourceId ||
              selected.copy.sourceId !== before.record.activationSourceId)
          )
            conflict();
          const proofBinding: OperationBinding = before.record?.binding ?? {
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
          if (before.record !== undefined && !isDeepStrictEqual(binding, before.record.binding))
            conflict();
          return await turn(async () => {
            if (disposed) ownerRequired();
            await refuseDiscarded(recoveryId);
            if (
              generation !== before.generation ||
              !isDeepStrictEqual(await observation(), request.observation) ||
              (await options.workspace.inspect(recoveryId)) !== before.digest ||
              (await fingerprint(selected!)) !== sourceDigest ||
              (await verifier(selected!)) !== provedVerifier ||
              !isDeepStrictEqual((await liveRecords()).at(-1), before.record)
            )
              conflict();
            await drop();
            const session = {
              sessionId: newSessionId(recoveryId),
              recoveryId,
              binding,
              preview,
              ...(before.record === undefined
                ? {}
                : { input: structuredClone(before.record.input) }),
            };
            const entry: Entry = {
              session,
              usedAt: performance.now(),
              ...lease(),
              discard,
              request,
              selected: selected!,
              originalsDigest: before.digest,
              sourceDigest,
              provedVerifier,
              ...(request.source.kind === "cloud"
                ? {
                    cloudState: await readCloudRecoveryState((await cloudFor(cloudId)).stateDir),
                  }
                : {}),
            };
            active = entry;
            recent = entry;
            try {
              if (before.record !== undefined) {
                const { version, sequence, previousRecordDigest, recordedAt, ...record } =
                  before.record;
                void version;
                void sequence;
                void previousRecordDigest;
                void recordedAt;
                entry.record = record;
                entry.sourceReopened = true;
                await emptyTarget(record, entry.cloudState);
                await preparation(entry);
                const path = join(
                  dirname(dirname(record.target.target.stateDir)),
                  "publication.json",
                );
                if (
                  await lstat(path).then(
                    () => true,
                    (error: unknown) => {
                      if (
                        typeof error === "object" &&
                        error !== null &&
                        "code" in error &&
                        error.code === "ENOENT"
                      )
                        return false;
                      throw new AppError("setup.attempt_uncertain", {});
                    },
                  )
                ) {
                  const saved = await readBackupRepairPublication(record);
                  const published = await openBackupRepairPublication(
                    record,
                    saved.ciphertext,
                    request.nodeRecoverySecret,
                    entry.selected.copy.databasePath,
                    {
                      ...options.sources,
                      environment: options.environment,
                      stateDir: join(scratch, "publication-state"),
                      stagingDir: join(scratch, "publication-staging"),
                    },
                  );
                  if (!isDeepStrictEqual(published.preview, session.preview)) conflict();
                  entry.publicationDigest = saved.digest;
                }
                await recheck(entry);
              }
              refresh(entry);
              touch(entry);
              if (sealedId !== undefined) takeOver(sealedId, recoveryId);
              handOver(recoveryId);
              owned = false;
              return structuredClone(session);
            } catch (error) {
              await drop();
              throw error;
            }
          });
        } finally {
          if (owned) await discard();
        }
      } finally {
        finish();
      }
    },
    async resume(
      supplied: BackupRepairResumeRequest,
      _client: OperationClient,
    ): Promise<BackupRepairResumeSession> {
      const finish = opening();
      try {
        void _client;
        const request = structuredClone(supplied);
        if (disposed) ownerRequired();
        if (request.context.oldBoxGone !== true || request.context.soleRecovery !== true)
          throw new AppError("module.operation_invalid", { module: "core" });
        const scratch = await mkdtemp(join(tmpdir(), "waitron-backup-proof-"));
        let owned = true;
        const discard = () => rm(scratch, { recursive: true, force: true });
        try {
          const before = await turn(async () => {
            if (disposed) ownerRequired();
            await assertNoStartAgainDeletion(options.venueDir);
            const record = (await options.workspace.read()).at(-1);
            if (
              record === undefined ||
              record.target.recoveryId !== request.recoveryId ||
              !["placement-started", "restored"].includes(record.phase) ||
              !isDeepStrictEqual(await observation(), request.observation) ||
              !isDeepStrictEqual(request.observation, {
                inspectionId: record.observation.inspectionId,
                revision: record.observation.revision,
                ownerGeneration: record.observation.ownerGeneration,
              })
            )
              conflict();
            const material = await readBackupRepairPublication(record);
            await existingTarget(record);
            const lock = await lockVenueDatabase(record.target.target.venueDir);
            try {
              const target = await openVenueDatabase(record.target.target.venueDir);
              try {
                await target.venue.archiveTo(join(scratch, "venue.db"));
              } finally {
                await target.close();
              }
            } finally {
              lock.release();
            }
            return { record, material, generation: ++generation };
          });
          const selected = await openBackupRepairPublication(
            before.record,
            before.material.ciphertext,
            request.nodeRecoverySecret,
            join(scratch, "venue.db"),
            {
              ...options.sources,
              environment: options.environment,
              stateDir: join(scratch, "state"),
              stagingDir: join(scratch, "staging"),
            },
          );
          await writeStagedNodeCopy(selected.copy.databasePath, selected.copy.nodeDump);
          const node = await readArtifactNode(selected.copy);
          const assertCommitted = options.modules.find(
            (module) => module.name === before.record.binding.module,
          )?.backup?.assertRestoreCommitted;
          if (assertCommitted === undefined)
            throw new AppError("module.operation_invalid", {
              module: before.record.binding.module,
            });
          const source = { copy: selected.copy, sourceId: before.record.sourceId };
          if (selected.kind === "cloud") {
            const cloud = await cloudFor(request.recoveryId);
            const binding = await cloud.client.binding();
            if (
              !isDeepStrictEqual(binding, {
                requestId: selected.cloudState?.requestId,
                pointId: selected.cloudState?.pointId,
              })
            )
              conflict();
          }
          const cloudState =
            selected.kind === "cloud"
              ? await readCloudRecoveryState((await cloudFor(request.recoveryId)).stateDir)
              : undefined;
          if (
            selected.kind === "cloud" &&
            (cloudState === undefined ||
              selected.cloudState === undefined ||
              !isDeepStrictEqual(cloudIdentity(cloudState), cloudIdentity(selected.cloudState)))
          )
            conflict();
          const proved = await authenticatedFirstSetupBackupPreview(
            source,
            before.record.binding,
            request.nodeRecoverySecret,
            options.sources,
          );
          if (
            proved.nodeRecoveryKeyName !== selected.preview.nodeRecoveryKeyName ||
            proved.nodeId !== selected.preview.nodeId ||
            !isDeepStrictEqual(proved.taxpayer, selected.preview.taxpayer)
          )
            conflict();
          const database = await openStagedCopy(scratch);
          try {
            await withTransaction(database.venue, (tx) =>
              assertCommitted(tx, node, before.record.binding),
            );
          } finally {
            await database.close();
          }
          const sourceDigest = await fingerprint(source);
          const provedVerifier = await verifier(source);
          const publicEvidence = await readDurableHostJson(
            join(dirname(dirname(before.record.target.target.stateDir)), "retained-evidence.json"),
            1024 * 1024,
          );
          if (
            publicEvidence === null ||
            createHash("sha256").update(JSON.stringify(publicEvidence)).digest("hex") !==
              before.record.retainedEvidenceDigest
          )
            conflict();
          return await turn(async () => {
            if (disposed) ownerRequired();
            if (
              generation !== before.generation ||
              !isDeepStrictEqual((await options.workspace.read()).at(-1), before.record) ||
              !isDeepStrictEqual(await observation(), request.observation) ||
              (await readBackupRepairPublication(before.record)).digest !== before.material.digest
            )
              conflict();
            await existingTarget(before.record);
            const target = await openVenueDatabase(before.record.target.target.venueDir);
            try {
              if ((await readRecoveryKeyVerifier(target.node, node.nodeId)) !== provedVerifier)
                conflict();
              await withTransaction(target.venue, (tx) =>
                assertCommitted(tx, node, before.record.binding),
              );
            } finally {
              await target.close();
            }
            await drop();
            const { version, sequence, previousRecordDigest, recordedAt, ...record } =
              before.record;
            void version;
            void sequence;
            void previousRecordDigest;
            void recordedAt;
            const session = {
              sessionId: newSessionId(request.recoveryId),
              recoveryId: request.recoveryId,
              preview: selected.preview,
              binding: record.binding,
              input: structuredClone(record.input),
            };
            const entry: Entry = {
              session,
              usedAt: performance.now(),
              ...lease(),
              request,
              selected: source,
              originalsDigest: record.observation.originalsDigest,
              sourceDigest,
              provedVerifier,
              discard,
              working: scratch,
              record,
              evidence: publicEvidence as Record<string, unknown>,
              resumed: true,
              rebuildSource: selected.kind === "cloud" ? "archive" : selected.kind,
              ...(cloudState === undefined ? {} : { cloudState }),
              publicationDigest: before.material.digest,
            };
            active = entry;
            recent = entry;
            await admitCloud(entry);
            await buildPreparation(entry);
            await recheck(entry);
            refresh(entry);
            touch(entry);
            handOver(request.recoveryId);
            owned = false;
            return structuredClone(session);
          });
        } catch (error) {
          // A discard empties the files a resume reads between its turns.
          await refuseDiscarded(request.recoveryId);
          if (isAppError(error)) throw error;
          throw new AppError("setup.attempt_uncertain", {});
        } finally {
          if (owned) await discard();
        }
      } finally {
        finish();
      }
    },
    prepare(sessionId: string, supplied: unknown, client: OperationClient): Promise<unknown> {
      const proposal = structuredClone(supplied);
      return turn(async (hold) => {
        const step = enter(sessionId);
        const own = active?.session.sessionId === sessionId ? active : undefined;
        try {
          const entry = await admitted(sessionId);
          if (
            (entry.publicationDigest !== undefined && !entry.sourceReopened) ||
            (entry.record !== undefined &&
              entry.record.phase !== "prepared" &&
              !(entry.sourceReopened && entry.record.phase === "placement-started"))
          )
            conflict();
          unfailed(entry);
          const service = await preparation(entry);
          const store = await openVenueDatabase(entry.working!);
          try {
            const result = await scopes.run({ hold, db: store.venue, nodeDb: store.node }, () =>
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
              if (
                entry.publicationDigest !== undefined &&
                !isDeepStrictEqual(result.input, entry.record!.input)
              )
                conflict();
              const next = { ...entry.record!, input: structuredClone(result.input) };
              await options.workspace.append(next);
              entry.record = next;
            }
            touch(entry);
            return result;
          } finally {
            await store.close();
          }
        } catch (error) {
          return sealedUnder(own, error);
        } finally {
          leave(step);
        }
      });
    },
    commit(sessionId: string, supplied: unknown, _client: OperationClient): Promise<void> {
      const input = structuredClone(supplied);
      void _client;
      return turn(async (hold) => {
        const step = enter(sessionId);
        const own = active?.session.sessionId === sessionId ? active : undefined;
        let begun = false;
        try {
          const entry = await admitted(sessionId);
          if (
            entry.preparation === undefined ||
            entry.record === undefined ||
            (entry.resumed
              ? !["placement-started", "restored"].includes(entry.record.phase)
              : entry.record.phase !== "prepared" &&
                !(entry.sourceReopened && entry.record.phase === "placement-started")) ||
            entry.record.input === null ||
            !isDeepStrictEqual(entry.record.input, input)
          )
            conflict();
          unfailed(entry);
          const assertCommitted = options.modules.find(
            (module) => module.name === entry.session.binding.module,
          )?.backup?.assertRestoreCommitted;
          if (assertCommitted === undefined)
            throw new AppError("module.operation_invalid", {
              module: entry.session.binding.module,
            });
          begun = true;
          await evidence(entry, false, false, !entry.resumed);
          const target = entry.record.target.target;
          if (!entry.resumed) {
            await emptyTarget(entry.record, entry.cloudState);
            await refuseIfArchiveSourceLive({
              validated: entry.selected.copy,
              stateDir: target.stateDir,
              oldBoxGone: entry.request.context.oldBoxGone,
              now: options.sources.bucket.now,
              openStore: options.sources.bucket.openStore,
            });
            await recheck(entry);
            entry.rebuildSource =
              "source" in entry.request && entry.request.source.kind === "bucket"
                ? "stream"
                : "archive";
            const material = await persistBackupRepairPublication(
              entry.record,
              entry.cloudState === undefined
                ? entry.selected.copy
                : {
                    ...entry.selected.copy,
                    secretEntries: entry.selected.copy.secretEntries.filter(
                      (item) => item.name !== "secrets/backup.env",
                    ),
                  },
              entry.session.preview,
              entry.request.nodeRecoverySecret,
              entry.cloudState === undefined ? entry.rebuildSource : "cloud",
              entry.cloudState,
            );
            entry.publicationDigest = material.digest;
            await recheck(entry);
            if (entry.record.phase !== "placement-started") {
              const started = { ...entry.record, phase: "placement-started" as const };
              await options.workspace.append(started);
              entry.record = started;
            }
          } else {
            await admitCloud(entry);
            await existingTarget(entry.record);
            const current = await openVenueDatabase(target.venueDir);
            try {
              if (
                (await readRecoveryKeyVerifier(
                  current.node,
                  entry.session.binding.targetNodeId,
                )) !== entry.provedVerifier ||
                (await readRecoveryKeyName(current.node, entry.session.binding.targetNodeId)) !==
                  entry.session.preview.nodeRecoveryKeyName
              )
                conflict();
              await withTransaction(current.venue, async (tx) =>
                assertCommitted(
                  tx,
                  await resolveArtifactNode(tx, entry.selected.copy.secretEntries),
                  entry.session.binding,
                ),
              );
            } finally {
              await current.close();
            }
            if (entry.cloudState === undefined) await evidence(entry, false, true);
          }
          const store = await openVenueDatabase(entry.working!);
          try {
            await scopes.run(
              { hold, db: store.venue, nodeDb: store.node, placing: true },
              async () => {
                const runner = entry.preparation!.runner(
                  input,
                  entry.resumed ? undefined : { refresh: true },
                );
                const check = runner.checkBeforePlacement;
                runner.checkBeforePlacement = async (context) => {
                  if (!entry.resumed) await emptyTarget(entry.record!, entry.cloudState);
                  await check?.(context);
                };
                const placement = {
                  ...target,
                  stagingDir: dirname(entry.selected.copy.databasePath),
                  modules: options.modules,
                  migrationsRoot: options.sources.migrationsRoot,
                  environment: options.environment,
                  log: options.log,
                  rebuildSource: entry.rebuildSource,
                  withModuleOperations: runner,
                  ...(entry.resumed ? { resumeOperation: entry.session.binding } : {}),
                };
                if (entry.cloudState !== undefined && !entry.resumed) {
                  const cloud = await cloudFor(entry.session.recoveryId);
                  await cloud.client.restore(async (request) => {
                    if (!isDeepStrictEqual(request, entry.selected.cloudRequest)) conflict();
                    await recheck(entry);
                    await saveCloud(entry, target.stateDir);
                    const checkTarget = runner.checkBeforePlacement;
                    runner.checkBeforePlacement = async (context) => {
                      await saveCloud(entry, target.stateDir);
                      await checkTarget?.(context);
                    };
                    await restoreFromArtifact({
                      ...placement,
                      ...request,
                      snapshotRequestKey: entry.cloudState!.publicKey,
                    });
                  }, entry.cloudState.pointId!);
                  entry.cloudState = { ...entry.cloudState, phase: "staged" };
                } else if (entry.cloudState === undefined)
                  await writeValidated(entry.selected.copy, placement);
                if (entry.cloudState !== undefined) {
                  const cloud = await cloudFor(entry.session.recoveryId);
                  await cloud.client.reconcileRestored(
                    { requestId: entry.cloudState.requestId, pointId: entry.cloudState.pointId! },
                    async () => {
                      await admitCloud(entry);
                      if (entry.resumed) {
                        await evidence(entry, false, true);
                        await writeValidated(entry.selected.copy, placement);
                      }
                      const db = await openVenueDatabase(target.venueDir);
                      try {
                        await withTransaction(db.venue, async (tx) =>
                          assertCommitted(
                            tx,
                            await resolveArtifactNode(tx, entry.selected.copy.secretEntries),
                            entry.session.binding,
                          ),
                        );
                      } finally {
                        await db.close();
                      }
                    },
                  );
                  entry.cloudState = {
                    ...entry.cloudState,
                    phase: entry.cloudState.phase === "reported" ? "reported" : "restored",
                  };
                  await saveCloud(entry, target.stateDir);
                }
              },
            );
          } finally {
            await store.close();
          }
          const placed = await openVenueDatabase(target.venueDir);
          try {
            await withTransaction(placed.venue, async (tx) =>
              assertCommitted(
                tx,
                await resolveArtifactNode(tx, entry.selected.copy.secretEntries),
                entry.session.binding,
              ),
            );
          } finally {
            await placed.close();
          }
          await recheck(entry);
          // Core publishes backup secrets after activation; carry-forward must follow that publication.
          await evidence(entry, false, true);
          const restored =
            entry.record.phase === "restored"
              ? (await options.workspace.read()).at(-1)!
              : await options.workspace.append({ ...entry.record, phase: "restored" });
          entry.record = { ...entry.record, phase: "restored" };
          await options.workspace.select(restored);
          if (entry.cloudState !== undefined) {
            const cloud = await cloudFor(entry.session.recoveryId);
            try {
              await cloud.client.reportRestored();
              entry.cloudState = { ...entry.cloudState, phase: "reported" };
              await saveCloud(entry, target.stateDir);
            } catch {
              options.log("warn", "cloud.recovery_report_pending", {});
            }
          }
          await drop();
          for (const directory of cloudScratch.splice(0))
            await rm(directory, { recursive: true, force: true });
        } catch (error) {
          if (
            step !== undefined &&
            begun &&
            ["placement-started", "restored"].includes(step.entry.record?.phase ?? "")
          )
            fail(step.entry);
          sealedUnder(own, error);
        } finally {
          leave(step);
        }
      });
    },
    close(sessionId: string): Promise<void> {
      return turn(async () => {
        if (active === undefined || active.session.sessionId !== sessionId) {
          refuseDiscardedSession(sessionId, await readTombstone());
          ownerRequired();
        }
        if (performance.now() - active.usedAt > UNUSED_MS) {
          await drop();
          ownerRequired();
        }
        await drop();
      });
    },
    renew(sessionId: string): void {
      const entry = active;
      if (entry === undefined || entry.session.sessionId !== sessionId)
        refuseDiscardedSession(sessionId);
      if (entry === undefined || entry.session.sessionId !== sessionId || !live(entry))
        ownerRequired();
      refresh(entry);
      touch(entry);
    },
    cloudRenew(holder: string): void {
      const wait = cloudWait();
      const renewed = wait?.holders.get(holder);
      if (
        !disposed &&
        renewed === undefined &&
        tombstone !== undefined &&
        retiredHolders.get(holder) === tombstone.recoveryId
      )
        discarded(tombstone);
      if (disposed || wait?.sealed !== undefined || renewed === undefined || !held(renewed))
        ownerRequired();
      wait!.holders.set(holder, performance.now());
      wait!.lastActiveAt = new Date().toISOString();
    },
    cloudRelease(holder: string): void {
      for (const wait of cloudWaits.values()) wait.holders.delete(holder);
    },
    sealLapsed(): void {
      if (openings.size > 0 || cloudCalls.size > 0) return;
      const entry = active;
      if (entry !== undefined) {
        if (inFlight(entry) || leased(entry)) return;
        // drop() deletes the selected copy, which an open or a step in flight would still be reading.
        entry.sealed = { at: new Date().toISOString() };
        void drop().catch(() => {});
      }
      if (pendingCloudId === undefined || runningInMemory()) return;
      const at = new Date().toISOString();
      const wait: CloudWait = cloudWaits.get(pendingCloudId) ?? {
        startedAt: at,
        lastActiveAt: at,
        holders: new Map(),
      };
      wait.sealed ??= { at };
      cloudWaits.set(pendingCloudId, wait);
    },
    // Runs inside the caller's turn; `discardedAt` is the `abandoned` record's `recordedAt`.
    async discardInTurn(recoveryId: string, discardedAt: string): Promise<void> {
      generation++;
      if (active?.session.recoveryId === recoveryId) await drop();
      if (pendingCloudId === recoveryId) pendingCloudId = undefined;
      clouds.delete(recoveryId);
      for (const holder of cloudWaits.get(recoveryId)?.holders.keys() ?? [])
        retiredHolders.set(holder, recoveryId);
      cloudWaits.delete(recoveryId);
      tombstone = { recoveryId, at: discardedAt };
    },
    runningInMemory,
    /** When false, `sealLapsed` does nothing and `runningInMemory` answers false. */
    holdsInMemory: (): boolean =>
      runningInMemory() || active !== undefined || pendingCloudId !== undefined,
    async liveness(): Promise<BackupRepairActivity | null> {
      if (runningInMemory()) {
        const entry = [...steps][0]?.entry ?? (leased(active) ? active : undefined);
        const opened = [...openings.values()][0];
        const wait = cloudLeased() ? cloudWait() : undefined;
        const calling = [...cloudCalls.values()][0];
        return {
          state: "running",
          startedAt: entry?.startedAt ?? opened ?? wait?.startedAt ?? calling!,
          lastActiveAt: entry?.lastActiveAt ?? opened ?? wait?.lastActiveAt ?? calling!,
        };
      }
      let records: BackupRepairRecord[];
      try {
        records = await options.workspace.readChain();
      } catch {
        return null;
      }
      const last = records.at(-1);
      if (last === undefined || last.phase === "abandoned") return null;
      const recoveryId = last.target.recoveryId;
      const memory = recent?.session.recoveryId === recoveryId ? recent : undefined;
      const cloud =
        memory?.cloudState !== undefined ||
        (await lstat(
          join(dirname(dirname(last.target.target.stateDir)), "cloud", "cloud-recovery.json"),
        ).then(
          () => true,
          () => false,
        ));
      return {
        state: "stopped",
        startedAt: memory?.startedAt ?? records[0]!.recordedAt,
        lastActiveSource: memory === undefined ? "saved-step" : "memory",
        lastActiveAt: memory?.lastActiveAt ?? last.recordedAt,
        phase: last.phase,
        recoveryId,
        failed: memory?.failed !== undefined,
        cloud,
      };
    },
    dispose(): Promise<void> {
      disposal ??= (async () => {
        await options.host.coordinator.run(async () => {
          disposed = true;
          generation++;
          await drop();
        });
        await Promise.all([...openings.keys()]);
        await options.host.coordinator.run(async () => {
          for (const directory of cloudScratch.splice(0))
            await rm(directory, { recursive: true, force: true });
        });
      })();
      return disposal;
    },
  };
}
