import { withIssuanceTransaction } from "@waitron/core";
import { type Database, type Transaction, billPayments } from "@waitron/db";
import {
  type PaymentProvider,
  type CollectParams,
  type PaymentResultState,
  findPaymentByBillPayment,
  type PaymentResult,
} from "@waitron/payments";
import {
  workingOrderId as brandWorkingOrderId,
  centsToDecimal,
  isAppError,
  AppError,
} from "@waitron/shared";
import { eq } from "drizzle-orm";
import { afterCardCharged, collectFailure } from "./bill-payment-failures.js";
import type { PaymentRow } from "./bill-payment-rows.js";
import { failBillPayment, completeBillPayment } from "./bill-payment-settlement.js";
import type {
  BillPaymentDeps,
  BillPaymentRequest,
  CounterPayment,
  BillPaymentResult,
  SettledBill,
} from "./bill-payment-types.js";
import { diskFullBeforePayment, beginBillPayment, resultOf } from "./bill-payments.js";
import { refuseForDiskStop } from "./disk-full-state.js";
import { perDatabase, claimLive } from "./live-in-process.js";
import {
  type SettledSlipPrinter,
  withSettledSlip,
  freezeWantedSlip,
} from "./payment-slip-print.js";
import type { GuestCountChoice } from "./receipt-guests.js";
import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite } from "./trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import "./errors.js";

/** The card bill payments at a reader in this process, by id: a pending payment missing here is
 * one no attempt is still driving. */
const liveBillPaymentsOf = perDatabase(() => new Set<string>());
/** Whether a card for this bill payment is at a reader in this process. */
export function billPaymentIsLive(db: Database, billPaymentId: string): boolean {
  return liveBillPaymentsOf(db).has(billPaymentId);
}
/** {@link takeReaderBillPayment}'s deps: the fiscal ones, and the reader's provider. */
export type ReaderBillPaymentDeps = BillPaymentDeps & {
  provider: PaymentProvider;
  onReaderCheckout?: CollectParams["onReaderCheckout"];
  settleCapturedReplay?: (
    tx: Transaction,
    paymentId: string,
    now: Date,
    print: SettledSlipPrinter,
    guestCount: GuestCountChoice,
  ) => Promise<TillSaleResult | null>;
  /** The chosen reader's vendor reference, passed to `collect`; absent for the simulator. */
  readerRef?: string;
  /** The device profile the route checked the request under, passed to `collect`. */
  deviceProfileId?: string;
  /** The chosen reader's `card_readers.id`, passed to `collect`; absent for the simulator. */
  readerId?: string;
  /**
   * Report a known charge separately when storage, the clock or held issuance prevents its invoice.
   */
  sayCardChargedNotRecorded?: boolean;
};
/** These outcomes leave no retained charge to allocate to the bill. */
const NO_RETAINED_CHARGE: ReadonlySet<PaymentResultState> = new Set([
  "failed",
  "network_unavailable",
  "refunded",
]);
/** `insertAttempting` (`@waitron/payments`) refuses these before the provider's first write: the
 * SumUp and Stripe terminal providers call it before any write or network call, and the reader
 * codes also come from `assertReaderStartable`, which the test provider calls first. So no money
 * moved, and the reservation can go now rather than at the loop's next pass. */
const REFUSED_START: ReadonlySet<string> = new Set([
  "device.profile_changed",
  "reader.not_held",
  "reader.payment_in_progress",
]);
/**
 * A retry of a payment already taken, whose own sign-in is open on an active till (the first sign-in
 * or a later one), answers its state and never collects again.
 */
export async function takeReaderBillPayment(
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  basket: CounterPayment | undefined,
): Promise<BillPaymentResult | SettledBill>;

export async function takeReaderBillPayment(
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
): Promise<BillPaymentResult>;

export async function takeReaderBillPayment(
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  basket?: CounterPayment,
): Promise<BillPaymentResult | SettledBill> {
  const hold: ReaderPaymentHold = { release: () => {}, capturedReplay: false };
  try {
    // Read before the queue wait; `noted()` then catches a refusal noted while this payment waited.
    const pending = diskFullBeforePayment(deps);
    const preRead = pending !== false && (await pending);
    const begun = await withSettledSlip((print) =>
      withIssuanceTransaction(
        deps.db,
        (tx) =>
          beginReaderBillPayment(tx, deps, cfg, workingOrderId, req, operator, {
            preRead,
            basket,
            print,
            hold,
          }),
        deps.log,
      ),
    );
    if (begun.kind === "replay") return begun.result;
    return await collectBegunReaderPayment(deps, cfg, begun);
  } catch (error) {
    if (!hold.capturedReplay) throw error;
    return afterCardCharged(deps, workingOrderId, () => Promise.reject(error));
  } finally {
    hold.release();
  }
}
/**
 * What {@link beginReaderBillPayment} leaves its caller, set even when it throws: `release` frees
 * the live claim on the payment it inserted, once the collect step is over or the transaction
 * failed; `capturedReplay` says a failure is reported as a card charged but not recorded.
 */
export interface ReaderPaymentHold {
  release: () => void;
  capturedReplay: boolean;
}
/** A reader payment begun in its caller's transaction: a replay's answer, or a charge to collect. */
export type BegunReaderPayment =
  | { kind: "replay"; result: BillPaymentResult | SettledBill }
  | {
      kind: "collect";
      workingOrderId: string;
      req: BillPaymentRequest;
      operator: { personId: string };
      payment: PaymentRow;
      slip: Awaited<ReturnType<typeof freezeWantedSlip>>;
    };
/**
 * The first transaction of {@link takeReaderBillPayment}: inserts the pending payment, or answers
 * a retry. It calls no provider; {@link collectBegunReaderPayment} does, after `tx` commits.
 */
export async function beginReaderBillPayment(
  tx: Transaction,
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  req: BillPaymentRequest,
  operator: { personId: string; sessionId: string },
  options: {
    /** The full-disk refusal read before the transaction opened ({@link diskFullBeforePayment}). */
    preRead: boolean;
    basket?: CounterPayment;
    print: SettledSlipPrinter;
    hold: ReaderPaymentHold;
    /** The retry fingerprint to store and compare in place of the request's own. */
    fingerprint?: string;
  },
): Promise<BegunReaderPayment> {
  const { preRead, basket, print, hold } = options;
  const started = await beginBillPayment(
    tx,
    deps,
    cfg,
    workingOrderId,
    req,
    operator,
    "pending",
    () => deps.clock.now(),
    { diskFull: () => preRead || (deps.disk?.noted() ?? false), log: deps.log },
    deps.attendance,
    basket,
    options.fingerprint,
  );
  if ("settled" in started) return { kind: "replay", result: started.settled };
  if ("replay" in started) {
    let payment = started.replay;
    let invoice: TillSaleResult | null = null;
    if (
      payment.state === "pending" &&
      req.kind === "share" &&
      req.shareOf === 1 &&
      deps.settleCapturedReplay !== undefined &&
      !billPaymentIsLive(deps.db, payment.id) &&
      (await findPaymentByBillPayment(tx, payment.id))?.state === "captured"
    ) {
      hold.capturedReplay = true;
      const reading = deps.clock.now();
      await deps.backend.refuseUntilRecordable(tx, reading);
      invoice = await deps.settleCapturedReplay(
        tx,
        payment.id,
        reading.instant,
        print,
        req.guestCount,
      );
      const [recorded] = await tx
        .select()
        .from(billPayments)
        .where(eq(billPayments.id, payment.id));
      payment = recorded!;
    }
    return { kind: "replay", result: await resultOf(tx, deps, cfg, payment, invoice) };
  }
  // Inside the transaction, so no loop pass runs between the insert and its registration.
  hold.release = claimLive(liveBillPaymentsOf(deps.db), started.payment.id);
  return {
    kind: "collect",
    workingOrderId,
    req,
    operator,
    payment: started.payment,
    slip: await freezeWantedSlip(tx, cfg, workingOrderId, started.payment.slipWanted),
  };
}
/**
 * Asks the provider to collect a payment {@link beginReaderBillPayment} inserted, once its
 * transaction has committed, and records the outcome. Its caller still holds the live claim.
 */
export async function collectBegunReaderPayment(
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  begun: Extract<BegunReaderPayment, { kind: "collect" }>,
): Promise<BillPaymentResult> {
  const { workingOrderId, req, operator, payment } = begun;
  const slip = { frozen: begun.slip, log: deps.log };
  if (deps.disk?.noted() === true) {
    // A source the items stay off is issued here if its own payments cover it: no later payment or
    // End meal is taken on a bill with nothing outstanding. If the disk refuses this transaction,
    // the payment stays pending, and the recovery loop fails it as one no reader was asked to
    // charge (`settleFromProviderRow`).
    await withIssuanceTransaction(
      deps.db,
      (tx) => failBillPayment(tx, deps, cfg, payment.id, deps.clock.now().instant),
      deps.log,
    );
    refuseForDiskStop(deps.log, workingOrderId);
  }

  let result: PaymentResult;
  try {
    result = await deps.provider.collect({
      origin: cfg.origin,
      workingOrderId: brandWorkingOrderId(workingOrderId),
      nodeId: cfg.nodeId,
      amount: centsToDecimal(payment.applied + payment.tip),
      ...(deps.readerRef === undefined ? {} : { readerRef: deps.readerRef }),
      ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
      ...(deps.deviceProfileId === undefined ? {} : { deviceProfileId: deps.deviceProfileId }),
      simulationOutcome: req.simulationOutcome,
      billPaymentId: payment.id,
      requestedBy: operator.personId,
      onReaderCheckout: deps.onReaderCheckout,
    });
  } catch (error) {
    if (isAppError(error) && REFUSED_START.has(error.code)) {
      await withSettledSlip(
        (print) =>
          withIssuanceTransaction(
            deps.db,
            async (tx) => {
              await requireEconomicWrite(tx, cfg, deps.admission);
              await failBillPayment(tx, deps, cfg, payment.id, deps.clock.now().instant, undefined);
              await print(tx, payment.id);
            },
            deps.log,
          ),
        slip,
      );
    }
    throw collectFailure(deps, workingOrderId, error);
  }

  if (result.state === "partially_refunded")
    throw new AppError("sale.charged_not_recorded", { workingOrderId, reason: "partial_refund" });

  if (result.state === "captured") {
    // A captured result carries its time (`PaymentResult`, provider.ts).
    const settledAt = result.settledAt!;
    // Wrapped outside the transaction: when a full disk ended it or refused its commit,
    // `withTransaction` throws the store's own error (`failure` in `node-sqlite-adapter.ts`).
    return await afterCardCharged(deps, workingOrderId, () =>
      withSettledSlip(
        (print) =>
          withIssuanceTransaction(
            deps.db,
            async (tx) => {
              const done = await completeBillPayment(tx, deps, cfg, payment.id, settledAt, {
                guestCount: req.guestCount,
              });
              const printed = await print(tx, payment.id);
              return {
                ...(await resultOf(tx, deps, cfg, done.payment, done.invoice, done.meal)),
                ...printed,
              };
            },
            deps.log,
          ),
        slip,
      ),
    );
  }
  return await withSettledSlip(
    (print) =>
      withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, cfg, deps.admission);
          if (!NO_RETAINED_CHARGE.has(result.state)) {
            const answer = await resultOf(tx, deps, cfg, payment, null);
            return { ...answer, outcome: "timeout" };
          }
          const failed = await failBillPayment(
            tx,
            deps,
            cfg,
            payment.id,
            deps.clock.now().instant,
            undefined,
          );
          // No `slipPrintFailed` here: the till words it "Payment received, but the payment slip
          // could not print." (`payment_slip.capture_failed`).
          await print(tx, payment.id);
          return {
            ...(await resultOf(tx, deps, cfg, failed, null)),
            outcome: result.state === "network_unavailable" ? "network_unavailable" : "declined",
            ...(result.state === "failed" && result.failureReason !== undefined
              ? { failureReason: result.failureReason }
              : {}),
          };
        },
        deps.log,
      ),
    slip,
  );
}
