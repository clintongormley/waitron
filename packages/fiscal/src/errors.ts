// A bare side-effect import, not a value used anywhere in this file. It is what makes
// TypeScript treat "@waitron/shared" as a real module to augment rather than defining a fresh
// ambient module of the same name — the same idiom used to add fields to Express's `Request`,
// and the same one packages/db/src/errors.ts uses for its own contribution.
import "@waitron/shared";

/**
 * packages/fiscal's own contribution to the shared error registry, added by declaration merging
 * rather than pre-declared in packages/shared itself — see the design note atop
 * packages/shared/src/errors.ts. packages/shared is the leaf every package depends on and must
 * never need to change just because a dependent package adds a code; this file is how
 * packages/fiscal adds its codes without packages/shared knowing about them in advance.
 *
 * Namespace convention: the prefix names the DOMAIN CONCEPT the code describes, never the
 * package whose source happens to contain the `throw`/`new AppError(...)` call — see the design
 * note atop packages/shared/src/errors.ts. `createTrustedClock` (./clock.ts) attaches these to a
 * reading as a fact about the CLOCK, not about packages/fiscal, so both are `clock.*` rather than
 * `fiscal.*`.
 *
 * Reachability: this file is a side-effect import of ./clock.ts and ./backend.ts (both
 * `import "./errors.js"`), and both are re-exported from ./index.ts, so this augmentation is
 * transitively reachable from the package's own public barrel. See ./errors.reachability.test.ts,
 * which mirrors packages/db/src/errors.reachability.test.ts's mechanical check for the same
 * property.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Attached to a reading once the anchor has aged past `degradedAfterSeconds`. Warns a
     * member of staff; never thrown, because throwing would stop the sale. */
    "clock.degraded": { tillId: string; anchorAgeSeconds: number };
    /** Attached once a reload's wall-clock comparison proves the wall clock moved backwards
     * while this page's monotonic reference was gone. See ./clock.ts for the detection logic. */
    "clock.jump_detected": { wallClockDeltaSeconds: number; monotonicElapsedSeconds: number };
    /** Thrown by `FiscalBackend.recordSale`/`recordVoid` for a node with no
     * `registerNode` call on record (node-id rekey, 2026-08-03: the SIF is the
     * node — #33 — so registration is node-scoped). `fiscal.*` here names the
     * domain concept a generic backend enforces before writing anything — never
     * a regime one: every backend, whatever its regime, refuses to write for a
     * node it does not know about. See ./backend.ts and ./testing/fake-backend.ts. */
    "fiscal.node_not_registered": { nodeId: string };
    /** Thrown by `FiscalBackend.recordVoid` when the sale it references has no
     * prior `recordSale`. A void is a second record referencing the first
     * (spec §4); there is nothing to reference if the first was never made. */
    "fiscal.sale_not_recorded": { saleId: string };
    /** No fiscal module set is implemented for this territory. Regime-NEUTRAL — the fact that a
     * regime is unimplemented belongs to no single regime — and named for the fiscal-regime
     * concept, never the throwing package. Its throwers, by design (spec D4's two guards):
     * `resolveFiscalModules` (@waitron/provisioning, Task B2) refuses an unimplemented territory
     * at venue provisioning input, and any later runtime consumer of a node's `filing_module`
     * re-raises it as a hard error (defence-in-depth). `territory` is the operator-supplied
     * free-text `fiscal_territory`, echoed so the refusal can be acted on. */
    "fiscal.regime_not_implemented": { territory: string };
  }
}
