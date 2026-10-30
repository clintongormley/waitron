import { AppError, sqliteFailureOf } from "@waitron/shared";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  assertNoLegacyFirstSetupWorkspace,
  createFirstSetupBackupWorkspace,
  emptyAbandonedBackupRecovery,
  isEmptiedTombstone,
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
  type FirstSetupInspection,
  type FirstSetupState,
} from "@waitron/provisioning";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import type { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { startFailureCode } from "./boot-failure.js";
import { errnoOf } from "./errno.js";
import "./errors.js";
import { firstSetupUnusedAssignment } from "./first-setup-unused-assignment.js";
import {
  readSetupDatabaseHoldings,
  type SetupDatabaseHoldings,
} from "./first-setup-database-holdings.js";

export interface StartAgainFirstSetupRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  register?: RegisterAnswer;
  confirmMissingDatabase?: { nothingFiledOrSold: true; shown: StartAgainSummary };
  confirmRecoveryDiscard?: { shown: StartAgainSummary };
  recoveryRecordDamagedShown?: true;
}
export interface StartAgainSummaryRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
}
function unavailable(): never {
  throw new AppError("setup.not_ready", {});
}
function refused(
  cause: "setup-finished" | "kept-records" | "trading-settings",
  reason?: string,
): never {
  throw new AppError(
    "setup.start_again_refused",
    { cause },
    reason === undefined ? {} : { reason },
  );
}
/** Counts only, for the log: the answer carries the cause alone. */
function assertNoKeptRecords({ rows, kept, records, accepted }: SetupDatabaseHoldings): void {
  if (kept > 0 || records > 0)
    refused("kept-records", `rows=${rows} kept=${kept} records=${records} accepted=${accepted}`);
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
/** The held state's refusals, in this order. */
function assertHeldStartAgainOffered(
  inspection: Pick<FirstSetupInspection, "database" | "emptyDatabase" | "artifacts">,
  found: FoundRecovery | undefined,
  status: FirstSetupState["status"],
): void {
  const holdsRecords =
    inspection.database === "occupied" ||
    (inspection.database === "no-venue-rows" && !inspection.emptyDatabase);
  if (found?.kind !== "stopped" || !holdsRecords) unavailable();
  if (
    inspection.artifacts.find((artifact) => artifact.name === "trading.env")?.status !== "missing"
  )
    refused("trading-settings");
  if (status === "complete") refused("setup-finished");
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
/** A kept recovery record that cannot be read is treated as missing, and shown as damaged. */
function recoveryRecordDamagedOf(
  state: FirstSetupState,
  originals: readonly { name: string; bytes: Uint8Array | null }[],
  modules: readonly WaitronModule[] | undefined,
): boolean {
  const names = frozenModuleNames(state);
  if (names.length === 0) return false;
  if (modules === undefined) unavailable();
  let damaged = false;
  for (const module of names) {
    // Before the read: a module the box lacks is refused here, never read as a damaged record.
    if (initialSetupFor(modules, module)?.recoveryDocument === undefined) continue;
    try {
      readFirstSetupRecoveryDeliverySnapshot(module, state, originals, modules);
    } catch (error) {
      const recoveryName = `state/first-fiscal-documents/${module}.recovery.json`;
      if (
        !(error instanceof AppError) ||
        originals.find((entry) => entry.name === recoveryName)?.bytes == null
      )
        throw error;
      damaged = true;
    }
  }
  return damaged;
}
/** Start again's test of the attempt with the venue database present and not held. */
async function presentAttemptEligibility(
  inspection: Pick<FirstSetupInspection, "emptyDatabase" | "artifacts">,
  state: FirstSetupState,
  originals: Parameters<typeof firstSetupUnusedAssignment>[1],
  modules: readonly WaitronModule[] | undefined,
  register: RegisterAnswer | undefined,
) {
  const noOtherHistory = inspection.artifacts.every(
    (artifact) =>
      ["first-setup.json", "first-setup-claim.json", "venue.db", "venue.db-wal"].includes(
        artifact.name,
      ) ||
      (!artifact.name.startsWith("outside-") && artifact.status === "missing"),
  );
  const emptyWorkspace = inspection.emptyDatabase && unused(state) && noOtherHistory;
  const assignment =
    inspection.emptyDatabase &&
    (register === undefined || register.kind === "current-master") &&
    modules !== undefined &&
    ((register === undefined && emptyWorkspace) ||
      (await firstSetupUnusedAssignment(state, originals, modules)));
  return { emptyWorkspace, assignment, eligible: emptyWorkspace || Boolean(assignment) };
}
function summaryOf(
  state: FirstSetupState,
  recoveryRecordDamaged: boolean,
  recovery: StartAgainRecoveryShown | undefined,
): StartAgainSummary {
  return {
    ...startAgainSummary(state),
    ...(recoveryRecordDamaged && { recoveryRecordDamaged: true as const }),
    ...(recovery !== undefined && { recovery }),
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
type FoundRecovery =
  | { kind: "stopped"; id: string; shown: StartAgainRecoveryShown }
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
    if (host.modules === undefined) unavailable();
    if (initialSetupFor(host.modules, last.binding.module) === undefined) unavailable();
    return {
      kind: "stopped",
      id: activity.recoveryId,
      shown: {
        startedAt: activity.startedAt,
        lastActiveAt: activity.lastActiveAt,
        lastActiveSource: activity.lastActiveSource,
        failed: activity.failed,
        cloud: activity.cloud,
      },
    };
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
  const markerFor = async (
    box: Awaited<ReturnType<typeof assertStartAgainAllowedOnDisk>>,
    state: FirstSetupState,
    markerOptions: { discarding?: string; held?: true },
  ) => {
    const marker = await startAgainMarkerFor(
      box,
      { attemptId: state.frozen.attemptId, frozenDigest: firstSetupFrozenDigest(state) },
      markerOptions,
    ).catch((error: unknown) => {
      throw error instanceof AppError && error.code === "setup.start_again_incomplete"
        ? new AppError("setup.not_ready", {}, { reason: error.reason ?? error.code })
        : error;
    });
    if (markerSize(marker) > (options.markerLimit ?? START_AGAIN_MARKER_LIMIT)) unavailable();
    return marker;
  };
  /**
   * Every check Start again makes before it writes, in its order, so the summary refuses exactly
   * what Start again would. No password: the repair page's wipe is offered to whoever can open it.
   */
  const assessStartAgain = async (
    request: StartAgainFirstSetupRequest,
    kind: "summary" | "start-again",
  ) => {
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
    const held =
      !missing &&
      (inspection.database !== "no-venue-rows" ||
        !PRESENT_START_AGAIN_STATUSES.includes(state.status));
    if (held) assertHeldStartAgainOffered(inspection, found, state.status);
    else if (missing) {
      if (state.status === "complete") refused("setup-finished");
      if (kind === "start-again" && request.confirmMissingDatabase === undefined) unavailable();
    } else if (!PRESENT_START_AGAIN_STATUSES.includes(state.status)) unavailable();
    const snapshot = await host.resolution.captureFirstSetupOriginals();
    if (snapshot.inspection.inspectionId !== request.inspectionId) conflict();
    const { emptyWorkspace, assignment, eligible } = await presentAttemptEligibility(
      inspection,
      state,
      snapshot.originals,
      host.modules,
      request.register,
    );
    if (held) {
      if (request.register?.kind === "no-current-master") unavailable();
    } else {
      if (request.register?.kind === "no-current-master" && !emptyWorkspace) unavailable();
      if (!missing && !eligible) unavailable();
    }
    if (inspection.artifacts.some((artifact) => artifact.name.startsWith("outside-")))
      unavailable();
    const heldOption = held ? { held: true as const } : {};
    // Before the read, which may copy the whole database: a refusal here costs nothing.
    const box = await assertStartAgainAllowedOnDisk(roots, { ...discarding, ...heldOption });
    if (held) {
      // `stoppedRecovery` answers "stopped" only once it has found `host.modules`.
      const holdings = await readSetupDatabaseHoldings(roots, host.modules!);
      // Not empty yet no rows (a view, a part-applied setup): not what the held state names.
      if (holdings.rows === 0) unavailable();
      assertNoKeptRecords(holdings);
    }
    const marker = await markerFor(box, state, { ...discarding, ...heldOption });
    const recordDamaged = recoveryRecordDamagedOf(state, snapshot.originals, host.modules);
    // With the database present and not held, Start again compares the assignment's own reading.
    const recoveryRecordDamaged =
      missing || held
        ? recordDamaged
        : typeof assignment === "object" && assignment.recoveryRecordDamaged;
    return {
      state,
      found,
      recovery,
      discarding,
      missing,
      discardsStopped,
      heldOption,
      box,
      marker,
      recoveryRecordDamaged,
    };
  };
  return {
    startAgainSummary(request: StartAgainSummaryRequest): Promise<StartAgainSummary> {
      return host.resolution.withVenueExclusion(() =>
        host.coordinator.run(async () => {
          exactKeys(request, ["inspectionId", "revision", "ownerGeneration"]);
          const { state, recoveryRecordDamaged, recovery } = await assessStartAgain(
            request,
            "summary",
          );
          return summaryOf(state, recoveryRecordDamaged, recovery);
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
            "register",
            "confirmMissingDatabase",
            "confirmRecoveryDiscard",
            "recoveryRecordDamagedShown",
          ]);
          const assessed = await assessStartAgain(request, "start-again");
          const { state, found, recovery, missing, discardsStopped, heldOption, box } = assessed;
          let { marker } = assessed;
          if (discardsStopped && request.confirmRecoveryDiscard === undefined) conflict();
          const damagedShown = request.recoveryRecordDamagedShown === true;
          if (!missing && assessed.recoveryRecordDamaged !== damagedShown) conflict();
          // An unemptied journal's confirmation record was written by the Start again that
          // abandoned it.
          const finishing = found?.kind === "unemptied";
          const confirmation = request.confirmMissingDatabase;
          const shown =
            missing || discardsStopped
              ? summaryOf(state, assessed.recoveryRecordDamaged, recovery)
              : undefined;
          if (
            missing &&
            (confirmation?.nothingFiledOrSold !== true ||
              !isDeepStrictEqual(confirmation.shown, shown))
          )
            conflict();
          if (discardsStopped && !isDeepStrictEqual(request.confirmRecoveryDiscard?.shown, shown))
            conflict();
          const backup = options.backupRecovery;
          const refuseRunning = async (): Promise<never> => {
            const activity = await backup!.liveness();
            if (activity === null) unavailable();
            throw inProgress(activity);
          };
          // No await between this check and the first write: the record changes the recovery's
          // originals, so an open that began during the checks could never resume it.
          if (found !== undefined && backup!.runningInMemory()) await refuseRunning();
          if ((missing || discardsStopped) && !finishing) {
            const { displayName, email } = state.frozen.request.admin;
            await writeStartAgainConfirmation(box.stateDir, {
              at: new Date().toISOString(),
              attemptId: state.frozen.attemptId,
              database: missing ? "missing" : "present",
              setupAdministrator: { displayName, email },
              ownerGeneration: state.ownerGeneration,
              shown: shown!,
            });
          }
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
            await assertStartAgainAllowedOnDisk(box, heldOption);
            marker = await markerFor(box, state, heldOption);
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
