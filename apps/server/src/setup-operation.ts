import type {
  ActiveSetupOperation,
  SetupOperationPhase,
  SetupOperationState,
} from "@waitron/provisioning";

export { createSetupOperationStore } from "@waitron/provisioning";
export type {
  SetupOperationKind,
  SetupOperationPhase,
  SetupOperationState,
  ActiveSetupOperation,
  SetupOperationStore,
} from "@waitron/provisioning";

/** A join past its first write and not finished: the one record the start takes the main box's
 * environment from, the reset route accepts and a staged reset carries out. */
export function isUnfinishedAdopt(
  record: SetupOperationState | null,
): record is SetupOperationState {
  return (
    record !== null &&
    record.kind === "adopt" &&
    record.phase !== "started" &&
    record.phase !== "complete"
  );
}

const SETUP_PHASES: readonly SetupOperationPhase[] = [
  "started",
  "venue_committed",
  "content_seeded",
  "identity_established",
  "membership_seeded",
  "secret_sealed",
  "publishing",
  "complete",
];
export function setupPhaseReached(
  operation: ActiveSetupOperation | undefined,
  phase: SetupOperationPhase,
): boolean {
  return (
    operation !== undefined && SETUP_PHASES.indexOf(operation.phase) >= SETUP_PHASES.indexOf(phase)
  );
}
