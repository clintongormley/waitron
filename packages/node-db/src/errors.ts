import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** The operation id is already recorded on this box with a different binding fingerprint. */
    "handover.operation_conflict": { operationId: string };
    /** `operationId` is the operation this box already holds open. */
    "handover.operation_in_progress": { operationId: string };
    /** This box's restriction is already recorded with different values. */
    "handover.restriction_conflict": Record<string, never>;
  }
}
