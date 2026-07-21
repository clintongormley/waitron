// A bare side-effect import, not a value used anywhere in this file. It is what makes TypeScript
// treat "@waitron/shared" as a real module to augment rather than defining a fresh ambient module
// of the same name — the same idiom packages/db/src/errors.ts, packages/fiscal/src/errors.ts and
// packages/fiscal-verifactu/src/errors.ts already use for their own contributions.
import "@waitron/shared";

/**
 * packages/core's own contribution to the shared error registry, added by declaration merging
 * rather than pre-declared in packages/shared itself — see the design note atop
 * packages/shared/src/errors.ts. packages/shared is the leaf every package depends on and must
 * never need to change just because a dependent package adds a code; this file is how
 * packages/core adds its own codes without packages/shared knowing about them in advance.
 *
 * **Deviation from Task 16's brief.** The brief's Step 1 said to append five members
 * (`sale.tender_unsettled`, `sale.tender_shortfall`, `sale.series_not_found`,
 * `sale.series_wrong_till`, `sale.number_reused`) directly to `packages/shared/src/errors.ts`'s
 * `ErrorCode` union. That is wrong under this repo's OWN documented, already-precedented
 * convention (see `packages/shared/src/errors.ts`'s design note, and Task 13's identical
 * correction in `packages/fiscal-verifactu/src/errors.ts`, and Task 14's in the same file): only
 * codes NATIVE to `packages/shared` itself (`ids.ts`, `money.ts`) belong in that file's own
 * registry; every dependent package — `packages/db`, `packages/fiscal`,
 * `packages/fiscal-verifactu`, and now `packages/core` — contributes its own by
 * `declare module "@waitron/shared"` from its OWN source, exactly as this file does. Overridden
 * here for the identical reason those three files already give: `packages/shared` must never
 * change just because a dependent package adds a code, and the namespace convention is
 * DOMAIN-CONCEPT, lowercase, dot-namespaced (`sale.*`) — never the throwing package's name
 * (never `core.*`).
 *
 * `sale.number_reused` is registered here per the brief's own instruction, for the constraint-
 * violation translation a later task adds — no `throw` in this package raises it yet, so
 * `errors.reachability.test.ts`'s check (this file is reachable from `./index.ts`) is the only
 * thing keeping it visible outside this package until then.
 *
 * Reachability: this file is a side-effect import of `./record-sale.ts` (`import "./errors.js"`),
 * which is re-exported from `./index.ts`, so this augmentation is transitively reachable from the
 * package's own public barrel. See `./errors.reachability.test.ts`, which mirrors
 * `packages/db/src/errors.reachability.test.ts`'s identical mechanical check for the same
 * property.
 *
 * **Task 17 addition.** The brief for `recordVoid` said to append `sale.not_found` and
 * `sale.already_voided` directly to `packages/shared/src/errors.ts`'s `ErrorCode` union — the
 * identical, already-corrected-twice mistake this file's own header above already explains: only
 * codes native to `packages/shared` itself belong there. Added here instead, alongside every other
 * `sale.*` code, by the same `declare module` this file already uses.
 *
 * **Task 18 addition.** `chain.verification_failed`, for the identical reason and by the
 * identical mechanism: the brief said to append it directly to
 * `packages/shared/src/errors.ts`'s `ErrorCode` union, which is the same already-corrected
 * mistake as above. Filed here rather than in `packages/fiscal`/`packages/fiscal-verifactu`
 * because `checkIntegrity`'s real `IntegrityIssue.code` is a regime-specific, ad hoc string (e.g.
 * `predecessor-hash-mismatch` — see `packages/fiscal-verifactu/src/verify.ts`), not an `ErrorCode`
 * at all: `IntegrityReport`/`IntegrityIssue` (`packages/fiscal/src/backend.ts`) are typed
 * `{ code: string; params: Record<string, unknown> }` specifically so a regime module never has
 * to register a member on the shared registry per issue kind. `./record-sale.ts`/`./record-void.ts`
 * are what translate "verification failed" into a stable, translatable incident code — one
 * generic code regardless of which specific issue the module reported — and it is this
 * translation, done in `packages/core`, that needs the registered `ErrorCode`. `clock.degraded`
 * needs no such addition here: it is already registered by `packages/fiscal/src/errors.ts` (Task
 * 10), and `./record-sale.ts` reuses `TrustedReading.warning` — an `AppError` already carrying
 * that exact code — verbatim rather than re-deriving it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Thrown by `recordSale` before any row is written: at least one tender in
     * `RecordSaleInput.tenders` has `settledAt: null`. A card declined mid-tender must leave the
     * working order open and retryable with nothing chained — see `./record-sale.ts`'s
     * `assertAllTendersSettled`. */
    "sale.tender_unsettled": { tillId: string; workingOrderId: string; unsettledCount: number };
    /** Thrown by `recordSale` before any row is written: every tender has settled, but their sum
     * does not equal `total + tipAmount`. Distinct from `sale.tender_unsettled` — a translator
     * needs to tell "still waiting on a payment" from "the payments don't add up" apart. */
    "sale.tender_shortfall": {
      tillId: string;
      workingOrderId: string;
      due: string;
      charged: string;
    };
    /** Thrown by `recordSale` when `RecordSaleInput.seriesId` names no row in `invoice_series` —
     * either it never existed, or row-level security hid a series belonging to another tenant,
     * which reads identically from here (spec's own fail-closed shape for a cross-tenant probe). */
    "sale.series_not_found": { seriesId: string; tenantId: string };
    /** Thrown by `recordSale` when `RecordSaleInput.seriesId` names a real series, but one that
     * belongs to a DIFFERENT till than `RecordSaleInput.tillId`. A till may own several series,
     * but a series belongs to exactly one till — allocating from another till's series would let
     * two chains issue from one counter, which no constraint downstream can detect. */
    "sale.series_wrong_till": { seriesId: string; expected: string; actual: string };
    /** Reserved for the constraint-violation translation `UNIQUE (tenant_id, series_id,
     * invoice_number)` produces when something outside the ordinary write path tries to reuse a
     * number that already reached a committed sale. Still not thrown anywhere in this package:
     * Task 17's own "burned number" test (`record-void.test.ts`) proves the constraint fires by
     * reading the raw SQLSTATE off the rejected INSERT directly (`captureError`/`pgErrorCode`),
     * the same way `record-sale.test.ts`'s "never reissues a number" test already does — neither
     * `recordSale` nor `recordVoid` catches and translates that violation into this code. */
    "sale.number_reused": { seriesId: string; invoiceNumber: number };
    /** Thrown by `recordVoid` (`./record-void.ts`) when `saleId` names no row in `sales` — either
     * it never existed, or row-level security hid a sale belonging to another tenant, which reads
     * identically from here (the same fail-closed shape `sale.series_not_found` already uses for
     * an analogous cross-tenant probe). An operational failure, not a fiscal one: NO FISCAL
     * CONDITION BLOCKS a void applies to a chain-integrity failure, never to "there is nothing
     * here to void". */
    "sale.not_found": { saleId: string };
    /** Thrown by `recordVoid` when `sale_voids.sale_id` already carries a row for this sale — the
     * translation of `sale_voids_sale_id_key`'s unique violation (`packages/db/src/schema/
     * sale-voids.ts`), which is the actual control against double-voiding. Also an operational
     * failure: a second void of an already-voided sale is a staff/UI error, not a fiscal
     * condition, and must not be confused with a chain-verification failure. */
    "sale.already_voided": { saleId: string };
    /** Thrown-and-caught internally by `recordSale`/`recordVoid` (never crosses either function's
     * own boundary — it is constructed only to hand its `.code`/`.params` to `recordIncident`) to
     * wrap ONE `IntegrityIssue` from a failed `FiscalBackend.checkIntegrity` call as a stable,
     * translatable incident: staff and support see one consistent code regardless of which
     * regime-specific issue kind the module actually reported, with the module's own diagnostic
     * detail preserved underneath for support to read. One incident row per issue — spec's own
     * table lists "record the incident" for the chain-verification-fails condition, and
     * `IntegrityReport.issues` may hold more than one. */
    "chain.verification_failed": {
      tillId: string;
      /** The module's own issue code — e.g. `predecessor-hash-mismatch` — never itself a
       * translation key: it is regime-specific and not registered on this shared surface. */
      issueCode: string;
      recordId: string | null;
      /** The module's own structured params for that issue, carried verbatim — never
       * re-rendered into prose. */
      issueParams: Record<string, unknown>;
    };
  }
}
