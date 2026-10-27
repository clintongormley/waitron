import { AppError, sqliteFailureOf } from "@waitron/shared";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  assertNoLegacyFirstSetupWorkspace,
  createFirstSetupBackupWorkspace,
  emptyAbandonedBackupRecovery,
  firstSetupModuleContext,
  isEmptiedTombstone,
  raiseStartAgainNote,
  readModulePreparationHistory,
  readFirstSetupRecoveryDeliverySnapshot,
  startAgainSummary,
  writeStartAgainConfirmation,
  assertStartAgainAllowedOnDisk,
  clearStartAgainMarker,
  deleteMarkedAttempt,
  firstSetupFrozenDigest,
  markerSize,
  startAgainMarkerFor,
  writeStartAgainMarker,
  START_AGAIN_MARKER_LIMIT,
  attemptLastWriteMs,
  type StartAgainSummary,
  type StartAgainRecoveryShown,
  type StartAgainUnreadable,
  type BackupRepairRecord,
  type RegisterAnswer,
  type FirstSetupState,
} from "@waitron/provisioning";
import {
  initialSetupFor,
  type InitialSetupContribution,
  type WaitronModule,
} from "@waitron/module";
import { readFirstFiscalEvidenceSnapshot } from "./first-fiscal-evidence.js";
import { readFirstFiscalDeliverySnapshot } from "./first-fiscal-delivery.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import type { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { startFailureCode } from "./boot-failure.js";
import { errnoOf } from "./errno.js";
import "./errors.js";
import { firstSetupUnusedAssignment } from "./first-setup-unused-assignment.js";
import { readSeriesPicks, seriesPicksUnreadable } from "./start-again-name-records.js";

export interface StartAgainFirstSetupRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  owner?: FirstSetupOwnerAttempt;
  register?: RegisterAnswer;
  confirmMissingDatabase?: { nothingFiledOrSold: true; shown: StartAgainSummary };
  confirmRecoveryDiscard?: { shown: StartAgainSummary };
  confirmUnreadable?: { shown: StartAgainSummary };
  recoveryRecordDamagedShown?: true;
}
export interface StartAgainSummaryRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  owner?: FirstSetupOwnerAttempt;
}
type Seat = NonNullable<InitialSetupContribution["startAgainFloor"]>;
type UnreadableRecord = StartAgainUnreadable["records"][number];
const PUBLIC_RECORD = "state/module-operation-public.json";
const DOCUMENTS = "state/first-fiscal-documents/";
const UNREADABLE_ORDER: readonly UnreadableRecord[] = [
  "series-picks",
  "public-record",
  "fiscal-documents",
];
function unavailable(): never {
  throw new AppError("setup.not_ready", {});
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function unused(state: FirstSetupState) {
  const attempts = [state, ...state.previous];
  return attempts.every(
    (attempt) =>
      !attempt.consumptionIntent &&
      attempt.result === null &&
      Object.keys(attempt.inputs).length === 0 &&
      attempt.history.every((event) =>
        ["claim", "resume", "recover", "candidates", "checked", "abandoned"].includes(event.kind),
      ),
  );
}
function frozenModuleNames(state: FirstSetupState): string[] {
  return [
    ...new Set(
      [state, ...state.previous].flatMap((attempt) =>
        attempt.frozen.modules.map(({ module }) => module),
      ),
    ),
  ];
}
/** Outside evidence refuses Start again, so only the attempt's own public evidence is read here. */
async function gatherStartAgainFloor(
  roots: FirstSetupRoots,
  state: FirstSetupState,
  originals: readonly { name: string; bytes: Uint8Array | null }[],
  modules: readonly WaitronModule[] | undefined,
  deletion: { discarding?: string },
  recoveryFloor: Floor | null,
  databaseMissing: boolean,
) {
  const attempts = [state, ...state.previous];
  const names = frozenModuleNames(state);
  if (names.length === 0)
    return { floor: recoveryFloor, known: null, recoveryRecordDamaged: false };
  if (modules === undefined) unavailable();
  let recoveryRecordDamaged = false;
  const unreadable = new Set<UnreadableRecord>();
  // Only the database-missing path reads past a damaged public record or documents file; with the
  // database present they keep today's refusals.
  const unreadableRecord = (error: unknown, damaged: boolean, record: UnreadableRecord) => {
    if (!databaseMissing || !damaged || !(error instanceof AppError)) throw error;
    unreadable.add(record);
  };
  const inputs: { module: string; seat: Seat; input: Parameters<Seat>[0] }[] = [];
  for (const module of names) {
    const seat = initialSetupFor(modules, module)?.startAgainFloor;
    if (seat === undefined) continue;
    let publicEvidence: unknown[] = [];
    try {
      publicEvidence = readFirstFiscalEvidenceSnapshot(module, originals);
    } catch (error) {
      unreadableRecord(
        error,
        originals.find((entry) => entry.name === PUBLIC_RECORD)?.bytes != null,
        "public-record",
      );
    }
    const recoveryName = `state/first-fiscal-documents/${module}.recovery.json`;
    let recovery: ReturnType<typeof readFirstSetupRecoveryDeliverySnapshot>;
    let seen = originals;
    try {
      recovery = readFirstSetupRecoveryDeliverySnapshot(module, state, originals, modules);
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        originals.find((entry) => entry.name === recoveryName)?.bytes == null
      )
        throw error;
      // The kept recovery record is the recovery sheet's public statement, which never sets Start
      // again's floor (`isNamelessEvidence`), so one that cannot be read is treated as missing.
      recovery = null;
      recoveryRecordDamaged = true;
      seen = originals.map((entry) =>
        entry.name === recoveryName ? { name: entry.name, bytes: null } : entry,
      );
    }
    let document = recovery?.statement;
    if (document == null)
      try {
        document = await readFirstFiscalDeliverySnapshot(module, state, seen);
      } catch (error) {
        unreadableRecord(
          error,
          seen.some((entry) => entry.name.startsWith(DOCUMENTS) && entry.bytes !== null),
          "fiscal-documents",
        );
      }
    const evidence = [
      ...publicEvidence.map((item) => ({ item, record: "public-record" as const })),
      ...(document === undefined ? [] : [{ item: document, record: "fiscal-documents" as const }]),
    ];
    const usable = !databaseMissing
      ? evidence
      : evidence.filter(({ item, record }) => {
          try {
            seat({ attempts: [], preparations: [], publicEvidence: [item] });
            return true;
          } catch (error) {
            unreadableRecord(error, true, record);
            return false;
          }
        });
    const picks = await readSeriesPicks(roots, module, seat);
    if (picks.unreadable) unreadable.add("series-picks");
    inputs.push({
      module,
      seat,
      input: {
        attempts: attempts
          .filter((attempt) => attempt.frozen.modules.some((entry) => entry.module === module))
          .map((attempt) => ({
            context: firstSetupModuleContext(attempt, module),
            input: attempt.inputs[module],
          })),
        preparations: picks.preparations,
        publicEvidence: usable.map(({ item }) => item),
      },
    });
  }
  const latestOf = (lastWriteMs?: number) => {
    let latest: Floor | null = null;
    for (const { module, seat, input } of inputs) {
      const floor = seat(lastWriteMs === undefined ? input : { ...input, lastWriteMs });
      if (floor !== null && (latest === null || floor.floorMs > latest.floorMs))
        latest = { floorMs: floor.floorMs, lastName: floor.lastName, module };
    }
    return latest;
  };
  const known = latestOf();
  let floor = known;
  if (unreadable.size > 0) {
    const lastWriteMs = await attemptLastWriteMs(roots, deletion).catch((error: unknown) => {
      throw error instanceof AppError
        ? new AppError("setup.not_ready", {}, { reason: error.reason ?? error.code })
        : error;
    });
    if (lastWriteMs === null) unavailable();
    floor = latestOf(lastWriteMs);
  }
  if (recoveryFloor !== null && (floor === null || recoveryFloor.floorMs > floor.floorMs))
    floor = recoveryFloor;
  if (unreadable.size === 0) return { floor, known, recoveryRecordDamaged };
  if (floor === null) unavailable();
  return {
    floor,
    known,
    recoveryRecordDamaged,
    unreadable: {
      records: UNREADABLE_ORDER.filter((record) => unreadable.has(record)),
      floorMs: floor.floorMs,
    },
  };
}
function summaryOf(
  state: FirstSetupState,
  gathered: Awaited<ReturnType<typeof gatherStartAgainFloor>>,
  recovery: StartAgainRecoveryShown | undefined,
): StartAgainSummary {
  const summary = startAgainSummary(state, gathered.known?.lastName ?? null);
  return {
    ...summary,
    ...(gathered.recoveryRecordDamaged && { recoveryRecordDamaged: true as const }),
    ...(recovery !== undefined && { recovery }),
    ...(gathered.unreadable !== undefined && { unreadable: gathered.unreadable }),
  };
}
type BackupRecovery = Pick<
  ReturnType<typeof createFirstSetupBackupRecovery>,
  "liveness" | "runningInMemory" | "sealLapsed" | "discardInTurn"
>;
const STOPPED_PHASES: readonly string[] = ["prepared", "placement-started", "restored"];
/** The attempt statuses Start again accepts with the venue database present. */
const PRESENT_START_AGAIN_STATUSES: readonly string[] = [
  "claimed",
  "consumption-intent",
  "abandoned",
];
type Floor = { floorMs: number; lastName: string | null; module: string };
type FoundRecovery =
  | { kind: "stopped"; id: string; floor: Floor | null; shown: StartAgainRecoveryShown }
  | { kind: "unemptied"; id: string };
export function createFirstSetupResolutionActions(
  options: FirstSetupRoots & {
    host: Pick<FirstFiscalHost, "resolution" | "owner" | "store" | "coordinator"> & {
      evidence: Pick<FirstFiscalHost["evidence"], "invalidate">;
      delivery: Pick<FirstFiscalHost["delivery"], "invalidate">;
    } & Partial<Pick<FirstFiscalHost, "modules">>;
    /** Tests only: replaces each removal of Start again's deletion. */
    remove?: (path: string, kind: "file" | "folder") => Promise<void>;
    /** Tests only: the deletion marker's size limit. */
    markerLimit?: number;
    /** Tests only: replaces the venue lock taken while a discarded recovery is emptied. */
    lock?: Parameters<typeof emptyAbandonedBackupRecovery>[2];
    /**
     * The box's backup recovery. Without it, a journal that is not abandoned is refused by Start
     * again's disk check, and the summary does not look at it.
     */
    backupRecovery?: BackupRecovery;
  },
) {
  const { host } = options;
  const roots = { stateDir: options.stateDir, venueDir: options.venueDir };
  const inProgress = (activity: { startedAt: string; lastActiveAt: string }) =>
    new AppError("setup.recovery_in_progress", {
      startedAt: activity.startedAt,
      lastActiveAt: activity.lastActiveAt,
    });
  /**
   * A running recovery refuses; a lapsed one is sealed first; a stopped one is what the summary
   * names. An abandoned one whose folder was not emptied is named only for Start again to finish.
   */
  const stoppedRecovery = async (): Promise<FoundRecovery | undefined> => {
    const backup = options.backupRecovery;
    if (backup === undefined) return undefined;
    if (!backup.runningInMemory()) backup.sealLapsed();
    const activity = await backup.liveness();
    if (activity?.state === "running") throw inProgress(activity);
    // `liveness()` reads a journal it cannot read as no recovery, so the chain is read here too.
    let records: BackupRepairRecord[];
    try {
      records = await createFirstSetupBackupWorkspace(roots).readChain();
    } catch {
      return unavailable();
    }
    const last = records.at(-1);
    if (activity === null) {
      if (last?.phase !== "abandoned") return undefined;
      const id = last.target.recoveryId;
      return (await isEmptiedTombstone(roots, id).catch(() => false))
        ? undefined
        : { kind: "unemptied", id };
    }
    if (!STOPPED_PHASES.includes(activity.phase) || last?.target.recoveryId !== activity.recoveryId)
      unavailable();
    const module = last.binding.module;
    const seat =
      host.modules === undefined
        ? undefined
        : initialSetupFor(host.modules, module)?.startAgainFloor;
    if (seat === undefined) unavailable();
    const recoveryInputs = records.map((record) => record.input);
    const floor = (preparations: readonly unknown[]) => {
      try {
        return seat({ attempts: [], preparations, publicEvidence: [], recoveryInputs });
      } catch {
        return undefined;
      }
    };
    // One call over both sources, so a later name in the journal wins over an older pick. The
    // module names nothing for an input it cannot read, so a refusal comes from the picks, which
    // are then left out.
    const picks = await readModulePreparationHistory(last.target.target, module).catch(
      () => undefined,
    );
    const named = picks === undefined ? undefined : floor(picks);
    const found = named === undefined ? floor([]) : named;
    // A name reaches the page or a commit only after the journal records its input (`prepare` and
    // `commit` in first-setup-backup-recovery.ts), so with no input and no name in readable picks,
    // no name was used. Picks that cannot be read could hold one.
    if (
      (found ?? null) === null &&
      !(recoveryInputs.every((input) => input === null) && named !== undefined)
    )
      unavailable();
    return {
      kind: "stopped",
      id: activity.recoveryId,
      floor:
        found === undefined || found === null
          ? null
          : { floorMs: found.floorMs, lastName: found.lastName, module },
      shown: {
        startedAt: activity.startedAt,
        lastActiveAt: activity.lastActiveAt,
        lastActiveSource: activity.lastActiveSource,
        lastName: found?.lastName ?? null,
        failed: activity.failed,
        cloud: activity.cloud,
      },
    };
  };
  const assertRecoveredOwner = async (
    owner: FirstSetupOwnerAttempt | undefined,
    state: FirstSetupState,
  ) => {
    if (owner === undefined) throw new AppError("setup.owner_required", {});
    const status = await host.owner.status(owner);
    const latest = [...status.history]
      .reverse()
      .find((event) => ["claim", "resume", "recover"].includes(event.kind));
    if (
      status.revision !== state.revision ||
      latest?.kind !== "recover" ||
      latest.ownerGeneration !== status.ownerGeneration
    )
      throw new AppError("setup.owner_required", {});
  };
  const exactKeys = (request: unknown, keys: readonly string[]) => {
    if (
      typeof request !== "object" ||
      request === null ||
      Object.keys(request).some((key) => !keys.includes(key))
    )
      conflict();
  };
  const matchesInspection = (
    inspection: { inspectionId: string; revision: number | null; ownerGeneration: number | null },
    request: { inspectionId: string; revision: number; ownerGeneration: number },
  ) => {
    if (
      inspection.inspectionId !== request.inspectionId ||
      inspection.revision !== request.revision ||
      inspection.ownerGeneration !== request.ownerGeneration
    )
      conflict();
  };
  return {
    startAgainSummary(request: StartAgainSummaryRequest): Promise<StartAgainSummary> {
      return host.resolution.withVenueExclusion(() =>
        host.coordinator.run(async () => {
          exactKeys(request, ["inspectionId", "revision", "ownerGeneration", "owner"]);
          await assertNoLegacyFirstSetupWorkspace(options);
          const found = await stoppedRecovery();
          const recovery = found?.kind === "stopped" ? found.shown : undefined;
          const inspection = await host.resolution.inspectFirstSetupResolution();
          matchesInspection(inspection, request);
          if (inspection.database !== "missing" && found?.kind === "unemptied") unavailable();
          const presentPicksOnly = inspection.database !== "missing" && found === undefined;
          if (presentPicksOnly) {
            const attempt = await host.store.readForRepair().catch(() => null);
            if (
              attempt === null ||
              host.modules === undefined ||
              !(await seriesPicksUnreadable(roots, host.modules, frozenModuleNames(attempt.state)))
            )
              unavailable();
          }
          const retained = await host.store.readForRepair();
          if (retained === null) unavailable();
          if (
            inspection.database !== "missing" &&
            (inspection.database !== "no-venue-rows" ||
              !PRESENT_START_AGAIN_STATUSES.includes(retained.state.status))
          )
            unavailable();
          await assertRecoveredOwner(request.owner, retained.state);
          const snapshot = await host.resolution.captureFirstSetupOriginals();
          if (snapshot.inspection.inspectionId !== request.inspectionId) conflict();
          const gathered = await gatherStartAgainFloor(
            roots,
            retained.state,
            snapshot.originals,
            host.modules,
            found === undefined ? {} : { discarding: found.id },
            found?.kind === "stopped" ? found.floor : null,
            inspection.database === "missing",
          );
          if (presentPicksOnly && gathered.unreadable === undefined) unavailable();
          return summaryOf(retained.state, gathered, recovery);
        }),
      );
    },
    startAgainFirstSetup(request: StartAgainFirstSetupRequest): Promise<void> {
      return host.resolution.withVenueExclusion(() =>
        host.coordinator.run(async () => {
          exactKeys(request, [
            "inspectionId",
            "revision",
            "ownerGeneration",
            "owner",
            "register",
            "confirmMissingDatabase",
            "confirmRecoveryDiscard",
            "confirmUnreadable",
            "recoveryRecordDamagedShown",
          ]);
          await assertNoLegacyFirstSetupWorkspace(options);
          const found = await stoppedRecovery();
          const recovery = found?.kind === "stopped" ? found.shown : undefined;
          const discarding = found === undefined ? {} : { discarding: found.id };
          const inspection = await host.resolution.inspectFirstSetupResolution();
          matchesInspection(inspection, request);
          const retained = await host.store.readForRepair();
          if (retained === null) unavailable();
          const { state } = retained;
          const missing = inspection.database === "missing";
          if (!missing && request.confirmMissingDatabase !== undefined) conflict();
          if (missing && request.recoveryRecordDamagedShown !== undefined) conflict();
          const discardsStopped = !missing && found?.kind === "stopped";
          if (!discardsStopped && request.confirmRecoveryDiscard !== undefined) conflict();
          if (
            request.confirmUnreadable !== undefined &&
            (missing || request.confirmRecoveryDiscard !== undefined)
          )
            conflict();
          if (missing) {
            // D3a: with the database missing, any status but complete, and only once confirmed.
            if (state.status === "complete" || request.confirmMissingDatabase === undefined)
              unavailable();
          } else if (!PRESENT_START_AGAIN_STATUSES.includes(state.status)) unavailable();
          if (!["no-venue-rows", "missing"].includes(inspection.database)) unavailable();
          const noOtherHistory = inspection.artifacts.every(
            (artifact) =>
              ["first-setup.json", "first-setup-claim.json", "venue.db", "venue.db-wal"].includes(
                artifact.name,
              ) ||
              (!artifact.name.startsWith("outside-") && artifact.status === "missing"),
          );
          const emptyWorkspace = inspection.emptyDatabase && unused(state) && noOtherHistory;
          const snapshot = await host.resolution.captureFirstSetupOriginals();
          if (snapshot.inspection.inspectionId !== request.inspectionId) conflict();
          const assignment =
            inspection.emptyDatabase &&
            (request.register === undefined || request.register.kind === "current-master") &&
            host.modules !== undefined &&
            ((request.register === undefined && emptyWorkspace) ||
              (await firstSetupUnusedAssignment(state, snapshot.originals, host.modules)));
          const unusedAssignment = Boolean(assignment);
          const recoveryRecordDamaged =
            !missing && typeof assignment === "object" && assignment.recoveryRecordDamaged;
          if (request.owner === undefined) {
            if (
              !unusedAssignment &&
              (!emptyWorkspace ||
                request.register?.kind !== "no-current-master" ||
                request.register?.confirmed !== true)
            )
              unavailable();
          } else {
            await assertRecoveredOwner(request.owner, state);
            if (request.register?.kind === "no-current-master" && !emptyWorkspace) unavailable();
            if (inspection.database !== "missing" && !emptyWorkspace && !unusedAssignment)
              unavailable();
          }
          if (inspection.artifacts.some((artifact) => artifact.name.startsWith("outside-")))
            unavailable();
          const box = await assertStartAgainAllowedOnDisk(roots, discarding);
          const markerFor = async (markerOptions: { discarding?: string }) => {
            const marker = await startAgainMarkerFor(
              box,
              { attemptId: state.frozen.attemptId, frozenDigest: firstSetupFrozenDigest(state) },
              markerOptions,
            ).catch((error: unknown) => {
              throw error instanceof AppError && error.code === "setup.start_again_incomplete"
                ? new AppError("setup.not_ready", {}, { reason: error.reason ?? error.code })
                : error;
            });
            if (markerSize(marker) > (options.markerLimit ?? START_AGAIN_MARKER_LIMIT))
              unavailable();
            return marker;
          };
          let marker = await markerFor(discarding);
          const picksDamaged =
            !missing &&
            host.modules !== undefined &&
            (await seriesPicksUnreadable(roots, host.modules, frozenModuleNames(state)));
          if (
            (recoveryRecordDamaged || discardsStopped || picksDamaged) &&
            request.owner === undefined
          )
            throw new AppError(
              "setup.start_again_password_required",
              picksDamaged ? { seriesPicksUnreadable: true } : {},
            );
          if (discardsStopped && request.confirmRecoveryDiscard === undefined) conflict();
          if (recoveryRecordDamaged !== (request.recoveryRecordDamagedShown === true)) conflict();
          const gathered = await gatherStartAgainFloor(
            roots,
            state,
            snapshot.originals,
            host.modules,
            discarding,
            found?.kind === "stopped" ? found.floor : null,
            missing,
          );
          const { floor } = gathered;
          // An unemptied journal's confirmation record was written by the Start again that
          // abandoned it.
          const finishing = found?.kind === "unemptied";
          const presentUnreadable =
            !missing && !discardsStopped && gathered.unreadable !== undefined;
          // With the database present, no summary is shown while an abandoned journal is being
          // finished, so nothing confirms a damaged name record on that path.
          if (finishing && presentUnreadable) throw new AppError("setup.attempt_invalid", {});
          if (presentUnreadable !== (request.confirmUnreadable !== undefined)) conflict();
          const confirmation = request.confirmMissingDatabase;
          const shown =
            missing || discardsStopped || presentUnreadable
              ? summaryOf(state, gathered, recovery)
              : undefined;
          if (
            missing &&
            (confirmation?.nothingFiledOrSold !== true ||
              !isDeepStrictEqual(confirmation.shown, shown))
          )
            conflict();
          if (discardsStopped && !isDeepStrictEqual(request.confirmRecoveryDiscard?.shown, shown))
            conflict();
          if (presentUnreadable && !isDeepStrictEqual(request.confirmUnreadable?.shown, shown))
            conflict();
          const backup = options.backupRecovery;
          const refuseRunning = async (): Promise<never> => {
            const activity = await backup!.liveness();
            if (activity === null) unavailable();
            throw inProgress(activity);
          };
          // No await between this check and the first write: the record and the note change the
          // recovery's originals, so an open that began during the checks could never resume it.
          if (found !== undefined && backup!.runningInMemory()) await refuseRunning();
          if ((missing || discardsStopped || presentUnreadable) && !finishing) {
            const { displayName, email } = state.frozen.request.admin;
            await writeStartAgainConfirmation(box.stateDir, {
              at: new Date().toISOString(),
              attemptId: state.frozen.attemptId,
              database: missing ? "missing" : "present",
              administrator: { displayName, email },
              ownerGeneration: state.ownerGeneration,
              shown: shown!,
            });
          }
          if (floor !== null) await raiseStartAgainNote(box.stateDir, floor);
          if (found !== undefined) {
            // No await between this check and the seal: an open that began during the writes
            // above would otherwise be sealed while it runs.
            if (backup!.runningInMemory()) await refuseRunning();
            backup!.sealLapsed();
            const { recordedAt } = await createFirstSetupBackupWorkspace(box).abandon(found.id);
            await backup!.discardInTurn(found.id, recordedAt);
            await emptyAbandonedBackupRecovery(box, found.id, options.lock).catch(
              async (error: unknown) => {
                if (error instanceof AppError) throw error;
                const path = join(
                  box.stateDir,
                  "first-setup-resolutions",
                  "backup-recovery",
                  found.id,
                );
                const code = await startFailureCode(error, [box.venueDir, box.stateDir]);
                const errcode = sqliteFailureOf(error)?.errcode;
                const reason = [
                  "emptying failed:",
                  code,
                  errnoOf(error),
                  errcode === undefined ? undefined : `errcode ${errcode}`,
                  path,
                ];
                throw new AppError(
                  "setup.start_again_incomplete",
                  {},
                  { reason: reason.filter((part) => part !== undefined).join(" ") },
                );
              },
            );
            await assertStartAgainAllowedOnDisk(box);
            marker = await markerFor({});
          }
          await writeStartAgainMarker(box, marker);
          try {
            await deleteMarkedAttempt(box, marker, options.remove);
            await clearStartAgainMarker(box.venueDir);
          } finally {
            host.owner.invalidate(state.frozen.attemptId);
            host.evidence.invalidate(state.frozen.attemptId);
            host.delivery.invalidate(state.frozen.attemptId);
          }
        }),
      );
    },
  };
}
