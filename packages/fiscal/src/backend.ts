// Side-effect only: registers this package's `fiscal.*` codes on the shared `ErrorParams`
// registry by declaration merging. See errors.ts for why, and errors.reachability.test.ts for the
// mechanical check that keeps errors.ts reachable from this package's own public barrel
// (index.ts). errors.ts is already reachable via ./clock.ts's own such import; this second import
// is redundant for reachability specifically, but every file whose JSDoc references a `fiscal.*`
// code carries it anyway, mirroring packages/db/src/allocate-number.ts's convention of importing
// from the file that documents the codes it throws — even though, unlike that file, nothing in
// backend.ts itself throws (it is types only; ./testing/fake-backend.ts does the throwing).
import "./errors.js";
import type { Decimal, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";

/**
 * The lifecycle of a fiscal record as the POS understands it. Regime-neutral: `recorded` means
 * the legally-required record exists locally, which in Spain is the point at which the sale is
 * compliant regardless of whether anything has been sent anywhere.
 */
export type FiscalState = "recorded" | "pending" | "acknowledged" | "rejected";

export interface TillRegistration {
  backend: string;
  tillId: TillId;
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
  tillId: TillId;
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
   * Opaque to the POS, like `TillRegistration.registrationId` — deliberately plain `string`
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
 * The only thing that crosses between the POS and a fiscal regime.
 *
 * Nothing in this file names an inter-record linking structure, a one-way digest, a derived
 * per-record signature, or an authority, and a guard test (./no-regime-vocabulary.test.ts)
 * enforces that mechanically. Structuring records that way is a regime requirement, not a POS
 * one: a second backend arrives with its own tables and its own vocabulary and changes nothing
 * here.
 *
 * `drain(now)` and `reconcile(period)` are reserved names for the submission plan and are
 * deliberately absent until that plan designs flow control, error-3000 resolution and the
 * file-export persistence rule — every one of which constrains their return types, and guessing
 * now would mean implementing against a signature that changes anyway. An interface method with
 * no caller and no meaningful fake is dead surface that mutation testing cannot reach: exactly the
 * shape of vacuous test this project must not add another instance of. Do not introduce `flush`,
 * `sync` or `push` in their place.
 */
export interface FiscalBackend {
  registerTill(
    tx: Transaction,
    tillId: TillId,
    params: { tenantId: TenantId },
  ): Promise<TillRegistration>;

  /**
   * Takes a transaction handle. This is a deliberate leak: atomicity between the sale and the
   * fiscal record is the entire point of this interface, and hiding the transaction would let a
   * backend break it silently — the sale committed, the record not, discovered at an audit.
   */
  recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef>;

  recordVoid(tx: Transaction, saleId: SaleId, reason: string): Promise<FiscalRecordRef>;

  /**
   * Whatever this backend must check about what it has already recorded, before recording
   * anything more. The caller records the report and surfaces it to staff; it must NEVER branch
   * on `ok` to abandon the sale. No fiscal condition blocks a sale (spec §4), and a backend whose
   * regime has nothing to check answers `{ ok: true, checked: 0, issues: [] }`.
   */
  checkIntegrity(tx: Transaction, tillId: TillId): Promise<IntegrityReport>;

  /**
   * How many records this till has not yet had confirmed. The UI reads this, never the module's
   * own tables — verification stays entirely inside the module, and a UI reaching past this
   * method would drag both a regime vocabulary and a schema dependency into the presentation
   * layer at once.
   */
  pendingCount(tillId: TillId): Promise<number>;
}
