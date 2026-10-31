// Makes this file a module, so the block below augments "@waitron/shared" rather than declaring
// a new ambient module of that name.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** Attached to a reading once the anchor has aged past `degradedAfterSeconds`. Warns a
     * member of staff; never thrown, because throwing would stop the sale. */
    "clock.degraded": { deviceId: string; anchorAgeSeconds: number };
    /** Attached once a reload's wall-clock comparison proves the wall clock moved backwards
     * while this page's monotonic reference was gone. */
    "clock.jump_detected": { wallClockDeltaSeconds: number; monotonicElapsedSeconds: number };
    /** Thrown by `FakeFiscalBackend.recordSale` for a node with no `registerNode` on record. */
    "fiscal.node_not_registered": { nodeId: string };
    /** A void, correction or substitution named a sale with no prior `recordSale`. */
    "fiscal.sale_not_recorded": { saleId: string };
    /** No fiscal module set is implemented for this territory; thrown by `resolveFiscalModules`
     * (`@waitron/provisioning`). `territory` is the operator-supplied `fiscal_territory`, echoed
     * so the refusal can be acted on. */
    "fiscal.regime_not_implemented": { territory: string };
    /** An administrator's, or a staff member's on a till, confirmation of the box's clock was not
     * accepted: there is no stop and no check waits, a witness disagrees with the box, the
     * person's device disagrees with it, or the request came from the box itself. */
    "clock.confirm_refused": {
      reason: "not_stopped" | "contrary_proof" | "differs" | "same_machine";
    };
    /** The clock check a confirmation names is not one this box holds for the session: unknown,
     * another session's, already used, or older than its time limit. */
    "clock.check_expired": Record<string, never>;
  }
}
