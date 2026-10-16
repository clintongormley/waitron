import { and, eq, isNotNull, ne } from "drizzle-orm";
import {
  billPaymentRefunds,
  tenderRefunds,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  payments,
  recordRefund,
  type PaymentProvider,
  type RefundAnswer,
  type RefundLookup,
} from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { AppError, centsToDecimal } from "@waitron/shared";
import { raiseTenderRefundConflict } from "./bill-refund-alerts.js";
import { refundOutcome, type RefundEvidence } from "./bill-refunds.js";
import { claimLive, perDatabase } from "./live-in-process.js";
import { toTenderRefundView, type TenderRefundDeps } from "./tender-refunds.js";
import "./errors.js";

type RefundRow = typeof tenderRefunds.$inferSelect;
const liveOf = perDatabase(() => new Set<string>());
export function tenderRefundIsLive(db: Database, refundId: string): boolean {
  return liveOf(db).has(refundId);
}
export function claimTenderRefund(db: Database, refundId: string): () => void {
  return claimLive(liveOf(db), refundId);
}
async function read(tx: Transaction, id: string): Promise<RefundRow> {
  const [row] = await tx.select().from(tenderRefunds).where(eq(tenderRefunds.id, id));
  if (row === undefined) throw new AppError("tender.refund_not_found", { refundId: id });
  return row;
}
async function capture(tx: Transaction, refund: RefundRow) {
  const [row] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.provider, refund.provider!),
        eq(payments.paymentRef, refund.providerPaymentRef!),
      ),
    );
  return row!;
}
const amount = (row: RefundRow) => centsToDecimal(row.appliedAmount + row.tipAmount);
async function excludedRefs(tx: Transaction, refund: RefundRow): Promise<string[]> {
  const payment = await capture(tx, refund);
  const post = await tx
    .select({ ref: tenderRefunds.providerRefundRef })
    .from(tenderRefunds)
    .where(
      and(
        eq(tenderRefunds.provider, refund.provider!),
        eq(tenderRefunds.providerPaymentRef, refund.providerPaymentRef!),
        ne(tenderRefunds.id, refund.id),
        isNotNull(tenderRefunds.providerRefundRef),
      ),
    );
  const pre =
    payment.billPaymentId === null
      ? []
      : await tx
          .select({ ref: billPaymentRefunds.providerRefundRef })
          .from(billPaymentRefunds)
          .where(
            and(
              eq(billPaymentRefunds.billPaymentId, payment.billPaymentId),
              isNotNull(billPaymentRefunds.providerRefundRef),
            ),
          );
  const recorded = await tx
    .select({ ref: paymentRefunds.providerRefundRef })
    .from(paymentRefunds)
    .where(
      and(eq(paymentRefunds.paymentId, payment.id), isNotNull(paymentRefunds.providerRefundRef)),
    );
  return [...new Set([...post, ...pre, ...recorded].map((row) => row.ref!))];
}
async function recordOutcome(
  deps: TenderRefundDeps,
  id: string,
  evidence: RefundEvidence,
): Promise<RefundRow> {
  return withTransaction(deps.db, async (tx) => {
    const refund = await read(tx, id);
    const outcome = refundOutcome(evidence);
    const providerRef =
      evidence.kind === "answer" && evidence.answer.kind === "outcome"
        ? evidence.answer.providerRefundRef
        : evidence.kind === "lookup" && evidence.lookup.kind === "match"
          ? evidence.lookup.providerRefundRef
          : null;
    if (refund.state !== "pending") {
      if (outcome !== "pending" && outcome !== refund.state)
        await raiseTenderRefundConflict(tx, refund, providerRef, deps.clock.now().instant);
      return refund;
    }
    if (
      providerRef !== null &&
      ((refund.providerRefundRef !== null && refund.providerRefundRef !== providerRef) ||
        (await excludedRefs(tx, refund)).includes(providerRef))
    ) {
      await raiseTenderRefundConflict(tx, refund, providerRef, deps.clock.now().instant);
      return refund;
    }
    const now = deps.clock.now().instant.toISOString();
    const [saved] = await tx
      .update(tenderRefunds)
      .set({
        state: outcome,
        ...(providerRef === null
          ? {}
          : { providerRefundRef: providerRef, providerStatus: outcome }),
        ...(outcome === "completed" ? { completedAt: now } : {}),
        ...(outcome === "failed" ? { failedAt: now } : {}),
      })
      .where(eq(tenderRefunds.id, id))
      .returning();
    if (outcome === "completed")
      await recordRefund(tx, {
        provider: refund.provider!,
        paymentRef: refund.providerPaymentRef!,
        amount: amount(refund),
        authorizedBy: refund.authorizedBy,
        ...(providerRef === null ? {} : { providerRefundRef: providerRef }),
      });
    if (outcome !== "pending")
      await deps.attendance?.(tx, {
        source: "refund",
        key: refund.id,
        personId: refund.requestedBy,
        locationId: refund.locationId,
        kind: "payment",
        at: refund.createdAt,
        offsetMinutes: 0,
        outcome: outcome === "completed" ? "qualified" : "refused",
      });
    return saved!;
  });
}
async function lookup(
  deps: TenderRefundDeps,
  provider: PaymentProvider,
  refund: RefundRow,
): Promise<RefundLookup> {
  if (provider.lookupRefund === undefined) return { kind: "unreachable" };
  const payment = await capture(deps.db, refund);
  const excludeRefs = await withTransaction(deps.db, (tx) => excludedRefs(tx, refund));
  try {
    return await provider.lookupRefund({
      processorRef: payment.externalRef ?? payment.paymentRef,
      refundId: refund.id,
      amount: amount(refund),
      sentAt: new Date(refund.sentAt!),
      excludeRefs,
      ...(refund.refsBeforeSend === null ? {} : { refsBeforeSend: refund.refsBeforeSend }),
    });
  } catch {
    return { kind: "unreachable" };
  }
}
async function send(
  deps: TenderRefundDeps,
  provider: PaymentProvider,
  refund: RefundRow,
  expired: () => boolean,
): Promise<RefundRow> {
  const payment = await capture(deps.db, refund);
  const refs =
    refund.sentAt === null && provider.existingRefundRefs !== undefined
      ? await provider
          .existingRefundRefs(payment.externalRef ?? payment.paymentRef)
          .catch(() => null)
      : null;
  if (expired()) return read(deps.db, refund.id);
  // The reservation and send intent commit separately so no provider wait holds the venue writer.
  const stamped = await withTransaction(deps.db, async (tx) => {
    const current = await read(tx, refund.id);
    if (expired()) return null;
    const [row] = await tx
      .update(tenderRefunds)
      .set({
        sentAt: current.sentAt ?? deps.clock.now().instant.toISOString(),
        sendCount: current.sendCount + 1,
        ...(refs === null ? {} : { refsBeforeSend: refs }),
      })
      .where(eq(tenderRefunds.id, refund.id))
      .returning();
    return row!;
  });
  if (stamped === null) return read(deps.db, refund.id);
  if (expired()) return stamped;
  let answer: RefundAnswer;
  try {
    answer = await provider.sendRefund!({
      processorRef: payment.externalRef ?? payment.paymentRef,
      amount: amount(stamped),
      refundId: stamped.id,
      idempotencyKey: `tr_${stamped.id}`,
    });
  } catch {
    answer = { kind: "uncertain", reason: "network" };
  }
  const evidence: RefundEvidence =
    answer.kind === "accepted"
      ? { kind: "lookup", lookup: await lookup(deps, provider, stamped) }
      : { kind: "answer", answer, sendCount: stamped.sendCount };
  return recordOutcome(deps, refund.id, evidence);
}
async function resolve(
  deps: TenderRefundDeps,
  refund: RefundRow,
  resolver: "retry" | "manager" | "loop",
  expired: () => boolean,
): Promise<RefundRow> {
  if (refund.sentAt === null && resolver !== "retry")
    return recordOutcome(deps, refund.id, { kind: "never_sent" });
  const provider = await deps.refundProviderFor?.(refund.provider!).catch(() => undefined);
  if (provider === undefined || provider.provider !== refund.provider) return refund;
  if (refund.sentAt === null)
    return provider.sendRefund === undefined || expired()
      ? refund
      : send(deps, provider, refund, expired);
  const found = await lookup(deps, provider, refund);
  const window = provider.refundResendWindowMs ?? null;
  const age = deps.clock.now().instant.getTime() - Date.parse(refund.sentAt);
  if (
    found.kind === "none" &&
    resolver !== "loop" &&
    provider.sendRefund !== undefined &&
    window !== null &&
    age >= 0 &&
    age < window &&
    !expired()
  )
    return send(deps, provider, refund, expired);
  return recordOutcome(deps, refund.id, { kind: "lookup", lookup: found });
}

export async function resumeTenderRefund(
  deps: TenderRefundDeps,
  refundId: string,
  resolver: "retry" | "manager" | "loop",
) {
  const live = liveOf(deps.db);
  const target = await withTransaction(deps.db, async (tx) => {
    const refund = await read(tx, refundId);
    const release =
      refund.state === "pending" &&
      refund.method === "card" &&
      !refund.manual &&
      !live.has(refundId)
        ? claimLive(live, refundId)
        : null;
    return { refund, release };
  });
  if (target.release === null) return toTenderRefundView(target.refund);
  return resolveClaimedTenderRefund(deps, refundId, resolver, target.release);
}

export async function resolveClaimedTenderRefund(
  deps: TenderRefundDeps,
  refundId: string,
  resolver: "retry" | "manager" | "loop",
  release: () => void,
) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  // A response deadline does not end the actual provider call or release its resolver ownership.
  const task = read(deps.db, refundId)
    .then((refund) => resolve(deps, refund, resolver, () => expired))
    .finally(release);
  const deadline = new Promise<RefundRow>((resolveDeadline, rejectDeadline) => {
    timer = setTimeout(() => {
      expired = true;
      read(deps.db, refundId).then(resolveDeadline, rejectDeadline);
    }, 10_000);
  });
  try {
    return toTenderRefundView(await Promise.race([task, deadline]));
  } finally {
    clearTimeout(timer!);
  }
}
