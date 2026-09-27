import { and, eq } from "drizzle-orm";
import { billPaymentRefunds, billPayments, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { authorize } from "@waitron/identity";
import type { Override } from "@waitron/identity";
import {
  assertReversible,
  findPaymentByBillPayment,
  recordRefund,
  recordedRefundRefs,
} from "@waitron/payments";
import type { PaymentProvider, RefundAnswer, RefundLookup, RefundOutcome } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  MONEY_SCALE,
  toScale,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { raiseRefundOutcomeConflict } from "./bill-refund-alerts.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import {
  readBillBalance,
  readPaymentMoney,
  requireOpenBill,
  toRefundView,
} from "./bill-payments.js";
import type { BillBalance, BillRefundView } from "./bill-payments.js";
import { enqueueBillRefundDrawer } from "./receipt-print.js";
import type { TillConfig } from "./till-config.js";
import { fingerprint } from "./visits.js";
import { refusePaymentInFlight } from "./working-order.js";
import type { TillSaleDeps } from "./working-order.js";
import "./errors.js";

const ZERO = decimal("0.00");

export interface BillRefundRequest {
  submissionId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  /** A second person holding `sale.refund`, when the operator does not. */
  override?: Override;
}

export interface BillRefundResult {
  refund: BillRefundView;
  balance: BillBalance;
}

/** The card provider a bill payment was charged through, by its `payments.provider`; undefined when
 * none is available here. */
export type RefundProviderFor = (providerName: string) => Promise<PaymentProvider | undefined>;

export type BillRefundDeps = Pick<TillSaleDeps, "db" | "clock"> & {
  refundProviderFor?: RefundProviderFor;
};

/** The practice simulator by its name, else the pooled provider of that name; a name neither
 * serves (a hand-keyed card's `manual`) is undefined. */
export function refundProvidersOf(sources: {
  simulator?: PaymentProvider;
  pool?: CardProviderPool;
}): RefundProviderFor {
  return async (providerName) => {
    if (sources.simulator?.provider === providerName) return sources.simulator;
    if (sources.pool === undefined) return undefined;
    try {
      return await sources.pool.get(providerName);
    } catch {
      return undefined;
    }
  };
}

type RefundRow = typeof billPaymentRefunds.$inferSelect;

const money = (value: string): Decimal => toScale(decimal(value), MONEY_SCALE);

/** The retry fingerprint of a refund request (design §5.1). The override is left out, so a retry
 * authorised by another manager is the same refund, and no PIN is hashed into a stored value. */
export function refundFingerprint(
  paymentId: string,
  appliedAmount: string,
  tipAmount: string,
  reason: string,
): string {
  return fingerprint({
    paymentId,
    appliedAmount: money(appliedAmount),
    tipAmount: money(tipAmount),
    reason,
  });
}

async function resultOf(tx: Transaction, refund: RefundRow, workingOrderId: string) {
  return { refund: toRefundView(refund), balance: await readBillBalance(tx, workingOrderId) };
}

/** What is known of a card refund, from which design §6b's table decides its outcome. */
export type RefundEvidence =
  | { kind: "never_sent" }
  | { kind: "answer"; answer: RefundAnswer; sendCount: number }
  | { kind: "lookup"; lookup: RefundLookup }
  | { kind: "attested"; outcome: "completed" | "failed" };

/**
 * Design §6b's evidence table, shared by the send, a retry, the loop and the manager, so none
 * concludes more than another. An outcome is recorded only on the provider's own record of the
 * refund, on a manager's confirmed outcome, or on a refusal the provider documents as no refund
 * made that answered the ONLY send: after a resend, a refusal answers that send alone and the
 * earlier one is still unknown.
 */
export function refundOutcome(evidence: RefundEvidence): RefundOutcome {
  switch (evidence.kind) {
    case "never_sent":
      return "failed";
    case "attested":
      return evidence.outcome;
    case "lookup":
      return evidence.lookup.kind === "match" ? evidence.lookup.outcome : "pending";
    case "answer": {
      const { answer } = evidence;
      if (answer.kind === "outcome") return answer.outcome;
      if (answer.kind === "refused" && answer.documented && evidence.sendCount === 1) {
        return "failed";
      }
      return "pending";
    }
  }
}

function providerRefundRefOf(evidence: RefundEvidence): string | null {
  if (evidence.kind === "answer" && evidence.answer.kind === "outcome") {
    return evidence.answer.providerRefundRef;
  }
  if (evidence.kind === "lookup" && evidence.lookup.kind === "match") {
    return evidence.lookup.providerRefundRef;
  }
  return null;
}

/** The card refunds each venue store is driving in this process, by id. One process owns a venue
 * at a time, so a pending refund missing here is one nothing is still sending or looking up. */
const LIVE_BILL_REFUNDS = new WeakMap<Database, Set<string>>();

function liveRefundsOf(db: Database): Set<string> {
  let live = LIVE_BILL_REFUNDS.get(db);
  if (live === undefined) {
    live = new Set();
    LIVE_BILL_REFUNDS.set(db, live);
  }
  return live;
}

export function billRefundIsLive(db: Database, refundId: string): boolean {
  return liveRefundsOf(db).has(refundId);
}

/** A card refund, its payment's bill and its provider's `payments` row. */
interface CardRefund {
  refund: RefundRow;
  workingOrderId: string;
  provided: { provider: string; paymentRef: string; processorRef: string } | undefined;
}

async function readCardRefund(tx: Transaction, refundId: string): Promise<CardRefund | undefined> {
  const [found] = await tx
    .select({ refund: billPaymentRefunds, workingOrderId: billPayments.workingOrderId })
    .from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .where(eq(billPaymentRefunds.id, refundId));
  if (found === undefined) return undefined;
  const provided = await findPaymentByBillPayment(tx, found.refund.billPaymentId);
  return {
    ...found,
    provided:
      provided === undefined
        ? undefined
        : {
            provider: provided.provider,
            paymentRef: provided.paymentRef,
            // The simulator and the test provider keep no processor reference of their own; their
            // payment reference is the one their refund addresses.
            processorRef: provided.externalRef ?? provided.paymentRef,
          },
  };
}

const amountOf = (refund: RefundRow): Decimal =>
  centsToDecimal(refund.appliedAmount + refund.tipAmount);

/**
 * R3 (design §6b): record what the evidence settles, in its own transaction. `completed` writes the
 * provider's refund record beside the bill's in the same transaction; `failed` releases the bill;
 * anything else leaves the refund pending and the bill locked. A refund already failed that the
 * provider shows made raises `payment.refund_outcome_conflict` and records nothing: the trigger
 * refuses `failed → completed`.
 */
async function recordRefundOutcome(
  deps: BillRefundDeps,
  refundId: string,
  evidence: RefundEvidence,
  attestation?: { attestedBy: string; note: string },
): Promise<RefundRow> {
  return withTransaction(deps.db, async (tx) => {
    const target = (await readCardRefund(tx, refundId))!;
    const { refund } = target;
    const outcome = refundOutcome(evidence);
    const now = deps.clock.now().instant;
    const providerRefundRef = providerRefundRefOf(evidence);
    if (refund.state !== "pending") {
      if (refund.state === "failed" && outcome === "completed") {
        await raiseRefundOutcomeConflict(tx, refund, target.workingOrderId, providerRefundRef, now);
      }
      return refund;
    }
    if (outcome === "pending") return refund;
    const attested =
      attestation === undefined
        ? {}
        : { attestedBy: attestation.attestedBy, attestationNote: attestation.note };
    if (outcome === "failed") {
      const [failed] = await tx
        .update(billPaymentRefunds)
        .set({ state: "failed", failedAt: now.toISOString(), ...attested })
        .where(eq(billPaymentRefunds.id, refundId))
        .returning();
      return failed!;
    }
    const [completed] = await tx
      .update(billPaymentRefunds)
      .set({
        state: "completed",
        completedAt: now.toISOString(),
        ...(providerRefundRef === null ? {} : { providerRefundRef }),
        ...attested,
      })
      .where(eq(billPaymentRefunds.id, refundId))
      .returning();
    await recordRefund(tx, {
      provider: target.provided!.provider,
      paymentRef: target.provided!.paymentRef,
      amount: amountOf(refund),
      authorizedBy: refund.authorizedBy,
      ...(providerRefundRef === null ? {} : { providerRefundRef }),
    });
    return completed!;
  });
}

/**
 * R1b–R3 for one send of a card refund this process has claimed: `sent_at` (first send only) and
 * `send_count` are committed before the provider is asked, so a pending refund with no `sent_at`
 * never reached it and `send_count` above one says an earlier send is still unknown. An answer
 * with nothing to read (SumUp's 201) is looked up at once.
 */
async function sendCardRefund(
  deps: BillRefundDeps,
  provider: PaymentProvider,
  refundId: string,
): Promise<RefundRow> {
  // The row is pending: this process claimed it, and every writer of its outcome claims it too.
  const stamped = await withTransaction(deps.db, async (tx) => {
    const target = (await readCardRefund(tx, refundId))!;
    const [row] = await tx
      .update(billPaymentRefunds)
      .set({
        sentAt: target.refund.sentAt ?? deps.clock.now().instant.toISOString(),
        sendCount: target.refund.sendCount + 1,
      })
      .where(eq(billPaymentRefunds.id, refundId))
      .returning();
    return { ...target, refund: row! };
  });
  const { refund, provided } = stamped;

  let answer: RefundAnswer;
  try {
    answer = await provider.sendRefund!({
      processorRef: provided!.processorRef,
      amount: amountOf(refund),
      idempotencyKey: `bpr_${refund.id}`,
      refundId: refund.id,
    });
  } catch {
    // A throw is no answer: the provider may or may not have made the refund.
    answer = { kind: "uncertain", reason: "network" };
  }
  const evidence: RefundEvidence =
    answer.kind === "accepted"
      ? {
          kind: "lookup",
          lookup: await lookUp(deps, provider, refund, provided!.processorRef, refund.sentAt!),
        }
      : { kind: "answer", answer, sendCount: refund.sendCount };
  return recordRefundOutcome(deps, refundId, evidence);
}

async function lookUp(
  deps: BillRefundDeps,
  provider: PaymentProvider,
  refund: RefundRow,
  processorRef: string,
  sentAt: string,
): Promise<RefundLookup> {
  if (provider.lookupRefund === undefined) return { kind: "unreachable" };
  try {
    return await provider.lookupRefund({
      processorRef,
      refundId: refund.id,
      amount: amountOf(refund),
      sentAt: new Date(sentAt),
      excludeRefs: await withTransaction(deps.db, (tx) =>
        recordedRefundRefs(tx, refund.billPaymentId),
      ),
    });
  } catch {
    return { kind: "unreachable" };
  }
}

async function providerOf(
  deps: BillRefundDeps,
  target: CardRefund,
): Promise<PaymentProvider | undefined> {
  if (target.provided === undefined || deps.refundProviderFor === undefined) return undefined;
  return deps.refundProviderFor(target.provided.provider);
}

/**
 * Who is resolving a pending card refund (design §6b): `retry` is the refund's own request sent
 * again, which sends a refund that never left and may resend inside the provider's key window;
 * `manager` fails one that never left and may resend inside the window; `loop` fails one that
 * never left and never sends.
 */
export type RefundResolver = "retry" | "manager" | "loop";

/** `claimed: false`: the refund was no longer pending, or another resolver in this process holds
 * it, so nothing was done. `lookup` is what the provider showed, when it was asked. */
export type ResumedRefund =
  | { claimed: false; refund: RefundRow }
  | { claimed: true; refund: RefundRow; lookup: RefundLookup | null; resent: boolean };

/**
 * Settle a pending card refund by design §6b's rules for `resolver`, claiming it for this process
 * first. With no `sent_at`, a retry sends it now and any other resolver fails it. With `sent_at`,
 * the provider is looked up first; only a retry or the manager, only when the lookup found
 * nothing, and only while the provider's key window is open, sends again under the same key.
 */
export async function resumeCardRefund(
  deps: BillRefundDeps,
  refundId: string,
  resolver: RefundResolver,
): Promise<ResumedRefund> {
  const live = liveRefundsOf(deps.db);
  const target = await withTransaction(deps.db, async (tx) => {
    const found = await readCardRefund(tx, refundId);
    if (found === undefined) throw new AppError("bill.refund_not_found", { refundId });
    if (found.refund.state !== "pending" || live.has(refundId)) return { found, claimed: false };
    live.add(refundId);
    return { found, claimed: true };
  });
  if (!target.claimed) return { claimed: false, refund: target.found.refund };
  const { refund, provided } = target.found;
  try {
    const provider = await providerOf(deps, target.found);
    if (refund.sentAt === null) {
      if (resolver !== "retry") {
        const failed = await recordRefundOutcome(deps, refundId, { kind: "never_sent" });
        return { claimed: true, refund: failed, lookup: null, resent: false };
      }
      const sent =
        provider?.sendRefund === undefined
          ? refund
          : await sendCardRefund(deps, provider, refundId);
      return { claimed: true, refund: sent, lookup: null, resent: false };
    }
    const lookup: RefundLookup =
      provider === undefined
        ? { kind: "unreachable" }
        : await lookUp(deps, provider, refund, provided!.processorRef, refund.sentAt);
    const window = provider?.refundResendWindowMs ?? null;
    const age = deps.clock.now().instant.getTime() - Date.parse(refund.sentAt);
    if (
      lookup.kind === "none" &&
      resolver !== "loop" &&
      provider?.sendRefund !== undefined &&
      window !== null &&
      age < window
    ) {
      const resent = await sendCardRefund(deps, provider, refundId);
      return { claimed: true, refund: resent, lookup, resent: true };
    }
    const settled = await recordRefundOutcome(deps, refundId, { kind: "lookup", lookup });
    return { claimed: true, refund: settled, lookup, resent: false };
  } finally {
    live.delete(refundId);
  }
}

/**
 * A manager's confirmed outcome of a pending card refund (design §6b, owner 2026-09-26), kept on the
 * row with who recorded it and their note. `completed` for a refund that never reached the provider
 * is refused `bill.attestation_contradicted`.
 */
export async function attestCardRefund(
  deps: BillRefundDeps,
  refundId: string,
  outcome: "completed" | "failed",
  attestation: { attestedBy: string; note: string },
): Promise<RefundRow> {
  const live = liveRefundsOf(deps.db);
  await withTransaction(deps.db, async (tx) => {
    const target = await readCardRefund(tx, refundId);
    if (target === undefined) throw new AppError("bill.refund_not_found", { refundId });
    if (target.refund.state !== "pending" || live.has(refundId)) {
      throw new AppError("bill.refund_not_stuck", { refundId });
    }
    if (outcome === "completed" && target.refund.sentAt === null) {
      throw new AppError("bill.attestation_contradicted", { id: refundId, evidence: "never_sent" });
    }
    live.add(refundId);
  });
  try {
    return await recordRefundOutcome(deps, refundId, { kind: "attested", outcome }, attestation);
  } finally {
    live.delete(refundId);
  }
}

/**
 * Give money back from one bill payment of an open bill, needing `sale.refund` from the operator or
 * the override. A payment gives back up to its net applied money; its tip comes back only with the
 * whole of what is left of it; an item payment only whole, which frees its lines.
 *
 * Keyed by `submissionId` across the whole bill (design §5.1): the same refund again answers the
 * first and writes nothing, except that a card refund still pending is resumed; the id with another
 * request, of another payment, or naming one of the bill's payments is `submission.id_reused`.
 *
 * Cash is written `completed`, and opens the till's drawer, in one transaction. A card refund is
 * written `pending` before its provider is asked (design §6b), and the bill is locked until the
 * evidence settles it.
 */
export async function refundBillPayment(
  deps: BillRefundDeps,
  cfg: TillConfig,
  workingOrderId: string,
  paymentId: string,
  req: BillRefundRequest,
  operator: { personId: string; sessionId: string },
): Promise<BillRefundResult> {
  const applied = money(req.appliedAmount);
  const tip = money(req.tipAmount);
  const print = refundFingerprint(paymentId, req.appliedAmount, req.tipAmount, req.reason);
  const live = liveRefundsOf(deps.db);
  let claimed: string | null = null;
  try {
    const begun = await withTransaction(deps.db, async (tx) => {
      const authorization = await authorize(tx, {
        sessionId: operator.sessionId,
        permission: "sale.refund",
        override: req.override,
      });
      const [payment] = await tx
        .select()
        .from(billPayments)
        .where(
          and(eq(billPayments.id, paymentId), eq(billPayments.workingOrderId, workingOrderId)),
        );
      if (payment === undefined) throw new AppError("bill.payment_not_found", { paymentId });

      const [earlier] = await tx
        .select({ refund: billPaymentRefunds })
        .from(billPaymentRefunds)
        .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
        .where(
          and(
            eq(billPayments.workingOrderId, workingOrderId),
            eq(billPaymentRefunds.submissionId, req.submissionId),
          ),
        );
      if (earlier !== undefined) {
        if (earlier.refund.fingerprint !== print) {
          throw new AppError("submission.id_reused", { submissionId: req.submissionId });
        }
        if (earlier.refund.state === "pending") {
          return { kind: "resume" as const, refundId: earlier.refund.id };
        }
        return {
          kind: "done" as const,
          result: await resultOf(tx, earlier.refund, workingOrderId),
        };
      }
      const [paymentWithId] = await tx
        .select({ id: billPayments.id })
        .from(billPayments)
        .where(
          and(
            eq(billPayments.workingOrderId, workingOrderId),
            eq(billPayments.submissionId, req.submissionId),
          ),
        );
      if (paymentWithId !== undefined) {
        throw new AppError("submission.id_reused", { submissionId: req.submissionId });
      }

      await requireOpenBill(tx, workingOrderId);
      await refusePaymentInFlight(tx, [workingOrderId]);

      const held = (await readPaymentMoney(tx, [workingOrderId])).find(
        ({ row }) => row.id === paymentId,
      )!;
      const [refundable, refundableTip] =
        payment.state === "received" ? [held.netApplied, held.netTip] : [ZERO, ZERO];
      const whole = compareDecimal(applied, refundable) === 0;
      if (
        compareDecimal(applied, refundable) > 0 ||
        (compareDecimal(tip, ZERO) !== 0 && !(whole && compareDecimal(tip, refundableTip) === 0))
      ) {
        throw new AppError("bill.refund_exceeds_payment", {
          paymentId,
          applied: toScale(refundable, MONEY_SCALE),
          tip: toScale(refundableTip, MONEY_SCALE),
        });
      }
      if (payment.kind === "items" && !whole) {
        throw new AppError("management.request_invalid", { field: "appliedAmount" });
      }

      const createdAt = deps.clock.now().instant.toISOString();
      const values = {
        billPaymentId: paymentId,
        submissionId: req.submissionId,
        fingerprint: print,
        appliedAmount: decimalToCents(applied),
        tipAmount: decimalToCents(tip),
        reason: req.reason,
        authorizedBy: authorization.authorizedBy,
        requestedBy: operator.personId,
        tillId: cfg.tillId,
        createdAt,
      };
      if (payment.method === "cash") {
        const [refund] = await tx
          .insert(billPaymentRefunds)
          .values({ ...values, state: "completed", completedAt: createdAt })
          .returning();
        await enqueueBillRefundDrawer(tx, cfg, paymentId, operator.personId, {
          authorizedBy: authorization.authorizedBy,
          viaOverride: authorization.viaOverride,
        });
        return { kind: "done" as const, result: await resultOf(tx, refund!, workingOrderId) };
      }

      const provided = await findPaymentByBillPayment(tx, paymentId);
      const provider =
        provided === undefined ? undefined : await deps.refundProviderFor?.(provided.provider);
      if (provided === undefined || provider?.sendRefund === undefined) {
        throw new AppError("bill.refund_unsupported", { paymentId });
      }
      // The provider's own record must allow this refund before it is asked for it.
      await assertReversible(tx, {
        provider: provided.provider,
        paymentRef: provided.paymentRef,
        kind: "refund",
        amount: centsToDecimal(values.appliedAmount + values.tipAmount),
      });
      const [refund] = await tx
        .insert(billPaymentRefunds)
        .values({ ...values, state: "pending" })
        .returning();
      // Inside the transaction, so no loop pass runs between the insert and the claim.
      claimed = refund!.id;
      live.add(claimed);
      return { kind: "send" as const, refundId: refund!.id, provider };
    });
    if (begun.kind === "done") return begun.result;
    if (begun.kind === "send") {
      await sendCardRefund(deps, begun.provider, begun.refundId);
    } else {
      await resumeCardRefund(deps, begun.refundId, "retry");
    }
    const refundId = begun.refundId;
    return await withTransaction(deps.db, async (tx) => {
      const [refund] = await tx
        .select()
        .from(billPaymentRefunds)
        .where(eq(billPaymentRefunds.id, refundId));
      return resultOf(tx, refund!, workingOrderId);
    });
  } finally {
    if (claimed !== null) live.delete(claimed);
  }
}
