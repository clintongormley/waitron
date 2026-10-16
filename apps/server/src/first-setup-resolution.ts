import { AppError } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
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
  return {
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
