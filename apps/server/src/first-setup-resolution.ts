import { AppError } from "@waitron/shared";
import { isDeepStrictEqual } from "node:util";
import {
  assertNoLegacyFirstSetupWorkspace,
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
  type FirstSetupInspection,
  type FirstSetupState,
} from "@waitron/provisioning";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import "./errors.js";
import { firstSetupUnusedAssignment } from "./first-setup-unused-assignment.js";
import {
  readSetupDatabase,
  type SetupDatabaseHoldings,
  type SetupDatabaseRead,
} from "./first-setup-database-holdings.js";

export interface StartAgainFirstSetupRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  register?: RegisterAnswer;
  confirmMissingDatabase?: { nothingFiledOrSold: true; shown: StartAgainSummary };
  confirmUnreadableDatabase?: { shown: StartAgainSummary };
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
function assertNoKeptRecords(read: SetupDatabaseRead): void {
  const { rows, kept, records, accepted }: SetupDatabaseHoldings =
    read.kind === "read" ? read.holdings : read.seen;
  if (kept > 0 || records > 0)
    refused(
      "kept-records",
      `rows=${rows} kept=${kept} records=${records} accepted=${accepted}` +
        (read.kind === "damaged" ? ` damaged=${read.code}` : ""),
    );
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
/** Labels the inspection gives a database that may be damaged, which only a read can tell. */
const DAMAGED_LABELS: readonly string[] = ["corrupt", "unknown", "partial"];
/** The held state's refusals made before what its database holds is read, in this order. */
function assertHeldStartAgainOffered(
  inspection: Pick<FirstSetupInspection, "database" | "emptyDatabase" | "artifacts">,
  status: FirstSetupState["status"],
): void {
  const holdsRecords =
    inspection.database === "occupied" ||
    (inspection.database === "no-venue-rows" && !inspection.emptyDatabase) ||
    DAMAGED_LABELS.includes(inspection.database);
  if (!holdsRecords) unavailable();
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
  databaseUnreadable = false,
): StartAgainSummary {
  return {
    ...startAgainSummary(state),
    ...(recoveryRecordDamaged && { recoveryRecordDamaged: true as const }),
    ...(databaseUnreadable && { databaseUnreadable: true as const }),
  };
}
/** The attempt statuses Start again accepts with the venue database present. */
const PRESENT_START_AGAIN_STATUSES: readonly string[] = [
  "claimed",
  "consumption-intent",
  "abandoned",
];
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
    markerOptions: { held?: true },
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
   * Start again's checks, in its order, except those on what the page sends back and the deletion
   * marker's size (Start again builds the marker, which hashes every file it lists). No password:
   * the repair page's wipe is offered to whoever can open it.
   */
  const assessStartAgain = async (
    request: StartAgainFirstSetupRequest,
    kind: "summary" | "start-again",
  ) => {
    await assertNoLegacyFirstSetupWorkspace(options);
    const inspection = await host.resolution.inspectFirstSetupResolution();
    matchesInspection(inspection, request);
    const retained = await host.store.readForRepair();
    if (retained === null) unavailable();
    const { state } = retained;
    const missing = inspection.database === "missing";
    if (!missing && request.confirmMissingDatabase !== undefined) conflict();
    if (missing && request.recoveryRecordDamagedShown !== undefined) conflict();
    const label = inspection.database;
    const presentStatus = PRESENT_START_AGAIN_STATUSES.includes(state.status);
    if (label === "unreadable") unavailable();
    const held = !missing && (label === "occupied" || !presentStatus);
    // An unused setup's database the inspection could not show empty (D3 row c).
    const readFirst = !missing && !held && !(label === "no-venue-rows" && inspection.emptyDatabase);
    if (held) assertHeldStartAgainOffered(inspection, state.status);
    else if (missing) {
      if (state.status === "complete") refused("setup-finished");
      if (kind === "start-again" && request.confirmMissingDatabase === undefined) unavailable();
    }
    const snapshot = await host.resolution.captureFirstSetupOriginals();
    if (snapshot.inspection.inspectionId !== request.inspectionId) conflict();
    // Row c's proof counts the database as empty; only a read that finds damage keeps it so.
    const present = held
      ? undefined
      : await presentAttemptEligibility(
          readFirst ? { ...inspection, emptyDatabase: true } : inspection,
          state,
          snapshot.originals,
          host.modules,
          request.register,
        );
    if (present === undefined) {
      if (request.register?.kind === "no-current-master") unavailable();
    } else {
      if (request.register?.kind === "no-current-master" && !present.emptyWorkspace) unavailable();
      if (!missing && !present.eligible) unavailable();
    }
    if (inspection.artifacts.some((artifact) => artifact.name.startsWith("outside-")))
      unavailable();
    const heldOption = held ? { held: true as const } : {};
    // Before the read, which may copy the whole database: a refusal here costs nothing.
    const box = await assertStartAgainAllowedOnDisk(roots, {
      ...heldOption,
      nodeId: state.frozen.nodeId,
    });
    let databaseUnreadable = false;
    if (held || readFirst) {
      if (host.modules === undefined) unavailable();
      const read = await readSetupDatabase(roots, host.modules);
      // An unused setup's database read whole is not empty, so it is not unused.
      if (readFirst && read.kind === "read") unavailable();
      assertNoKeptRecords(read);
      if (read.kind === "read") {
        // Not empty yet no rows (a view, a part-applied setup), or read whole where the
        // inspection could not: not what the held state names.
        if (read.holdings.rows === 0 || DAMAGED_LABELS.includes(label)) unavailable();
      } else databaseUnreadable = true;
    }
    const recordDamaged = recoveryRecordDamagedOf(state, snapshot.originals, host.modules);
    // With the database present and not held, Start again compares the assignment's own reading.
    const recoveryRecordDamaged =
      missing || held
        ? recordDamaged
        : typeof present?.assignment === "object" && present.assignment.recoveryRecordDamaged;
    return {
      state,
      missing,
      heldOption,
      box,
      recoveryRecordDamaged,
      databaseUnreadable,
    };
  };
  return {
    startAgainSummary(request: StartAgainSummaryRequest): Promise<StartAgainSummary> {
      return host.resolution.withVenueExclusion(() =>
        host.coordinator.run(async () => {
          exactKeys(request, ["inspectionId", "revision", "ownerGeneration"]);
          const { state, recoveryRecordDamaged, databaseUnreadable } = await assessStartAgain(
            request,
            "summary",
          );
          return summaryOf(state, recoveryRecordDamaged, databaseUnreadable);
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
            "confirmUnreadableDatabase",
            "recoveryRecordDamagedShown",
          ]);
          const assessed = await assessStartAgain(request, "start-again");
          const { state, missing, heldOption, box, databaseUnreadable } = assessed;
          if (databaseUnreadable !== (request.confirmUnreadableDatabase !== undefined)) conflict();
          const marker = await markerFor(box, state, heldOption);
          const damagedShown = request.recoveryRecordDamagedShown === true;
          if (!missing && assessed.recoveryRecordDamaged !== damagedShown) conflict();
          const confirmation = request.confirmMissingDatabase;
          const shown =
            missing || databaseUnreadable
              ? summaryOf(state, assessed.recoveryRecordDamaged, databaseUnreadable)
              : undefined;
          if (
            missing &&
            (confirmation?.nothingFiledOrSold !== true ||
              !isDeepStrictEqual(confirmation.shown, shown))
          )
            conflict();
          if (
            databaseUnreadable &&
            !isDeepStrictEqual(request.confirmUnreadableDatabase?.shown, shown)
          )
            conflict();
          // A damaged database's confirmation is recorded every time: an earlier record may
          // describe the database before it was damaged.
          if (missing || databaseUnreadable) {
            const { displayName, email } = state.frozen.request.admin;
            await writeStartAgainConfirmation(box.stateDir, {
              at: new Date().toISOString(),
              attemptId: state.frozen.attemptId,
              database: missing ? "missing" : "unreadable",
              setupAdministrator: { displayName, email },
              ownerGeneration: state.ownerGeneration,
              shown: shown!,
            });
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
