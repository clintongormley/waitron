import { AppError } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  createFirstSetupStore,
  inspectFirstSetupWorkspaceSelection,
  assertFirstSetupBootTarget,
  firstSetupAnchorFor,
  resolveFirstSetupWorkspace,
  readFirstSetupRetirements,
  selectFirstSetupWorkspace,
  type RegisterAnswer,
  type WorkspaceBinding,
  type FirstSetupState,
} from "@waitron/provisioning";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { lockVenueDatabase } from "@waitron/db";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import "./errors.js";

export interface StartAgainFirstSetupRequest {
  inspectionId: string;
  revision: number;
  ownerGeneration: number;
  owner?: FirstSetupOwnerAttempt;
  register: RegisterAnswer;
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
export function createFirstSetupResolutionActions(
  options: FirstSetupRoots & {
    host: Pick<FirstFiscalHost, "resolution" | "owner" | "store" | "coordinator"> & {
      evidence: Pick<FirstFiscalHost["evidence"], "invalidate">;
      delivery: Pick<FirstFiscalHost["delivery"], "invalidate">;
    };
  },
) {
  const { host } = options;
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
    async resumeWorkspaceSelection(request: {
      inspectionId: string;
      revision: number;
      ownerGeneration: number;
      workspaceId: string;
      selectionGeneration: number;
      password: string;
    }): Promise<WorkspaceBinding> {
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
      return host.owner.withResolutionPassword(inspected.state, request.password, async () => {
        const anchor = {
          venueDir: inspected.binding.anchorVenueDir,
          stateDir: inspected.binding.anchorStateDir,
        };
        const hold = await lockVenueDatabase(anchor.venueDir);
        let target: Awaited<ReturnType<typeof lockVenueDatabase>> | undefined;
        try {
          if (inspected.retired.venueDir !== anchor.venueDir)
            target = await lockVenueDatabase(inspected.retired.venueDir);
          const current = await inspectSelection();
          if (current === null || current.inspectionId !== inspected.inspectionId) conflict();
          return await host.coordinator.run(() =>
            selectFirstSetupWorkspace(anchor, current.record),
          );
        } finally {
          target?.release();
          hold.release();
        }
      });
    },
    startAgainFirstSetup(request: StartAgainFirstSetupRequest): Promise<WorkspaceBinding> {
      return host.resolution.withVenueExclusion(() =>
        host.coordinator.run(async () => {
          if (
            typeof request !== "object" ||
            request === null ||
            Object.keys(request).some(
              (key) =>
                !["inspectionId", "revision", "ownerGeneration", "owner", "register"].includes(key),
            )
          )
            conflict();
          await assertFirstSetupBootTarget(options);
          const inspection = await host.resolution.inspectFirstSetupResolution();
          if (
            inspection.inspectionId !== request.inspectionId ||
            inspection.revision !== request.revision ||
            inspection.ownerGeneration !== request.ownerGeneration
          )
            conflict();
          const retained = await host.store.readForRepair();
          if (retained === null) unavailable();
          const { state } = retained;
          if (!["claimed", "consumption-intent", "abandoned"].includes(state.status)) unavailable();
          if (!["no-venue-rows", "missing"].includes(inspection.database)) unavailable();
          const noOtherHistory = inspection.artifacts.every(
            (artifact) =>
              ["first-setup.json", "first-setup-claim.json", "venue.db", "venue.db-wal"].includes(
                artifact.name,
              ) || artifact.status === "missing",
          );
          const retired = await readFirstSetupRetirements(options);
          const noInheritedRegister = retired.every(
            ({ state, record }) => record.register.kind === "no-current-master" && unused(state),
          );
          const emptyWorkspace =
            inspection.database === "no-venue-rows" && unused(state) && noOtherHistory;
          const empty = emptyWorkspace && noInheritedRegister;
          let authority: "original-password" | "local-empty-no-custodian";
          if (request.owner === undefined) {
            if (
              !empty ||
              request.register.kind !== "no-current-master" ||
              request.register.confirmed !== true
            )
              unavailable();
            authority = "local-empty-no-custodian";
          } else {
            const owner = await host.owner.status(request.owner);
            const latest = [...owner.history]
              .reverse()
              .find((event) => ["claim", "resume", "recover"].includes(event.kind));
            if (
              owner.revision !== state.revision ||
              latest?.kind !== "recover" ||
              latest.ownerGeneration !== owner.ownerGeneration
            )
              throw new AppError("setup.owner_required", {});
            authority = "original-password";
            if (request.register.kind === "no-current-master" && !empty) unavailable();
            if (inspection.database !== "missing" && !emptyWorkspace) unavailable();
          }
          const snapshot = await host.resolution.captureFirstSetupOriginals();
          if (snapshot.inspection.inspectionId !== request.inspectionId) conflict();
          const anchor = await firstSetupAnchorFor(options);
          const current = await resolveFirstSetupWorkspace(anchor);
          if (current.binding !== null)
            snapshot.originals.push({
              name: "workspace:predecessor",
              bytes: await readFile(join(current.venueDir, "first-setup-workspace.json")),
            });
          const resolutionId = randomUUID(),
            workspaceId = randomUUID();
          const base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
          const binding: WorkspaceBinding = {
            workspaceId,
            resolutionId,
            anchorVenueDir: anchor.venueDir,
            anchorStateDir: anchor.stateDir,
            venueDir: join(base, "venue"),
            stateDir: join(base, "state"),
            selectionGeneration: (current.binding?.selectionGeneration ?? 0) + 1,
          };
          const records = createFirstSetupResolutionStore({
            ...anchor,
            coordinator: createFirstSetupCoordinator(),
          });
          const prepared = await records.prepare(
            {
              resolutionId,
              attemptId: state.frozen.attemptId,
              observedRevision: state.revision,
              observedOwnerGeneration: state.ownerGeneration,
              database: emptyWorkspace ? "empty-preactivation" : "missing",
              authority,
              register: request.register,
              action: "retire",
              nextWorkspace: binding,
            },
            snapshot.originals,
          );
          const applied = await records.apply(prepared);
          const selected = await selectFirstSetupWorkspace(anchor, applied);
          host.owner.invalidate(state.frozen.attemptId);
          host.evidence.invalidate(state.frozen.attemptId);
          host.delivery.invalidate(state.frozen.attemptId);
          return selected;
        }),
      );
    },
  };
}
