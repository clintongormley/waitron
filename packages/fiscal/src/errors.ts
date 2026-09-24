// Makes this file a module, so the block below augments "@waitron/shared" rather than declaring
// a new ambient module of that name.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** Attached to a reading once the anchor has aged past `degradedAfterSeconds`. Warns a
     * member of staff; never thrown, because throwing would stop the sale. */
    "clock.degraded": { tillId: string; anchorAgeSeconds: number };
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
  }
}
