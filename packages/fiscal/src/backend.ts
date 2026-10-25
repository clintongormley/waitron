import "./errors.js";
import type { Decimal, NodeId, SaleId, SaleOrigin, SeriesId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { VatBreakdownLine } from "./vat-breakdown.js";
import type { TrustedReading } from "./clock.js";
import type { ClockWitness } from "./clock-witnesses.js";

export type { VatBreakdownLine };

/** `recorded` means the required record exists locally, whether or not anything has been sent. */
export type FiscalState = "recorded" | "pending" | "acknowledged" | "rejected";

export interface NodeRegistration {
  backend: string;
  nodeId: NodeId;
  /** Opaque to the POS. */
  registrationId: string;
  registeredAt: Date;
}

/** Receipt facts read from a backend's stored fiscal record. */
export interface FiledReceipt {
  verificationUrl: string;
  vatBreakdown: VatBreakdownLine[];
  /** The stored issuer identity, omitted when the backend stores none. */
  issuer?: { legalName: string; taxId: string };
}

/** The words a regime prints above and under its verification QR, in the regime's own wording. */
export interface ReceiptQrText {
  caption: string;
  legend: string;
}

export interface Counterparty {
  taxId: string;
  legalName: string;
  countryCode: string;
}

/**
 * Everything a regime could plausibly need about a completed sale, in exact decimals. Line
 * descriptions are deliberately absent: they are a receipt-rendering concern.
 */
export interface SaleForFiscalRecord {
  /** Where the sale came from: informational, never part of a fiscal record's hash. */
  origin: SaleOrigin;
  /** The node recording this sale: the chain key, not the till. */
  nodeId: NodeId;
  saleId: SaleId;
  seriesId: SeriesId;
  seriesCode: string;
  invoiceNumber: number;
  /** UTC. The offset travels beside it because the time zone is fiscally meaningful, not display. */
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
   * Opaque to the POS, so a plain `string` rather than the `FiscalRecordId` brand, whose
   * constructor requires a UUID: a backend's own identifier for a record need not be one.
   */
  recordId: string;
  state: FiscalState;
  issuedAt: Date;
  offsetMinutes: number;
  /** Where a customer can verify the record, when the regime offers such a thing. */
  verificationUrl?: string;
}

/** A code plus params rather than an AppError, because an Error does not survive JSON. */
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
 * The outcome of one `drain(now)` pass. `nextDueAt` is when to invoke `drain` again, and is never
 * `null` while `skipped` is non-empty: an implementation folds in `now` plus its own skip-retry
 * interval as a MINIMUM with any earlier instant the pass computed, so a host sleeping on this
 * field wakes again and an abandoned pass's retry never delays an earlier one.
 */
export interface DrainResult {
  nextDueAt: Date | null;
  /**
   * 1 if this pass found due work, whatever became of it; 0 if it found none or never looked. The
   * awaiting-certificate flag (`apps/server/src/pass.ts`) changes only when this is `> 0`, because
   * a pass with no work read no certificate.
   */
  tenantsWithWork: number;
  batchesSent: number;
  recordsSubmitted: number;
  recordsAccepted: number; // includes accepted-with-errors — still counts as accepted
  recordsHalted: number; // records rejected or otherwise stopped
  incidentsRaised: number;
  /**
   * A pass that abandoned the work it found, or (from `apps/server/src/restart-reset.ts`) one whose
   * restart reset failed. Such a failure has no ledger row of its own, so it is reported here
   * rather than swallowed.
   */
  skipped: { errorCode: string }[];
}

/** A function, not a shared constant, because callers mutate the result they get back. */
export function emptyDrainResult(): DrainResult {
  return {
    nextDueAt: null,
    tenantsWithWork: 0,
    batchesSent: 0,
    recordsSubmitted: 0,
    recordsAccepted: 0,
    recordsHalted: 0,
    incidentsRaised: 0,
    skipped: [],
  };
}

/**
 * How this POS classifies what a regime reports back about a submission, whatever raw code the
 * regime uses. `"accepted_with_errors"` still counts as accepted.
 */
export type AckState = "accepted" | "accepted_with_errors" | "rejected" | "halted";

/**
 * One record `reconcile` found this POS and the regime disagreeing about. The states are plain
 * strings because each side's vocabulary is the regime's, not `FiscalState` or `AckState`.
 */
export interface ReconcileMismatch {
  recordId: string;
  localState: string;
  /** Null when the regime has no record of this one at all. */
  reportedState: string | null;
}

/**
 * The outcome of one `reconcile(period)` pass. `lostAck`, `noTrace` and `drift` do not overlap, and
 * a record awaiting acknowledgement that the regime has not reported on yet is in none of them.
 */
export interface ReconcileResult {
  year: string;
  month: string;
  checked: number;
  /** Still `pending` locally, but the regime already reports something for it. */
  lostAck: ReconcileMismatch[];
  /** `acknowledged` locally, but the regime has no trace of it at all. */
  noTrace: ReconcileMismatch[];
  /** `acknowledged` locally, but the regime's own report for it disagrees. */
  drift: ReconcileMismatch[];
  incidentsRaised: number;
}

/** A clock reading, and the time of the latest record the regime holds, when the reading is more
 * than a minute earlier; each time with its own offset. */
export interface ClockBehindLatestRecord {
  readonly clockAt: string;
  readonly offsetMinutes: number;
  readonly lastRecordAt: string;
  readonly lastRecordOffsetMinutes: number;
}

/** What the witnesses say about a stop: nothing either way, against the box, enough to confirm
 * it, or a confirmation already covers the reading. */
export type ClockStopProof = "none" | "contrary" | "ready" | "confirmed";

export type ClockConfirmationSource = "authority" | "devices" | "admin" | "elapsed";

/** A clock reading more than a minute earlier than the latest record, what the witnesses say about
 * it, and the confirmation that covers it if one does. */
export interface ClockStopState {
  clockAt: string;
  offsetMinutes: number;
  lastRecordAt: string;
  lastRecordOffsetMinutes: number;
  recordId: string;
  gapMs: number;
  proof: ClockStopProof;
  agreeing: { authority: ClockWitness | null; devices: ClockWitness[] };
  contrary: { authority: ClockWitness | null; devices: ClockWitness[] };
  confirmation: {
    id: string;
    source: ClockConfirmationSource;
    personId: string | null;
    confirmedAt: string;
  } | null;
}

/** The box's boot-time clock: milliseconds since boot, and the boot's id when the milliseconds
 * come from a source that has one. */
export interface BootReading {
  ms: number;
  id: string | null;
}

export interface ClockConfirmRequest {
  reading: Pick<TrustedReading, "instant" | "offsetMinutes">;
  boot: BootReading;
  witnesses: readonly ClockWitness[];
  nodeId: string;
  admin?: ClockAdminConfirm;
}

/** An administrator's device's time against the box's: `boxAt` the box's time at the midpoint of
 * the round trip in which the device read its clock, not the request's `reading`; `uncertaintyMs`
 * how far either way it may be off. */
export interface ClockAdminReading {
  boxAt: string;
  witnessAt: string;
  uncertaintyMs: number;
}

export interface ClockAdminConfirm {
  personId: string;
  personName: string;
  reading: ClockAdminReading;
}

export interface ClockConfirmation {
  id: string;
  seq: number;
  source: ClockConfirmationSource;
  personId: string | null;
  confirmedAt: string;
  checkId: string | null;
  recordId: string | null;
}

export interface ClockCheckOpenRequest {
  reading: Pick<TrustedReading, "instant" | "offsetMinutes">;
  boot: BootReading;
  nodeId: string;
}

export interface ClockCheckCloseRequest {
  reading: Pick<TrustedReading, "instant" | "offsetMinutes">;
  boot: BootReading;
  witnesses: readonly ClockWitness[];
  nodeId: string;
}

/** A check whose stop ended by itself, waiting for a witness taken after it ended. */
export interface WaitingClockCheck {
  checkId: string;
  openedAt: string;
}

export interface MisdatedRecord {
  recordId: string;
  /** The invoice's series and number, as recorded. */
  invoiceNumber: string;
  generatedAt: string;
  offsetMinutes: number;
}

/** What a closing found: the wrongly dated records, or that the box cannot tell which they are. */
export type MisdatedRecords = { known: true; records: MisdatedRecord[] } | { known: false };

export interface MisdatedDetailRecord extends MisdatedRecord {
  kind: "issue" | "cancellation";
  /** The stored invoice issue date, YYYY-MM-DD; a cancellation's is the cancelled invoice's. */
  issueDate: string;
  /** The record's stored total, as hashed; null on a cancellation. */
  amount: string | null;
}

export type MisdatedDetail =
  | {
      known: true;
      closing: {
        source: ClockConfirmationSource;
        personId: string | null;
        confirmedAt: string;
        correctedStart: string;
        partial: boolean;
        /** The offset the check stored when it opened; null when it stored none. */
        startOffsetMinutes: number | null;
      };
      records: MisdatedDetailRecord[];
    }
  | { known: false };

export interface ClockProvedWrong {
  trustedUntil: Date;
  observedAt: Date;
  reason: "jump" | "authority";
}

/** One reading of the tax authority's time, against the box's wall clock (`Date.now()`) and steady
 * clock (`performance.now()`) read together at the comparison's midpoint. */
export interface AuthorityTimeSample {
  readonly authorityMs: number;
  readonly uncertaintyMs: number;
  readonly at: { readonly wallMs: number; readonly monoMs: number };
}

/**
 * The sale-path boundary between the POS and a fiscal regime. It names no regime mechanism; the
 * guard is ./no-regime-vocabulary.test.ts. The submission pass (`drain`) is not on it: that runs
 * outside the sale path, through `FiscalContribution`.
 */
export interface FiscalBackend {
  /**
   * What `sales.fiscal_backend` records, and the `backend` field of every
   * `NodeRegistration`/`FiscalRecordRef` it returns.
   */
  readonly id: string;

  /** Printed around `verificationUrl`'s QR, and never without one; absent when the regime prints none. */
  readonly receiptQrText?: ReceiptQrText;

  /**
   * The largest total this regime records for a sale with no named customer (a simplified invoice),
   * or `null` when it sets none. A total equal to it is allowed; one a cent over is refused before
   * anything commits or money moves (`refuseOverSimplifiedLimit`, `@waitron/core`).
   */
  readonly simplifiedInvoiceLimit: Decimal | null;

  /** The most characters (Unicode code points) a named customer's legal name may have on this
   * regime's record, or `null` when it sets no cap. */
  readonly recipientNameMaxLength: number | null;

  /**
   * Throws this regime's refusal when a record stamped with `reading` could never be accepted, so a
   * caller can refuse before money moves. A regime with no such rule returns.
   */
  assertRecordableAt(reading: Pick<TrustedReading, "instant" | "offsetMinutes">): void;

  /** The reading and this regime's latest record time when the reading is more than a minute
   * earlier; null when it is not, or when the regime keeps no such records. */
  clockBehindLatestRecord(
    tx: Transaction,
    reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
  ): Promise<ClockBehindLatestRecord | null>;

  /** Throws this regime's refusal when nothing may take or give back money at `reading`. */
  refuseWhileClockBehind(
    tx: Transaction,
    reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
  ): Promise<void>;

  /** What the clock row shows while the reading is behind the latest record; null when it is not.
   * Absent when the regime never stops a clock. */
  clockStopState?(
    tx: Transaction,
    reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
    witnesses: readonly ClockWitness[],
  ): Promise<ClockStopState | null>;

  /** Confirms the clock during a stop, which lifts it: automatically when the witnesses are ready
   * (null, and nothing written, otherwise), or on `admin`'s device. With `admin`, an unusable
   * reading is refused first, and the confirmation may then be refused with this regime's
   * refusal. With `admin` and no stop, closes a check that waits instead. */
  confirmClockStop?(
    tx: Transaction,
    input: ClockConfirmRequest,
  ): Promise<{ confirmation: ClockConfirmation | null }>;

  /** Records when a stop began: opens a check while the stop holds and none is open, and answers
   * the open one; null, and nothing written, while there is no stop. */
  openClockCheck?(tx: Transaction, input: ClockCheckOpenRequest): Promise<{ id: string } | null>;

  /** Closes a check that waits on a witness taken after its stop ended; with none, writes nothing. */
  closeClockCheckByItself?(
    tx: Transaction,
    input: ClockCheckCloseRequest,
  ): Promise<{ confirmation: ClockConfirmation | null }>;

  /** The check whose stop ended by itself and that no confirmation has closed; null when none. */
  waitingClockCheck?(
    tx: Transaction,
    reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
  ): Promise<WaitingClockCheck | null>;

  /** The records the confirmation `confirmationId` found wrongly dated, from stored values only;
   * null when no confirmation has the id. */
  misdatedRecords?(tx: Transaction, confirmationId: string): Promise<MisdatedRecords | null>;

  /** misdatedRecords' list with each record's kind, issue date and amount, and the closing's own
   * values; reads only. Null when no confirmation has the id. */
  misdatedDetail?(tx: Transaction, confirmationId: string): Promise<MisdatedDetail | null>;

  /** The clock was proved wrong after `trustedUntil`, noticed at `observedAt`; answers the
   * confirmation ids it recorded, those with nothing written under them, and those another open
   * issue holds. */
  noteClockProvedWrong?(
    tx: Transaction,
    input: ClockProvedWrong,
  ): Promise<{ recorded: string[]; unused: string[]; held: string[] }>;

  /** One reading of the tax authority's time; null when it could not be read. Absent when the
   * regime has no authority whose time it can read. */
  readAuthorityTime?(): Promise<AuthorityTimeSample | null>;

  registerNode(tx: Transaction, nodeId: NodeId): Promise<NodeRegistration>;

  /**
   * Takes a transaction handle. This is a deliberate leak: atomicity between the sale and the
   * fiscal record is the entire point of this interface, and hiding the transaction would let a
   * backend break it silently — the sale committed, the record not, discovered at an audit.
   */
  recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef>;

  /**
   * The reprint data for an already-filed sale, so a replayed receipt can carry what the regime's
   * own record holds. Read-only, and EXACTLY as filed, never recomputed: a replayed receipt must
   * show what was filed. `undefined` when the sale has no filed record.
   */
  filedReceiptFor(tx: Transaction, saleId: SaleId): Promise<FiledReceipt | undefined>;

  recordVoid(tx: Transaction, saleId: SaleId, reason: string): Promise<FiscalRecordRef>;

  /**
   * Records a corrective invoice of a prior sale. `sale` is the corrective invoice's OWN data — its
   * own number and its own negative total and breakdown — while `correction.correctsSaleId` names
   * the sale being corrected.
   */
  recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId },
  ): Promise<FiscalRecordRef>;

  /**
   * Records a full invoice issued in place of one or more prior simplified sales. `sale` is the
   * full invoice's OWN data, with a positive total and a non-null `counterparty`, while
   * `substitution.substitutedSaleIds` names the sales it replaces. It is not a correction: the
   * replaced sales are neither edited nor annulled, and the record avoids double-counting by
   * naming what it replaces. A backend that cannot issue a full substitution for one of the
   * replaced sales refuses rather than mis-filing an unrepairable record.
   */
  recordSubstitution(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    substitution: { substitutedSaleIds: SaleId[] },
  ): Promise<FiscalRecordRef>;

  /**
   * Whatever this backend must check about what it has already recorded, before recording
   * anything more. The caller records the report and surfaces it to staff; it must NEVER branch on
   * `ok` to abandon the sale: no fiscal condition blocks a sale.
   * A backend with nothing to check answers `{ ok: true, checked: 0, issues: [] }`.
   */
  checkIntegrity(tx: Transaction, nodeId: NodeId): Promise<IntegrityReport>;

  /** How many records this node has not yet had confirmed. */
  pendingCount(nodeId: NodeId): Promise<number>;
}
