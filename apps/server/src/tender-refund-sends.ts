import { and, eq, isNotNull, ne } from "drizzle-orm";
import { IssuanceRefusedError, type TrustedReading } from "@waitron/fiscal";
import { clockUnusableAt } from "./clock-unusable.js";
import { requireEconomicWrite } from "./trading-admission.js";
import {
  billPayments,
  refunds,
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
  type RefundOutcome,
  type RefundRefusalReason,
} from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { AppError, centsToDecimal, jobOrigin } from "@waitron/shared";
import { raiseRefundOutcomeConflict, raiseTenderRefundConflict } from "./bill-refund-alerts.js";
import { alertOrigin, type AlertOrigin } from "./request-config.js";
import { attestationColumns, type Attestation } from "./bill-payments.js";
import { claimLive, perDatabase } from "./live-in-process.js";
import { toTenderRefundView, type TenderRefundDeps } from "./tender-refunds.js";
import "./errors.js";

type RefundRow = typeof refunds.$inferSelect;
type RefundResolver = "retry" | "manager" | "loop";

interface Resolution {
  signal: AbortSignal;
  expired: () => boolean;
  raisedBy: AlertOrigin;
  lookup: RefundLookup | null;
  resent: boolean;
  refusalReason?: RefundRefusalReason;
}

/** Whether a recovery pass leaves every pending refund as it is: while the start clock gate
 * holds, while the seat would refuse a record at the reading (`clock.unusable`, before
 * 28-10-2024), or while the seat refuses a new refund. */
export async function refundsPaused(
  deps: TenderRefundDeps,
  reading: TrustedReading,
): Promise<boolean> {
  if (deps.clockUnconfirmed?.() === true) return true;
  if (clockUnusableAt(deps.backend, reading)) return true;
  return withTransaction(deps.db, (tx) => refundRefused(tx, deps));
}

export async function refundRefused(tx: Transaction, deps: TenderRefundDeps): Promise<boolean> {
  try {
    await deps.backend.refuseNewRefund(tx, deps.cfg.nodeId);
    return false;
  } catch (error) {
    if (error instanceof IssuanceRefusedError) return true;
    throw error;
  }
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

/**
 * Whether a refund's send or outcome, dated by `reading` in `tx`, is held: while the start clock
 * gate holds, or while the seat would refuse a record at `reading` (`clock.unusable`, before
 * 28-10-2024). Judged again here because a provider wait since the request's own check can end
 * after the clock moves or the gate starts holding; the refund is then left pending for a later
 * pass. A manager's confirmed outcome (`evidence` attested) is refused instead, by the seat's
 * `refuseUntilRecordable`, as their route refuses it.
 */
export async function clockStopsRefund(
  tx: Transaction,
  deps: Pick<TenderRefundDeps, "backend" | "clockUnconfirmed">,
  evidence: RefundEvidence | null,
  reading: TrustedReading,
): Promise<boolean> {
  if (evidence?.kind === "attested") {
    await deps.backend.refuseUntilRecordable(tx, reading);
    return false;
  }
  if (deps.clockUnconfirmed?.() === true) return true;
  return clockUnusableAt(deps.backend, reading);
}
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
  const [row] = await tx.select().from(refunds).where(eq(refunds.id, id));
  if (row === undefined) throw new AppError("tender.refund_not_found", { refundId: id });
  return row;
}

async function readTenderRefund(tx: Transaction, id: string): Promise<RefundRow> {
  const refund = await read(tx, id);
  if (refund.saleId === null) throw new AppError("tender.refund_not_found", { refundId: id });
  return refund;
}

async function readBillRefund(tx: Transaction, id: string): Promise<RefundRow> {
  const [refund] = await tx.select().from(refunds).where(eq(refunds.id, id));
  if (refund === undefined || refund.billPaymentId === null)
    throw new AppError("bill.refund_not_found", { refundId: id });
  return refund;
}

async function raiseConflict(
  tx: Transaction,
  refund: RefundRow,
  ref: string | null,
  now: Date,
  raisedBy: AlertOrigin,
) {
  if (refund.billPaymentId === null) {
    return raiseTenderRefundConflict(tx, refund, ref, now);
  }
  const [parent] = await tx
    .select({ workingOrderId: billPayments.workingOrderId })
    .from(billPayments)
    .where(eq(billPayments.id, refund.billPaymentId));
  return raiseRefundOutcomeConflict(
    tx,
    refund,
    parent!.workingOrderId,
    ref,
    now,
    alertOrigin(raisedBy, refund),
  );
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
  const others = await tx
    .select({ ref: refunds.providerRefundRef })
    .from(refunds)
    .where(
      and(
        eq(refunds.provider, refund.provider!),
        eq(refunds.providerPaymentRef, refund.providerPaymentRef!),
        ne(refunds.id, refund.id),
        isNotNull(refunds.providerRefundRef),
      ),
    );
  const recorded = await tx
    .select({ ref: paymentRefunds.providerRefundRef })
    .from(paymentRefunds)
    .where(
      and(eq(paymentRefunds.paymentId, payment.id), isNotNull(paymentRefunds.providerRefundRef)),
    );
  return [
    ...new Set([
      ...others.map((row) => row.ref!),
      ...recorded.map((row) => row.ref!).filter((ref) => ref !== refund.providerRefundRef),
    ]),
  ];
}
async function recordOutcome(
  deps: TenderRefundDeps,
  id: string,
  evidence: RefundEvidence,
  { signal, raisedBy }: Resolution,
): Promise<RefundRow> {
  signal.throwIfAborted();
  return withTransaction(deps.db, (tx) =>
    recordOutcomeIn(tx, deps, id, evidence, signal, raisedBy),
  );
}
async function recordOutcomeIn(
  tx: Transaction,
  deps: TenderRefundDeps,
  id: string,
  evidence: RefundEvidence,
  signal: AbortSignal,
  raisedBy: AlertOrigin,
  attestation?: Attestation,
): Promise<RefundRow> {
  signal.throwIfAborted();
  await requireEconomicWrite(tx, deps.cfg, deps.admission);
  const refund = await read(tx, id);
  const outcome = refundOutcome(evidence);
  const reading = deps.clock.now();
  const providerRef =
    evidence.kind === "answer" && evidence.answer.kind === "outcome"
      ? evidence.answer.providerRefundRef
      : evidence.kind === "lookup" && evidence.lookup.kind === "match"
        ? evidence.lookup.providerRefundRef
        : null;
  if (refund.state !== "pending") {
    if (outcome !== "pending" && outcome !== refund.state)
      await raiseConflict(tx, refund, providerRef, reading.instant, raisedBy);
    return refund;
  }
  if (
    providerRef !== null &&
    ((refund.providerRefundRef !== null && refund.providerRefundRef !== providerRef) ||
      (await excludedRefs(tx, refund)).includes(providerRef))
  ) {
    await raiseConflict(tx, refund, providerRef, reading.instant, raisedBy);
    return refund;
  }
  if (outcome !== "pending" && (await clockStopsRefund(tx, deps, evidence, reading))) return refund;
  const now = reading.instant.toISOString();
  const [saved] = await tx
    .update(refunds)
    .set({
      state: outcome,
      ...attestationColumns(attestation),
      ...(outcome === "pending" ? {} : { nextRetryAt: null }),
      ...(providerRef === null ? {} : { providerRefundRef: providerRef, providerStatus: outcome }),
      ...(outcome === "completed" ? { completedAt: now } : {}),
      ...(outcome === "failed" ? { failedAt: now } : {}),
    })
    .where(eq(refunds.id, id))
    .returning();
  if (outcome === "completed")
    await recordRefund(tx, {
      provider: refund.provider!,
      paymentRef: refund.providerPaymentRef!,
      amount: amount(refund),
      authorizedBy:
        refund.billPaymentId === null
          ? (attestation?.attestedBy ?? refund.authorizedBy)
          : refund.authorizedBy,
      ...(providerRef === null ? {} : { providerRefundRef: providerRef }),
    });
  signal.throwIfAborted();
  return saved!;
}

function canResolve(db: Database, refund: RefundRow): boolean {
  return (
    refund.state === "pending" &&
    refund.method === "card" &&
    !refund.manual &&
    !tenderRefundIsLive(db, refund.id) &&
    !resolversOf(db).stopping
  );
}

export async function readStuckTenderRefund(
  tx: Transaction,
  db: Database,
  id: string,
): Promise<RefundRow> {
  const refund = await readTenderRefund(tx, id);
  if (!canResolve(db, refund)) throw new AppError("tender.refund_not_stuck", { refundId: id });
  return refund;
}

async function attestRefundIn(
  tx: Transaction,
  deps: TenderRefundDeps,
  refund: RefundRow,
  outcome: "completed" | "failed",
  attestation: Attestation,
) {
  if (outcome === "completed" && refund.sentAt === null) {
    if (refund.billPaymentId !== null)
      throw new AppError("bill.attestation_contradicted", {
        id: refund.id,
        evidence: "never_sent",
      });
    throw new AppError("tender.attestation_contradicted", {
      refundId: refund.id,
      evidence: "never_sent",
    });
  }
  return recordOutcomeIn(
    tx,
    deps,
    refund.id,
    { kind: "attested", outcome },
    new AbortController().signal,
    "stored",
    attestation,
  );
}

export async function attestTenderRefundIn(
  tx: Transaction,
  deps: TenderRefundDeps,
  refundId: string,
  outcome: "completed" | "failed",
  attestation: Attestation,
) {
  await requireEconomicWrite(tx, deps.cfg, deps.admission);
  const refund = await readStuckTenderRefund(tx, deps.db, refundId);
  return toTenderRefundView(await attestRefundIn(tx, deps, refund, outcome, attestation));
}

export async function attestBillCardRefundIn(
  tx: Transaction,
  deps: TenderRefundDeps,
  refundId: string,
  outcome: "completed" | "failed",
  attestation: Attestation,
) {
  await requireEconomicWrite(tx, deps.cfg, deps.admission);
  const refund = await readBillRefund(tx, refundId);
  if (!canResolve(deps.db, refund)) throw new AppError("bill.refund_not_stuck", { refundId });
  return attestRefundIn(tx, deps, refund, outcome, attestation);
}

export function attestBillCardRefund(
  deps: TenderRefundDeps,
  refundId: string,
  outcome: "completed" | "failed",
  attestation: Attestation,
) {
  return withTransaction(deps.db, (tx) =>
    attestBillCardRefundIn(tx, deps, refundId, outcome, attestation),
  );
}

export function attestTenderRefund(
  deps: TenderRefundDeps,
  refundId: string,
  outcome: "completed" | "failed",
  attestation: Attestation,
) {
  return withTransaction(deps.db, (tx) =>
    attestTenderRefundIn(tx, deps, refundId, outcome, attestation),
  );
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
    deps.stopSignal?.throwIfAborted();
    await requireEconomicWrite(tx, deps.cfg, deps.admission);
    const current = await read(tx, refund.id);
    if (current.state === "pending")
      await tx
        .update(refunds)
        .set({ lastLookupAt: deps.clock.now().instant.toISOString() })
        .where(eq(refunds.id, refund.id));
  });
  // Refunds of one pass run side by side, so the stop can arrive while this one's stamp commits.
  deps.stopSignal?.throwIfAborted();
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
  resolution: Resolution,
): Promise<RefundRow> {
  const { expired, signal } = resolution;
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
    await requireEconomicWrite(tx, deps.cfg, deps.admission);
    const current = await read(tx, refund.id);
    if (expired()) return null;
    const reading = deps.clock.now();
    if (await clockStopsRefund(tx, deps, null, reading)) return null;
    if (await refundRefused(tx, deps)) return null;
    const [row] = await tx
      .update(refunds)
      .set({
        sentAt: current.sentAt ?? reading.instant.toISOString(),
        sendCount: current.sendCount + 1,
        ...(refs === null ? {} : { refsBeforeSend: refs }),
      })
      .where(eq(refunds.id, refund.id))
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
  const recorded = await recordOutcome(deps, refund.id, evidence, resolution);
  if (
    stamped.state === "pending" &&
    stamped.sendCount === 1 &&
    recorded.state === "failed" &&
    answer.kind === "refused" &&
    answer.documented &&
    answer.reason === "provider_balance_unavailable"
  ) {
    resolution.refusalReason = answer.reason;
  }
  return recorded;
}
async function resolve(
  deps: TenderRefundDeps,
  refund: RefundRow,
  resolver: RefundResolver,
  resolution: Resolution,
): Promise<RefundRow> {
  const { expired, signal } = resolution;
  signal.throwIfAborted();
  await withTransaction(deps.db, (tx) => requireEconomicWrite(tx, deps.cfg, deps.admission));
  if (refund.sentAt === null && resolver !== "retry")
    return recordOutcome(deps, refund.id, { kind: "never_sent" }, resolution);
  const provider = await providerResult(signal, async () => {
    try {
      return await deps.refundProviderFor?.(refund.provider!);
    } catch (error) {
      if (refund.billPaymentId !== null) throw error;
      return undefined;
    }
  });
  if (provider === undefined || provider.provider !== refund.provider) {
    if (refund.sentAt !== null) resolution.lookup = { kind: "unreachable" };
    return refund;
  }
  if (refund.sentAt === null)
    return provider.sendRefund === undefined || expired()
      ? refund
      : send(deps, provider, refund, resolution);
  const found = await lookup(deps, provider, refund, signal);
  resolution.lookup = found;
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
  ) {
    resolution.resent = true;
    return send(deps, provider, refund, resolution);
  }
  return recordOutcome(deps, refund.id, { kind: "lookup", lookup: found }, resolution);
}

export async function resumeTenderRefund(
  deps: TenderRefundDeps,
  refundId: string,
  resolver: RefundResolver,
) {
  const { refund, release } = await claimPendingRefund(deps, refundId, readTenderRefund);
  if (release === null) return toTenderRefundView(refund);
  return resolveClaimedTenderRefund(deps, refundId, resolver, release);
}

export async function resumeBillCardRefund(
  deps: TenderRefundDeps,
  refundId: string,
  resolver: RefundResolver,
  raisedBy: AlertOrigin = "stored",
) {
  const { refund, release } = await claimPendingRefund(deps, refundId, readBillRefund);
  if (release === null) return { claimed: false as const, refund };
  const result = await resolveClaimedRefund(deps, refundId, resolver, release, raisedBy);
  return { claimed: true as const, ...result };
}

export async function recoverCardRefund(deps: TenderRefundDeps, refundId: string): Promise<void> {
  const { release } = await claimPendingRefund(deps, refundId, read);
  if (release !== null)
    await resolveClaimedRefund(deps, refundId, "loop", release, jobOrigin("payment_check"));
}

function claimPendingRefund(
  deps: TenderRefundDeps,
  refundId: string,
  readRefund: (tx: Transaction, id: string) => Promise<RefundRow>,
) {
  return withTransaction(deps.db, async (tx) => {
    await requireEconomicWrite(tx, deps.cfg, deps.admission);
    const refund = await readRefund(tx, refundId);
    const release = canResolve(deps.db, refund) ? claimTenderRefund(deps.db, refundId) : null;
    return { refund, release };
  });
}

export async function resolveClaimedTenderRefund(
  deps: TenderRefundDeps,
  refundId: string,
  resolver: RefundResolver,
  release: () => void,
) {
  const { refund, refusalReason } = await resolveClaimedRefund(deps, refundId, resolver, release);
  return {
    ...toTenderRefundView(refund),
    ...(refusalReason === undefined ? {} : { refusalReason }),
  };
}

export async function resolveClaimedRefund(
  deps: TenderRefundDeps,
  refundId: string,
  resolver: RefundResolver,
  release: () => void,
  raisedBy: AlertOrigin = "stored",
) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  // A response deadline does not end the actual provider call or release its resolver ownership.
  const state = resolversOf(deps.db);
  const pending = state.pending;
  const controller = new AbortController();
  const resolution: Resolution = {
    signal: controller.signal,
    expired: () => expired,
    raisedBy,
    lookup: null,
    resent: false,
  };
  const task: Promise<RefundRow> = read(deps.db, refundId)
    .then(async (refund) => {
      if (state.stopping) return refund;
      try {
        return await resolve(deps, refund, resolver, resolution);
      } catch (error) {
        if (controller.signal.aborted) return refund;
        if (deps.stopSignal?.aborted && error === deps.stopSignal.reason) return refund;
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
    return await Promise.race([
      task.then((row) => ({
        refund: row,
        lookup: resolution.lookup,
        resent: resolution.resent,
        refusalReason: row.state === "failed" ? resolution.refusalReason : undefined,
      })),
      deadline.then((refund) => ({
        refund,
        lookup: null,
        resent: false,
        refusalReason: undefined,
      })),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
