import { AppError } from "@waitron/shared";
import { isDeepStrictEqual } from "node:util";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  assertNoLegacyFirstSetupWorkspace,
  createFirstSetupBackupWorkspace,
  firstSetupModuleContext,
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
  type StartAgainSummary,
  type StartAgainRecoveryShown,
  type BackupRepairRecord,
  type RegisterAnswer,
  type FirstSetupState,
} from "@waitron/provisioning";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import { readFirstFiscalEvidenceSnapshot } from "./first-fiscal-evidence.js";
import { readFirstFiscalDeliverySnapshot } from "./first-fiscal-delivery.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import type { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import "./errors.js";
import { firstSetupUnusedAssignment } from "./first-setup-unused-assignment.js";

export interface StartAgainFirstSetupRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  owner?: FirstSetupOwnerAttempt;
  register?: RegisterAnswer;
  confirmMissingDatabase?: { nothingFiledOrSold: true; shown: StartAgainSummary };
  recoveryRecordDamagedShown?: true;
}
export interface StartAgainSummaryRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  owner?: FirstSetupOwnerAttempt;
}
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
/** Outside evidence refuses Start again, so only the attempt's own public evidence is read here. */
async function gatherStartAgainFloor(
  roots: FirstSetupRoots,
  state: FirstSetupState,
  originals: readonly { name: string; bytes: Uint8Array | null }[],
  modules: readonly WaitronModule[] | undefined,
) {
  const attempts = [state, ...state.previous];
  const names = [
    ...new Set(attempts.flatMap((attempt) => attempt.frozen.modules.map(({ module }) => module))),
  ];
  if (names.length === 0) return { floor: null, recoveryRecordDamaged: false };
  if (modules === undefined) unavailable();
  let latest: { floorMs: number; lastName: string; module: string } | null = null;
  let recoveryRecordDamaged = false;
  for (const module of names) {
    const seat = initialSetupFor(modules, module)?.startAgainFloor;
    if (seat === undefined) continue;
    const publicEvidence = readFirstFiscalEvidenceSnapshot(module, originals);
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
      // Every other reader here still refuses.
      recovery = null;
      recoveryRecordDamaged = true;
      seen = originals.map((entry) =>
        entry.name === recoveryName ? { name: entry.name, bytes: null } : entry,
      );
    }
    const document =
      recovery?.statement ?? (await readFirstFiscalDeliverySnapshot(module, state, seen));
    if (document !== undefined) publicEvidence.push(document);
    const floor = seat({
      attempts: attempts
        .filter((attempt) => attempt.frozen.modules.some((entry) => entry.module === module))
        .map((attempt) => ({
          context: firstSetupModuleContext(attempt, module),
          input: attempt.inputs[module],
        })),
      preparations: await readModulePreparationHistory(roots, module),
      publicEvidence,
    });
    if (floor !== null && (latest === null || floor.floorMs > latest.floorMs))
      latest = { floorMs: floor.floorMs, lastName: floor.lastName, module };
  }
  return { floor: latest, recoveryRecordDamaged };
}
function summaryOf(
  state: FirstSetupState,
  gathered: Awaited<ReturnType<typeof gatherStartAgainFloor>>,
  recovery: StartAgainRecoveryShown | undefined,
): StartAgainSummary {
  const summary = startAgainSummary(state, gathered.floor?.lastName ?? null);
  return {
    ...summary,
    ...(gathered.recoveryRecordDamaged && { recoveryRecordDamaged: true as const }),
    ...(recovery !== undefined && { recovery }),
  };
}
type BackupRecovery = Pick<
  ReturnType<typeof createFirstSetupBackupRecovery>,
  "liveness" | "runningInMemory" | "sealLapsed" | "discardInTurn"
>;
const STOPPED_PHASES: readonly string[] = ["prepared", "placement-started", "restored"];
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
    /**
     * The box's backup recovery. Without it, a journal that is not abandoned is refused by Start
     * again's disk check, and the summary does not look at it.
     */
    backupRecovery?: BackupRecovery;
  },
) {
  const { host } = options;
  const roots = { stateDir: options.stateDir, venueDir: options.venueDir };
  /** A running recovery refuses; a lapsed one is sealed first; a stopped one is what the summary names. */
  const stoppedRecovery = async (): Promise<StartAgainRecoveryShown | undefined> => {
    const backup = options.backupRecovery;
    if (backup === undefined) return undefined;
    if (!backup.runningInMemory()) backup.sealLapsed();
    const activity = await backup.liveness();
    if (activity?.state === "running")
      throw new AppError("setup.recovery_in_progress", {
        startedAt: activity.startedAt,
        lastActiveAt: activity.lastActiveAt,
      });
    // `liveness()` reads a journal it cannot read as no recovery, so the chain is read here too.
    let records: BackupRepairRecord[];
    try {
      records = await createFirstSetupBackupWorkspace(roots).readChain();
    } catch {
      return unavailable();
    }
    const last = records.at(-1);
    if (activity === null) return undefined;
    if (!STOPPED_PHASES.includes(activity.phase) || last?.target.recoveryId !== activity.recoveryId)
      unavailable();
    const module = last.binding.module;
    const seat =
      host.modules === undefined
        ? undefined
        : initialSetupFor(host.modules, module)?.startAgainFloor;
    if (seat === undefined) unavailable();
    const picksPath = join(last.target.target.stateDir, "module-preparation-state.json");
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
    const picks = await readModulePreparationHistory(last.target.target, module).catch(() => []);
    const named = floor(picks);
    const lastName = (named === undefined ? floor([]) : named)?.lastName ?? null;
    // A chosen name is written to the copy's picks before the journal records its input, and reaches
    // the page or a commit only after that record (`prepare` and `commit` in
    // first-setup-backup-recovery.ts), so with neither, no name was taken.
    if (
      lastName === null &&
      !(
        recoveryInputs.every((input) => input === null) &&
        (await lstat(picksPath).then(
          () => false,
          (error: NodeJS.ErrnoException) => error.code === "ENOENT",
        ))
      )
    )
      unavailable();
    return {
      startedAt: activity.startedAt,
      lastActiveAt: activity.lastActiveAt,
      lastActiveSource: activity.lastActiveSource,
      lastName,
      failed: activity.failed,
      cloud: activity.cloud,
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
          const recovery = await stoppedRecovery();
          const inspection = await host.resolution.inspectFirstSetupResolution();
          matchesInspection(inspection, request);
          if (inspection.database !== "missing") unavailable();
          const retained = await host.store.readForRepair();
          if (retained === null) unavailable();
          await assertRecoveredOwner(request.owner, retained.state);
          const snapshot = await host.resolution.captureFirstSetupOriginals();
          if (snapshot.inspection.inspectionId !== request.inspectionId) conflict();
          const gathered = await gatherStartAgainFloor(
            roots,
            retained.state,
            snapshot.originals,
            host.modules,
          );
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
            "recoveryRecordDamagedShown",
          ]);
          await assertNoLegacyFirstSetupWorkspace(options);
          const recovery = await stoppedRecovery();
          const inspection = await host.resolution.inspectFirstSetupResolution();
          matchesInspection(inspection, request);
          const retained = await host.store.readForRepair();
          if (retained === null) unavailable();
          const { state } = retained;
          const missing = inspection.database === "missing";
          if (!missing && request.confirmMissingDatabase !== undefined) conflict();
          if (missing && request.recoveryRecordDamagedShown !== undefined) conflict();
          if (missing) {
            // D3a: with the database missing, any status but complete, and only once confirmed.
            if (state.status === "complete" || request.confirmMissingDatabase === undefined)
              unavailable();
          } else if (!["claimed", "consumption-intent", "abandoned"].includes(state.status))
            unavailable();
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
          const box = await assertStartAgainAllowedOnDisk(roots);
          const marker = await startAgainMarkerFor(box, {
            attemptId: state.frozen.attemptId,
            frozenDigest: firstSetupFrozenDigest(state),
          }).catch((error: unknown) => {
            throw error instanceof AppError && error.code === "setup.start_again_incomplete"
              ? new AppError("setup.not_ready", {}, { reason: error.reason ?? error.code })
              : error;
          });
          if (markerSize(marker) > (options.markerLimit ?? START_AGAIN_MARKER_LIMIT)) unavailable();
          if (recoveryRecordDamaged && request.owner === undefined)
            throw new AppError("setup.start_again_password_required", {});
          if (recoveryRecordDamaged !== (request.recoveryRecordDamagedShown === true)) conflict();
          const gathered = await gatherStartAgainFloor(
            roots,
            state,
            snapshot.originals,
            host.modules,
          );
          const floor = gathered.floor;
          const confirmation = request.confirmMissingDatabase;
          if (missing) {
            const shown = summaryOf(state, gathered, recovery);
            if (
              confirmation?.nothingFiledOrSold !== true ||
              !isDeepStrictEqual(confirmation.shown, shown)
            )
              conflict();
            const { displayName, email } = state.frozen.request.admin;
            await writeStartAgainConfirmation(box.stateDir, {
              at: new Date().toISOString(),
              attemptId: state.frozen.attemptId,
              database: "missing",
              administrator: { displayName, email },
              ownerGeneration: state.ownerGeneration,
              shown,
            });
          }
          if (floor !== null) await raiseStartAgainNote(box.stateDir, floor);
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
