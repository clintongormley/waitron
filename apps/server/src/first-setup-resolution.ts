import { AppError } from "@waitron/shared";
import { isDeepStrictEqual } from "node:util";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  createFirstSetupStore,
  inspectFirstSetupWorkspaceSelection,
  assertNoLegacyFirstSetupWorkspace,
  selectFirstSetupWorkspace,
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
  type RegisterAnswer,
  type WorkspaceBinding,
  type FirstSetupState,
} from "@waitron/provisioning";
import { lockVenueDatabase } from "@waitron/db";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import { readFirstFiscalEvidenceSnapshot } from "./first-fiscal-evidence.js";
import { readFirstFiscalDeliverySnapshot } from "./first-fiscal-delivery.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import "./errors.js";
import { firstSetupUnusedAssignment } from "./first-setup-unused-assignment.js";

export interface StartAgainFirstSetupRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  owner?: FirstSetupOwnerAttempt;
  register?: RegisterAnswer;
  confirmMissingDatabase?: { nothingFiledOrSold: true; shown: StartAgainSummary };
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
): StartAgainSummary {
  const summary = startAgainSummary(state, gathered.floor?.lastName ?? null);
  return gathered.recoveryRecordDamaged ? { ...summary, recoveryRecordDamaged: true } : summary;
}
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
  },
) {
  const { host } = options;
  const roots = { stateDir: options.stateDir, venueDir: options.venueDir };
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
  const inspectSelection = async () => {
    const inspected = await inspectFirstSetupWorkspaceSelection(options);
    if (inspected === null) return null;
    const retained = await createFirstSetupStore({
      ...inspected.retired,
      coordinator: createFirstSetupCoordinator(),
    }).readForRepair();
    if (
      retained === null ||
      retained.state.frozen.attemptId !== inspected.record.attemptId ||
      retained.state.revision !== inspected.record.observedRevision ||
      retained.state.ownerGeneration !== inspected.record.observedOwnerGeneration
    )
      conflict();
    return { ...inspected, state: retained.state };
  };
  return {
    async inspectWorkspaceSelection() {
      const inspected = await inspectSelection();
      if (inspected === null) return null;
      return {
        inspectionId: inspected.inspectionId,
        revision: inspected.state.revision,
        ownerGeneration: inspected.state.ownerGeneration,
        workspaceId: inspected.binding.workspaceId,
        selectionGeneration: inspected.binding.selectionGeneration,
      };
    },
    async resumeWorkspaceSelection(
      request: {
        inspectionId: string;
        revision: number;
        ownerGeneration: number;
        workspaceId: string;
        selectionGeneration: number;
      } & (
        { password: string; register?: never } | { register?: RegisterAnswer; password?: never }
      ),
    ): Promise<WorkspaceBinding> {
      const inspected = await inspectSelection();
      if (inspected === null) conflict();
      if (
        request.inspectionId !== inspected.inspectionId ||
        request.revision !== inspected.state.revision ||
        request.ownerGeneration !== inspected.state.ownerGeneration ||
        request.workspaceId !== inspected.binding.workspaceId ||
        request.selectionGeneration !== inspected.binding.selectionGeneration
      )
        conflict();
      const assertLocalReset = async (
        current: NonNullable<Awaited<ReturnType<typeof inspectSelection>>>,
      ) => {
        if (
          current.record.database !== "empty-preactivation" ||
          current.record.action !== "retire" ||
          !(await host.resolution.recheckEmptyDatabase(
            current.retired,
            current.state.frozen.modules.map((entry) => entry.module),
          )) ||
          (await host.resolution.inspectFirstSetupResolution()).artifacts.some((artifact) =>
            artifact.name.startsWith("outside-"),
          )
        )
          unavailable();
        if (
          current.record.authority === "local-empty-no-custodian" &&
          request.register?.kind === "no-current-master" &&
          request.register.confirmed === true &&
          current.record.register?.kind === "no-current-master" &&
          unused(current.state)
        )
          return;
        if (
          current.record.authority === "local-empty-unused-assignment" &&
          request.register?.kind === "current-master" &&
          current.record.register?.kind === "current-master" &&
          typeof request.register.consultedAt === "string" &&
          Number.isFinite(Date.parse(request.register.consultedAt)) &&
          new Date(request.register.consultedAt).toISOString() === request.register.consultedAt &&
          isDeepStrictEqual(
            { ...request.register, consultedAt: current.record.register.consultedAt },
            current.record.register,
          ) &&
          host.modules !== undefined
        ) {
          const archive = createFirstSetupResolutionStore({
            venueDir: current.binding.anchorVenueDir,
            stateDir: current.binding.anchorStateDir,
            coordinator: createFirstSetupCoordinator(),
          });
          if (
            await firstSetupUnusedAssignment(
              current.state,
              await archive.readOriginals(current.record.resolutionId),
              host.modules,
            )
          )
            return;
        }
        if (
          current.record.authority === "local-empty-unused-assignment" &&
          current.record.register === null &&
          request.register === undefined &&
          host.modules !== undefined
        ) {
          const archive = createFirstSetupResolutionStore({
            venueDir: current.binding.anchorVenueDir,
            stateDir: current.binding.anchorStateDir,
            coordinator: createFirstSetupCoordinator(),
          });
          if (
            unused(current.state) ||
            (await firstSetupUnusedAssignment(
              current.state,
              await archive.readOriginals(current.record.resolutionId),
              host.modules,
            ))
          )
            return;
        }
        unavailable();
      };
      const resume = async () => {
        const anchor = {
          venueDir: inspected.binding.anchorVenueDir,
          stateDir: inspected.binding.anchorStateDir,
        };
        const hold = await lockVenueDatabase(anchor.venueDir);
        let target: Awaited<ReturnType<typeof lockVenueDatabase>> | undefined;
        try {
          if (inspected.retired.venueDir !== anchor.venueDir)
            target = await lockVenueDatabase(inspected.retired.venueDir);
          return await host.coordinator.run(async () => {
            const current = await inspectSelection();
            if (current === null || current.inspectionId !== inspected.inspectionId) conflict();
            if (request.password === undefined) await assertLocalReset(current);
            return selectFirstSetupWorkspace(anchor, current.record);
          });
        } finally {
          target?.release();
          hold.release();
        }
      };
      if (request.password !== undefined)
        return host.owner.withResolutionPassword(inspected.state, request.password, resume);
      // Only resume the recorded empty reset; selection rechecks every archived local original.
      await assertLocalReset(inspected);
      return resume();
    },
    startAgainSummary(request: StartAgainSummaryRequest): Promise<StartAgainSummary> {
      return host.resolution.withVenueExclusion(() =>
        host.coordinator.run(async () => {
          exactKeys(request, ["inspectionId", "revision", "ownerGeneration", "owner"]);
          await assertNoLegacyFirstSetupWorkspace(options);
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
          return summaryOf(retained.state, gathered);
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
          ]);
          await assertNoLegacyFirstSetupWorkspace(options);
          const inspection = await host.resolution.inspectFirstSetupResolution();
          matchesInspection(inspection, request);
          const retained = await host.store.readForRepair();
          if (retained === null) unavailable();
          const { state } = retained;
          const missing = inspection.database === "missing";
          if (!missing && request.confirmMissingDatabase !== undefined) conflict();
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
          const unusedAssignment =
            inspection.emptyDatabase &&
            (request.register === undefined || request.register.kind === "current-master") &&
            host.modules !== undefined &&
            ((request.register === undefined && emptyWorkspace) ||
              (await firstSetupUnusedAssignment(state, snapshot.originals, host.modules)));
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
          const gathered = await gatherStartAgainFloor(
            roots,
            state,
            snapshot.originals,
            host.modules,
          );
          const floor = gathered.floor;
          const confirmation = request.confirmMissingDatabase;
          if (missing) {
            const shown = summaryOf(state, gathered);
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
