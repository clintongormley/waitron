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
const SHUTDOWN_GRACE_MS = 2_000;
const liveOf = perDatabase(() => new Set<string>());
const resolversOf = perDatabase(() => ({
  stopping: false,
  pending: new Map<Promise<RefundRow>, { id: string; controller: AbortController }>(),
}));
export function startTenderRefundResolvers(db: Database): void {
  resolversOf(db).stopping = false;
}
export async function stopTenderRefundResolvers(db: Database): Promise<string[]> {
  const state = resolversOf(db);
  state.stopping = true;
  const drain = async () => {
    while (state.pending.size > 0) await Promise.allSettled([...state.pending.keys()]);
  };
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<string[]>((done) => {
    timer = setTimeout(() => {
      const ids = [...state.pending.values()].map(({ id }) => id);
      for (const { controller } of state.pending.values()) controller.abort();
      done(ids);
    }, SHUTDOWN_GRACE_MS);
  });
  try {
    const timedOut = await Promise.race([drain().then(() => [] as string[]), timeout]);
    // Provider waits are interrupted locally; finish any local transaction before the store closes.
    await drain();
    return timedOut;
  } finally {
    clearTimeout(timer!);
  }
}
async function providerResult<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([call(), stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
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
  signal: AbortSignal,
): Promise<RefundRow> {
  signal.throwIfAborted();
  return withTransaction(deps.db, async (tx) => {
    signal.throwIfAborted();
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
        ...(outcome === "pending" ? {} : { nextRetryAt: null }),
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
    signal.throwIfAborted();
    return saved!;
  });
}
async function lookup(
  deps: TenderRefundDeps,
  provider: PaymentProvider,
  refund: RefundRow,
  signal: AbortSignal,
): Promise<RefundLookup> {
  signal.throwIfAborted();
  if (provider.lookupRefund === undefined) return { kind: "unreachable" };
  const payment = await capture(deps.db, refund);
  const excludeRefs = await withTransaction(deps.db, (tx) => excludedRefs(tx, refund));
  await withTransaction(deps.db, async (tx) => {
    signal.throwIfAborted();
    const current = await read(tx, refund.id);
    if (current.state === "pending")
      await tx
        .update(tenderRefunds)
        .set({ lastLookupAt: deps.clock.now().instant.toISOString() })
        .where(eq(tenderRefunds.id, refund.id));
  });
  try {
    return await providerResult(signal, () =>
      provider.lookupRefund!({
        processorRef: payment.externalRef ?? payment.paymentRef,
        refundId: refund.id,
        amount: amount(refund),
        sentAt: new Date(refund.sentAt!),
        excludeRefs,
        ...(refund.refsBeforeSend === null ? {} : { refsBeforeSend: refund.refsBeforeSend }),
      }),
    );
  } catch {
    signal.throwIfAborted();
    return { kind: "unreachable" };
  }
}
async function send(
  deps: TenderRefundDeps,
  provider: PaymentProvider,
  refund: RefundRow,
  expired: () => boolean,
  signal: AbortSignal,
): Promise<RefundRow> {
  signal.throwIfAborted();
  const payment = await capture(deps.db, refund);
  const refs =
    refund.sentAt === null && provider.existingRefundRefs !== undefined
      ? await providerResult(signal, () =>
          provider.existingRefundRefs!(payment.externalRef ?? payment.paymentRef),
        ).catch(() => {
          signal.throwIfAborted();
          return null;
        })
      : null;
  signal.throwIfAborted();
  if (expired()) return read(deps.db, refund.id);
  // The reservation and send intent commit separately so no provider wait holds the venue writer.
  const stamped = await withTransaction(deps.db, async (tx) => {
    signal.throwIfAborted();
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
    answer = await providerResult(signal, () =>
      provider.sendRefund!({
        processorRef: payment.externalRef ?? payment.paymentRef,
        amount: amount(stamped),
        refundId: stamped.id,
        idempotencyKey: `tr_${stamped.id}`,
      }),
    );
  } catch {
    signal.throwIfAborted();
    answer = { kind: "uncertain", reason: "network" };
  }
  const evidence: RefundEvidence =
    answer.kind === "accepted"
      ? { kind: "lookup", lookup: await lookup(deps, provider, stamped, signal) }
      : { kind: "answer", answer, sendCount: stamped.sendCount };
  return recordOutcome(deps, refund.id, evidence, signal);
}
async function resolve(
  deps: TenderRefundDeps,
  refund: RefundRow,
  resolver: "retry" | "manager" | "loop",
  expired: () => boolean,
  signal: AbortSignal,
): Promise<RefundRow> {
  signal.throwIfAborted();
  if (refund.sentAt === null && resolver !== "retry")
    return recordOutcome(deps, refund.id, { kind: "never_sent" }, signal);
  const provider = await providerResult(signal, async () =>
    deps.refundProviderFor?.(refund.provider!).catch(() => undefined),
  );
  if (provider === undefined || provider.provider !== refund.provider) return refund;
  if (refund.sentAt === null)
    return provider.sendRefund === undefined || expired()
      ? refund
      : send(deps, provider, refund, expired, signal);
  const found = await lookup(deps, provider, refund, signal);
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
    return send(deps, provider, refund, expired, signal);
  return recordOutcome(deps, refund.id, { kind: "lookup", lookup: found }, signal);
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
      !resolversOf(deps.db).stopping &&
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
  const state = resolversOf(deps.db);
  const pending = state.pending;
  const controller = new AbortController();
  const task: Promise<RefundRow> = read(deps.db, refundId)
    .then(async (refund) => {
      if (state.stopping) return refund;
      try {
        return await resolve(deps, refund, resolver, () => expired, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return refund;
        throw error;
      }
    })
    .finally(() => {
      pending.delete(task);
      release();
    });
  pending.set(task, { id: refundId, controller });
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
