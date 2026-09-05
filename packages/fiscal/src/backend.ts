// Side-effect only: registers this package's `fiscal.*` codes on the shared `ErrorParams`
// registry by declaration merging. See errors.ts for why, and errors.reachability.test.ts for the
// mechanical check that keeps errors.ts reachable from this package's own public barrel
// (index.ts). errors.ts is already reachable via ./clock.ts's own such import; this second import
// is redundant for reachability specifically, but every file whose JSDoc references a `fiscal.*`
// code carries it anyway, mirroring packages/db/src/allocate-number.ts's convention of importing
// from the file that documents the codes it throws — even though, unlike that file, nothing in
// backend.ts itself throws (it is types only; ./testing/fake-backend.ts does the throwing).
import "./errors.js";
import type { Decimal, NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";

/**
 * The lifecycle of a fiscal record as the POS understands it. Regime-neutral: `recorded` means
 * the legally-required record exists locally, which in Spain is the point at which the sale is
 * compliant regardless of whether anything has been sent anywhere.
 */
export type FiscalState = "recorded" | "pending" | "acknowledged" | "rejected";

export interface NodeRegistration {
  backend: string;
  nodeId: NodeId;
  /** Opaque to the POS. A número de instalación, a device id, or nothing meaningful at all. */
  registrationId: string;
  registeredAt: Date;
}

export interface VatBreakdownLine {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  surchargeRate?: Decimal;
  surcharge?: Decimal;
}

export interface Counterparty {
  taxId: string;
  legalName: string;
  countryCode: string;
}

/**
 * Everything a regime could plausibly need about a completed sale, in English and in exact
 * decimals. Line descriptions are deliberately absent: they are a receipt-rendering concern and
 * reach no authority anywhere (spec §9), so putting them here would invite a backend to depend
 * on text that is locale-dependent and snapshotted per venue.
 */
export interface SaleForFiscalRecord {
  tenantId: TenantId;
  /** Where the sale rang — an informational snapshot on the immutable fiscal record. Kept beside
   * `nodeId` (node-id rekey, 2026-08-03): the chain/SIF are keyed by node, the till is where it
   * rang. */
  tillId: TillId;
  /** Which node processed and chained this sale — the chain/SIF key (node-id rekey, 2026-08-03;
   * the SIF is the node, #33). */
  nodeId: NodeId;
  saleId: SaleId;
  seriesId: SeriesId;
  seriesCode: string;
  invoiceNumber: number;
  /** UTC. The offset travels beside it because the huso is fiscally meaningful, not display. */
  issuedAt: Date;
  offsetMinutes: number;
  descriptionOfOperation: string;
  total: Decimal;
  vatBreakdown: readonly VatBreakdownLine[];
  /** Null for a simplified invoice, which is the ordinary case at a till. */
  counterparty: Counterparty | null;
}

export interface FiscalRecordRef {
  backend: string;
  /**
   * Opaque to the POS, like `NodeRegistration.registrationId` — deliberately plain `string`
   * rather than the `FiscalRecordId` branded type `@waitron/shared` already exports. That brand's
   * own constructor (`fiscalRecordId()`) validates its input as a UUID, which is the right
   * constraint for a value this repo mints itself, but wrong here: a real backend's own identifier
   * for what it recorded is regime-shaped, not this repo's — a sequence-derived value, a device
   * plus counter pair, or something else again — and none of that has any reason to be
   * UUID-shaped, so forcing one would be a generic-layer decision about a regime-owned value.
   * `FiscalRecordId` remains available for whatever DB-level column later tasks give an actual
   * UUID primary key; this field is not that.
   */
  recordId: string;
  state: FiscalState;
  issuedAt: Date;
  offsetMinutes: number;
  /** Where a customer can verify the record, when the regime offers such a thing. */
  verificationUrl?: string;
}

/**
 * An issue found by `checkIntegrity`, as a code plus params rather than an AppError instance — a
 * report is persisted and displayed, and an Error does not survive JSON. A caller that wants to
 * render one rehydrates it into an AppError at the display boundary.
 */
export interface IntegrityIssue {
  code: string;
  params: Record<string, unknown>;
  recordId?: string;
}

export interface IntegrityReport {
  ok: boolean;
  /** How many records were examined. `ok: true` with `checked: 0` is a true and normal answer;
   * `ok` alone could not distinguish it from a thorough check that found nothing wrong. */
  checked: number;
  issues: readonly IntegrityIssue[];
}

/**
 * The outcome of one `drain(now)` pass. `nextDueAt` is the only field a scheduler needs — when to
 * invoke `drain` again. `null` means nothing pending, but only when `skipped` is ALSO empty: a
 * tenant recorded in `skipped` was abandoned mid-pass with nothing scheduled for it (no gate, no
 * backoff row), so `nextDueAt` is never `null` while `skipped` is non-empty — an implementation
 * must fold in `now` plus its own configured skip-retry interval in that case rather than report
 * `null`, so a host sleeping on this field wakes up again rather than sleeping forever past a
 * tenant's art. 16.4 hour. That interval is the implementation's to choose and name — this package
 * neither defines nor depends on one. `now` alone is not enough either: a skip is frequently not
 * transient (a certificate nobody has provisioned answers the same way every pass), and a host
 * that wakes on `now` pins its loop at its MIN_TICK floor indefinitely. FOLD, never assign: the
 * reported instant is that interval, or anything EARLIER a successful tenant computed this same
 * pass — never the interval unconditionally — so a broken tenant's retry can never delay a healthy
 * tenant's own earlier gate. Mirrors `TickResult.nextDueAt` in `@waitron/scheduler`
 * in spirit, not exactly: `runDue` (`packages/scheduler/src/run.ts`) folds its own skip time the
 * identical way, but ONLY when `deferred` is zero — a tick with `deferred > 0` reports `now`
 * outright instead, discarding that fold entirely, because capped-but-runnable work takes priority
 * over a skip's own retry interval. `drain` has no `deferred` concept at all, so the fold described
 * above is unconditional here: a skip always contributes at least the skip-retry floor to
 * `nextDueAt`, with nothing else this pass could find that overrides it away. The counts are for a
 * log line and observability; a caller needing per-record detail reads the module's own tables.
 */
export interface DrainResult {
  nextDueAt: Date | null;
  batchesSent: number;
  recordsSubmitted: number;
  recordsAccepted: number; // includes accepted-with-errors — still counts as accepted
  recordsHalted: number; // records rejected or otherwise stopped
  incidentsRaised: number;
  /**
   * A tenant this pass abandoned before submitting anything for it — its transport could not be
   * built, or its sweep threw. Mirrors `TickResult.skipped` in `@waitron/scheduler`, and for the
   * same reason: a per-tenant failure has no ledger row of its own to carry it, so reporting it
   * here is the alternative to swallowing it. NEVER silent — a tenant with due fiscal work that
   * this pass could not submit is an unmet legal obligation.
   */
  skipped: { tenantId: TenantId; errorCode: string }[];
}

/**
 * How this POS classifies what a regime reports back about a submission — plan 3b's own settled
 * classification, independent of whatever raw code a particular regime uses for the same idea.
 * `"accepted_with_errors"` still counts as accepted, mirroring `DrainResult.recordsAccepted`'s
 * identical convention above.
 */
export type AckState = "accepted" | "accepted_with_errors" | "rejected" | "halted";

/**
 * One record `reconcile` found this POS and the regime disagreeing about, or that the regime has
 * nothing to say about at all. `localState`/`reportedState` are deliberately plain strings, like
 * `FiscalRecordRef.recordId` — this POS's own last-known state and whatever the regime reported
 * back are each a vocabulary a generic report should not force into `FiscalState` or `AckState`;
 * a backend maps its own codes onto whichever of those fits before handing this back.
 */
export interface ReconcileMismatch {
  recordId: string;
  localState: string;
  /** Null when the regime has no record of this one at all — the `noTrace` case below. */
  reportedState: string | null;
}

/**
 * The outcome of one `reconcile(tenantId, period)` pass — the read-side counterpart to
 * `DrainResult` above. `lostAck`/`noTrace`/`drift` are non-overlapping: a record still awaiting
 * acknowledgement that the regime has simply not reported on yet is ordinary in-flight state, not
 * any of the three. See `FiscalBackend.reconcile`'s own doc comment for the full classification.
 */
export interface ReconcileResult {
  year: string;
  month: string;
  checked: number;
  /** Still `pending` locally, but the regime already reports something for it — this POS's own
   * acknowledgement was lost, or never arrived. */
  lostAck: ReconcileMismatch[];
  /** `acknowledged` locally, but the regime has no trace of it at all. */
  noTrace: ReconcileMismatch[];
  /** `acknowledged` locally, but the regime's own report for it disagrees. */
  drift: ReconcileMismatch[];
  incidentsRaised: number;
}

/**
 * The only thing that crosses between the POS and a fiscal regime.
 *
 * Nothing in this file names an inter-record linking structure, a one-way digest, a derived
 * per-record signature, or an authority, and a guard test (./no-regime-vocabulary.test.ts)
 * enforces that mechanically. Structuring records that way is a regime requirement, not a POS
 * one: a second backend arrives with its own tables and its own vocabulary and changes nothing
 * here.
 *
 * `drain(now)` and `reconcile(tenantId, period)` were reserved names for the submission plan,
 * deliberately absent until that plan designed flow control, error-3000 resolution and the
 * file-export persistence rule — every one of which constrains their return types, and guessing
 * at a signature before that design existed would mean implementing against one that changes
 * anyway. Both are now filled in below, their shapes settled by that design (`DrainResult` and
 * `ReconcileResult` above) — no reserved names remain. An interface method with no caller and no
 * meaningful fake is dead surface that mutation testing cannot reach: exactly the shape of
 * vacuous test this project must not add another instance of. Do not introduce `flush`, `sync` or
 * `push` in either method's place.
 */
export interface FiscalBackend {
  /** This backend's identifying string — what `sales.fiscal_backend` records, and the value the
   * `backend` field of every `NodeRegistration`/`FiscalRecordRef` it returns carries. */
  readonly id: string;

  registerNode(
    tx: Transaction,
    nodeId: NodeId,
    params: { tenantId: TenantId },
  ): Promise<NodeRegistration>;

  /**
   * Takes a transaction handle. This is a deliberate leak: atomicity between the sale and the
   * fiscal record is the entire point of this interface, and hiding the transaction would let a
   * backend break it silently — the sale committed, the record not, discovered at an audit.
   */
  recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef>;

  /**
   * The reprint data for an ALREADY-FILED sale — the verification link a customer scans and the exact
   * VAT breakdown that was filed. For an idempotent replay (a lost-response pay retry that reprints
   * the ticket WITHOUT re-filing — park & retrieve, spec §3), this is the only way the replayed
   * receipt can carry the regime's mandatory QR and the authoritative desglose: both live only on the
   * regime's own immutable record, which the generic caller may not read across this boundary, and
   * `FiscalRecordRef` is minted at filing time and long gone by the time a retry arrives.
   *
   * Returns the figures EXACTLY as filed, never a recomputation: `vatBreakdown` is the stored
   * difference-method desglose (tax = gross − base), which can diverge by up to a cent from a naive
   * base×rate recompute over a multi-line same-rate group. A replayed legal receipt must show what was
   * filed, not a value that merely approximates it.
   *
   * `undefined` when the sale has no filed record to reprint (no `recordSale` ran for it) — the caller
   * keeps whatever fallback it had. Takes the transaction, like the write methods and unlike
   * `pendingCount`: a replay resolves the settled sale and reads its record in ONE transaction.
   *
   * READ-ONLY. It files nothing, appends nothing and re-hashes nothing — the immutable record (§5) is
   * only read back. `verificationUrl` here is a plain non-optional `string` (unlike
   * `FiscalRecordRef.verificationUrl`, optional because a regime may offer none): this method returns a
   * value only when a filed record exists, and a regime that mints no QR simply need not implement a
   * receipt read-back at all.
   */
  filedReceiptFor(
    tx: Transaction,
    saleId: SaleId,
  ): Promise<{ verificationUrl: string; vatBreakdown: VatBreakdownLine[] } | undefined>;

  recordVoid(tx: Transaction, saleId: SaleId, reason: string): Promise<FiscalRecordRef>;

  /**
   * Records a corrective fiscal record — a credit note, the rectificativa of a prior sale. Like
   * `recordSale` it takes the transaction: atomicity between the corrective sale and its fiscal
   * record is the entire point, exactly as for a sale. `sale` is the corrective invoice's OWN data
   * — its own new number, its own (negative) total and breakdown — while `correction.correctsSaleId`
   * names the earlier sale being corrected. The regime maps this onto its own corrective mechanism;
   * no fiscal condition blocks it (spec §4), a correction being a staff remedy the till must always
   * be able to issue.
   *
   * Regime-neutral in name and shape, like every method here: nothing about a corrective mechanism's
   * own vocabulary leaks across this boundary (the guard in ./no-regime-vocabulary.test.ts enforces
   * it), and `SaleForFiscalRecord` is reused unchanged — a corrective's negative total and breakdown
   * fit its existing shape with no new field.
   */
  recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId },
  ): Promise<FiscalRecordRef>;

  /**
   * Records a substitution fiscal record — a full invoice issued in place of one or more prior
   * simplified sales, at a customer's later request for a proper invoice naming them. Like
   * `recordSale`/`recordCorrection` it takes the transaction: atomicity between the substitution
   * sale and its fiscal record is the entire point. `sale` is the full invoice's OWN data — its own
   * new number, its own POSITIVE total and breakdown, and (unlike every other method here) a
   * NON-null `counterparty`, because a full invoice must always name its recipient — while
   * `substitution.substitutedSaleIds` names the earlier simplified sales it replaces (one or many,
   * the N:1 fan-out a correction's single `correctsSaleId` does not have).
   *
   * A substitution is NOT a correction and issues no credit note: the replaced sales are neither
   * edited nor annulled, they remain recorded exactly once, and the regime avoids double-counting
   * the amount because the record identifies ITSELF as a substitution naming what it replaces — not
   * because anything is negated. The replaced sales must therefore already have a prior
   * `recordSale`, like the sale a correction points at; a backend that cannot issue a full
   * substitution for one of them refuses rather than mis-filing an unrepairable record.
   *
   * Regime-neutral in name and shape, like every method here (the guard in
   * ./no-regime-vocabulary.test.ts enforces it), and `SaleForFiscalRecord` is reused unchanged — its
   * `counterparty` field, unused by the other methods, is finally the populated one here, with no
   * new interface field.
   */
  recordSubstitution(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    substitution: { substitutedSaleIds: SaleId[] },
  ): Promise<FiscalRecordRef>;

  /**
   * Whatever this backend must check about what it has already recorded, before recording
   * anything more. `tenantId` is passed explicitly — the caller is always inside a tenant-scoped
   * transaction and already holds it, so the backend need not re-derive it. `nodeId` because the
   * chain being verified is per-node (node-id rekey, 2026-08-03). The caller records the report and
   * surfaces it to staff; it must NEVER branch on `ok` to abandon the sale. No fiscal condition
   * blocks a sale (spec §4), and a backend whose regime has nothing to check answers
   * `{ ok: true, checked: 0, issues: [] }`.
   */
  checkIntegrity(tx: Transaction, tenantId: TenantId, nodeId: NodeId): Promise<IntegrityReport>;

  /**
   * How many records this node has not yet had confirmed. The UI reads this, never the module's
   * own tables. Takes `tenantId` and NO transaction: the unsent-count read happens outside any
   * sale transaction, and the backend needs the tenant to establish the row-level-security scope
   * itself (a query with no tenant scope silently counts zero under RLS). `nodeId` because the
   * chain is per-node (node-id rekey, 2026-08-03).
   */
  pendingCount(tenantId: TenantId, nodeId: NodeId): Promise<number>;

  /**
   * Submits everything currently due as of `now`, in batches, and returns when to run again. One
   * pass; the repeating cadence is the caller re-invoking on `nextDueAt`, driven by the database,
   * never an in-memory timer. A backend with nothing to submit answers `{ nextDueAt: null, …zeros }`.
   */
  drain(now: Date): Promise<DrainResult>;

  /**
   * Audits one calendar period against whatever the regime reports back for it, classifying every
   * disagreement into `lostAck`/`noTrace`/`drift` (see `ReconcileResult`). Takes `tenantId` and NO
   * transaction, like `pendingCount`: the read happens outside any sale transaction, and it is
   * scoped to the tenant as a whole rather than one till — a regime's own reporting works the same
   * way. A backend with nothing to check for the period answers `{ year, month, checked: 0,
   * lostAck: [], noTrace: [], drift: [], incidentsRaised: 0 }`.
   */
  reconcile(tenantId: TenantId, period: { year: string; month: string }): Promise<ReconcileResult>;
}
