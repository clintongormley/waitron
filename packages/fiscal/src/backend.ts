import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Decimal, NodeId, SaleId, SaleOrigin, SeriesId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { RecipientIdentifierType } from "@waitron/country";
import type { VatBreakdownLine } from "./vat-breakdown.js";
import type { TrustedReading } from "./clock.js";
import type { ClockWitness } from "./clock-witnesses.js";

export type { VatBreakdownLine };

export class IssuanceRefusedError extends AppError {}

/** `recorded` means the required record exists locally, whether or not anything has been sent. */
export type FiscalState = "recorded" | "pending" | "acknowledged" | "rejected";

export interface NodeRegistration {
  backend: string;
  nodeId: NodeId;
  /** Opaque to the POS. */
  registrationId: string;
  registeredAt: Date;
}

/** An observation of an issued invoice; it grants no allocation or recovery authority. */
export interface FiledInvoiceEvidence {
  taxpayerId: string;
  environment: string;
  series: string;
  invoiceNumber: string;
  issuedDate: string;
  /** Opaque observation supplied by the backend, without interpretation by the POS. */
  recordEvidence: string;
}

/** Receipt facts read from a backend's stored fiscal record. */
export interface FiledReceipt {
  verificationUrl: string;
  vatBreakdown: VatBreakdownLine[];
  /** The stored issuer identity, omitted when the backend stores none. */
  issuer?: { legalName: string; taxId: string };
}

/** Whether a regime's filing of an invoice allows a correction of it; read-only. */
export type CorrectionAdmission =
  | {
      eligible: true;
      filing: "queued" | "sending" | "accepted" | "accepted_with_issues";
      original: { number: string; issuedAt: string };
    }
  | {
      eligible: false;
      reason:
        | "unsupported"
        | "missing"
        | "wrong_node"
        | "voided"
        | "not_simplified"
        | "filing_refused"
        | "filing_versions_unusable";
    };

/** The total and VAT split of one filed version of an invoice. */
export interface FiledVersionFigures {
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
}

/**
 * A sale's filed figures: its newest version's, and those of the newest version the authority
 * accepted (null when none has been). Unreadable when the versions are not one line of fixes, or a
 * version's split is not one the regime itself files for an ordinary taxed sale (one base and VAT
 * per rate, nothing else), or does not sum to its totals.
 */
export type FiledFigures =
  | { readable: true; newest: FiledVersionFigures; newestAnswered: FiledVersionFigures | null }
  | { readable: false };

/** The words a regime prints above and under its verification QR, in the regime's own wording. */
export interface ReceiptQrText {
  caption: string;
  legend: string;
}

export interface Counterparty {
  taxId: string;
  legalName: string;
  countryCode: string;
  identifierType?: RecipientIdentifierType;
  identifierCountryCode?: string;
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
  /** Records still being filed or whose local snapshot changed during the lookup, omitted when
   * none were deferred. They were not classified or corrected from the older observation. */
  deferred?: string[];
  /** Confirmed conflicting invoice contents retained for the administrator procedure. */
  conflicts?: ReconcileMismatch[];
}

export type ClockConfirmationSource = "authority" | "devices" | "admin" | "staff" | "elapsed";

/** The box's boot-time clock: milliseconds since boot, and the boot's id when the milliseconds
 * come from a source that has one. */
export interface BootReading {
  ms: number;
  id: string | null;
}

/** An administrator's device's time against the box's: `boxAt` the box's time at the midpoint of
 * the round trip in which the device read its clock, not the request's `reading`; `uncertaintyMs`
 * how far either way it may be off. */
export interface ClockAdminReading {
  boxAt: string;
  witnessAt: string;
  uncertaintyMs: number;
}

/** The person who confirmed the box's clock: an administrator, or a staff member (`role:
 * "staff"`) on a till; `device` names the till when the reading came from one. */
export interface ClockAdminConfirm {
  personId: string;
  personName: string;
  reading: ClockAdminReading;
  role?: "staff";
  device?: { deviceId: string; deviceLabel: string | null; address: string | null };
}

/** A step of the box's clock from `before` to `after`, read on the boot-time clock either side.
 * `stepMs` is the measured step; `verified` false when the box could not confirm the step took.
 * `admin` names the person for the `admin` and `staff` sources, with `role: "staff"` for `staff`,
 * and for a `setup` step on first setup. A `setup` step, made from the setup or restore page before
 * the venue exists, goes to the setup note and is never handed to a regime. */
export interface ClockStepRequest {
  before: Pick<TrustedReading, "instant" | "offsetMinutes">;
  after: Pick<TrustedReading, "instant" | "offsetMinutes">;
  bootBefore: BootReading;
  bootAfter: BootReading;
  targetAt: string;
  stepMs: number;
  verified: boolean;
  reason: "unusable" | "start";
  source: "admin" | "staff" | "setup";
  witnesses: readonly ClockWitness[];
  admin?: ClockAdminConfirm;
  nodeId: string;
}

/** What a step recorded: its confirmation row, null when unverified, and its `clock.corrected`
 * alert, null when an unverified step moved the clock by a second or less. */
export interface ClockStepRecorded {
  confirmation: ClockConfirmation | null;
  corrected: { id: string; params: Readonly<Record<string, unknown>> } | null;
}

/** A step the box made to its own clock: when it was confirmed, by the clock after it, and by how
 * much it moved the clock (negative for back). */
export interface ClockStep {
  confirmedAt: string;
  stepMs: number;
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

export interface ReturnedInvoiceRecord {
  recordId: string;
  saleId: string;
  sourceNodeId: string;
  sourceName: string;
  generationId: string;
  installation: string;
  sequence: number;
  invoiceNumber: string;
  issueDate: string;
  kind: string;
  category: "invoice" | "simplified" | "replacement" | "correction" | "cancellation";
  correctsRecordId: string | null;
  taxable: string | null;
  gross: string | null;
  tax: string | null;
  receivedAt: string;
}

/**
 * The sale-path boundary between the POS and a fiscal regime. It names no regime mechanism; the
 * guard is ./no-regime-vocabulary.test.ts. The submission pass (`drain`) is not on it: that runs
 * outside the sale path, through `FiscalContribution`.
 */
export interface FiscalBackend {
  hasReturnedInvoices?(tx: Transaction): Promise<boolean>;
  returnedInvoices?(
    tx: Transaction,
    page: { offset: number; limit: number },
  ): Promise<ReturnedInvoiceRecord[]>;
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

  /** Throws an `IssuanceRefusedError` when `nodeId` may not issue a new fiscal record: a sale, a
   * payment that leads to one, a void or a correction. */
  refuseNewIssuance(tx: Transaction, nodeId: NodeId): Promise<void>;

  /** Throws an `IssuanceRefusedError` when `nodeId` may not give money back. A refund issues no
   * fiscal record, so this refuses less than `refuseNewIssuance`. */
  refuseNewRefund(tx: Transaction, nodeId: NodeId): Promise<void>;

  /**
   * Throws this regime's refusal when a record stamped with `reading` could never be accepted, so a
   * caller can refuse before money moves. A regime with no such rule returns.
   */
  assertRecordableAt(reading: Pick<TrustedReading, "instant" | "offsetMinutes">): void;

  /** Throws this regime's refusal when nothing may take or give back money at `reading`. */
  refuseUntilRecordable(
    tx: Transaction,
    reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
  ): Promise<void>;

  /** Records a step of the box's clock: one confirmation row when the step was verified, and
   * `clock.corrected` for a verified step or an unverified one of more than a second, answering
   * both. Absent when the regime keeps no record of clock steps. */
  confirmClockStep?(tx: Transaction, input: ClockStepRequest): Promise<ClockStepRecorded>;

  /** The latest step `confirmClockStep` recorded that moved the clock, verified or not, by the
   * order they were written, never by their dates; null when none has. Only steps the box made are
   * recorded: one by the time service, or by a person on the host, is never answered here. */
  latestClockStep?(tx: Transaction): Promise<ClockStep | null>;

  /** Each node's highest record position. Absent when the regime keeps no record positions. */
  recordHeads?(tx: Transaction): Promise<Record<string, number>>;

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
  /** Optional receipt observation, independent of allocation and the original receipt result. */
  invoiceEvidenceFor?(tx: Transaction, saleId: SaleId): Promise<FiledInvoiceEvidence | undefined>;

  /**
   * Whether `issuingNodeId`, the box that would issue the correction, may correct the sale.
   * Optional: a backend without it admits no correction (`unsupported`).
   */
  correctionAdmissionFor?(
    tx: Transaction,
    saleId: SaleId,
    issuingNodeId: NodeId,
  ): Promise<CorrectionAdmission>;

  /** The filed figures of each sale in `saleIds`; a sale with nothing filed is absent. Reads only. */
  filedFiguresFor?(
    tx: Transaction,
    saleIds: readonly SaleId[],
  ): Promise<ReadonlyMap<SaleId, FiledFigures>>;

  /**
   * Cancels a sale. The cancellation is issued by `issuingNodeId`, the box running now, and goes on
   * that box's chain, which may differ from the box that filed the sale; it still cites the
   * original invoice exactly.
   */
  recordVoid(
    tx: Transaction,
    saleId: SaleId,
    reason: string,
    issuingNodeId: NodeId,
  ): Promise<FiscalRecordRef>;

  /**
   * Records a corrective invoice of a prior sale. `sale` is the corrective invoice's OWN data — its
   * own number and its own negative total and breakdown — while `correction.correctsSaleId` names
   * the sale being corrected. With `replaces`, the corrective is by replacement: `sale` carries the
   * invoice's full, correct amounts in place of the original's rather than a change to them.
   */
  recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId; replaces?: true },
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
   * `ok` to abandon the sale.
   * A backend with nothing to check answers `{ ok: true, checked: 0, issues: [] }`.
   */
  checkIntegrity(tx: Transaction, nodeId: NodeId): Promise<IntegrityReport>;

  /**
   * Throws when this backend's producer settings are malformed, and, in production, when this
   * node's open chain was made under a different software producer from the one this backend files
   * under. Reads only. Optional: a backend that names no producer omits it.
   */
  checkFilingIdentity?(tx: Transaction, nodeId: NodeId): Promise<void>;

  /** How many records this node has not yet had confirmed. */
  pendingCount(nodeId: NodeId): Promise<number>;
}
