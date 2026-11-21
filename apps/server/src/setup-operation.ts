import type { SetupOperationState } from "@waitron/provisioning";

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
