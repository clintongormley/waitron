import { randomUUID } from "node:crypto";
import { AppError, compareDecimal, decimal, jobOrigin, sumDecimals } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CompletedRefunds,
  CardDetails,
  CardDetailFollowUp,
  CollectParams,
  CollectionOwners,
  ForwardResult,
  CaptureMismatchSink,
  IncidentSink,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
  ReaderStopResult,
  RefundAnswer,
  RefundLookup,
  RefundLookupQuery,
  RefundRefusalReason,
  RefundSend,
} from "@waitron/payments";
import {
  captureAttempting,
  fillCapturedCard,
  getPaymentByRef,
  recordCaptureMismatch,
  recordRefund,
  failAttempting,
  insertAttempting,
  listAttempting,
  listCapturesMissingCard,
  refundLookupOf,
  saveCharge,
  stampAttemptingRef,
} from "@waitron/payments";
import type { SumUpClient, SumUpTransaction, SumUpRefundEvent } from "./client.js";
import { DOCUMENTED_REFUND_REFUSALS, SUMUP_PROVIDER, refundOutcomeOf } from "./client.js";
import { reverseViaSumUp } from "./reverse.js";
import "./errors.js";

const CURRENCY = "EUR";
/** SumUp gives the reader 60 s to START the checkout, then the customer taps; two minutes covers
 * a slow tap. Longer than Stripe's 60 s window for that reason. */
const DEFAULT_POLL = {
  maxAttempts: 120,
  intervalMs: 1000,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export const RESOLVE_RETRY_MS = 60_000;
export const NOT_FOUND_GRACE_MS = 15 * 60_000;

const CARD_DETAILS_MAX_AGE_MS = 120_000;
const CARD_DETAILS_WINDOW_MS = 60_000;
const CARD_DETAILS_RETRY_MS = 20_000;
const CARD_DETAILS_MAX_ATTEMPTS = 3;

/**
 * How far before `sentAt` SumUp may stamp a REFUND event that is still the refund sent then: the
 * event carries SumUp's clock and `sentAt` the box's, so a box running ahead puts the event before
 * it. Reasoned, not measured. A time cannot say which refund an event is; the reading taken before
 * the send (`refsBeforeSend`) does.
 */
const CLOCK_ALLOWANCE_MS = 2 * 60_000;

export interface SumUpCloudProviderOptions {
  client: SumUpClient;
  db: Database;
  /** Where `resolvePending` raises `payment.pending_outcome_unactionable`. */
  incidents: IncidentSink;
  captureAlerts: CaptureMismatchSink;
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  now?: () => Date;
}

/** SumUp's `entry_mode` normalised to the receipt's four values. Its input vocabulary is
 * unverified — only `contactless` and `chip` are measured against the live reader — so anything
 * unrecognised (and an absent value) maps to `unknown` rather than being trusted through. */
export function mapEntryMode(raw: string | undefined): CardDetails["entryMode"] {
  switch (raw) {
    case "contactless":
      return "contactless";
    case "chip":
      return "chip";
    case "magstripe":
    case "swipe":
      return "swipe";
    default:
      return "unknown";
  }
}

/** Build the receipt's `CardDetails` from a transaction that carries a card object. A transaction
 * with none — or with a MALFORMED `last4` (not exactly four digits) — returns `undefined`: SumUp
 * omits card facts on some successful sales, and a bad sub-field yields an absent block, NEVER a
 * failed capture. The money has moved, and a value that would trip the `payments_card_last4_ck`
 * CHECK must be dropped here rather than block the capture write (CLAUDE.md §5). `scheme` is the
 * network as SumUp names it, underscores turned to spaces; `authCode` is null when absent. */
export function cardFromTransaction(t: SumUpTransaction): CardDetails | undefined {
  if (t.card === undefined || !/^\d{4}$/.test(t.card.last4)) return undefined;
  return {
    scheme: t.card.type.replaceAll("_", " "),
    last4: t.card.last4,
    entryMode: mapEntryMode(t.entryMode),
    authCode: t.authCode ?? null,
  };
}

type PollOutcome =
  | {
      kind: "captured";
      transactionId: string;
      settledAt: Date;
      amount: Decimal;
      card?: CardDetails;
      refunds: SumUpRefundEvent[];
    }
  | { kind: "failed" }
  | { kind: "pending"; refundUncertain?: boolean }
  | { kind: "deferred" };

interface CardDetailRetry {
  attempts: number;
  settledAt: number;
  expiresAt: number;
  dueAt: number | null;
}

/** The attempt is committed before the checkout begins. While attempting, `externalRef` is the
 * poll key; capture replaces it with the refundable transaction id. */
export class SumUpCloudProvider implements PaymentProvider {
  readonly provider = SUMUP_PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  /** SumUp's refund takes no idempotency key, so a resend could refund twice. */
  readonly refundResendWindowMs = null;
  private readonly poll: Required<NonNullable<SumUpCloudProviderOptions["poll"]>>;
  private readonly now: () => Date;
  private readonly cardDetailRetries = new Map<string, CardDetailRetry>();

  constructor(private readonly opts: SumUpCloudProviderOptions) {
    this.poll = { ...DEFAULT_POLL, ...opts.poll };
    this.now = opts.now ?? (() => new Date());
  }

  /** The adapter's ONE transaction boundary: every database phase runs through here, and the
   * adapter opens no transaction of its own. */
  private inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(this.opts.db, fn);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    // The reader ref is a PER-COLLECT input, not baked into the provider: one cached provider serves
    // every reader on this vendor, and the sale carries the reader it chose. A SumUp collect cannot
    // proceed without one — its absence is a host wiring error, not an operator condition.
    if (params.readerRef === undefined)
      throw new Error(
        "sumup collect requires a readerRef (the chosen reader's provider reference)",
      );
    await this.opts.client.prepareCollect?.();
    const readerId = params.readerRef;
    const paymentRef = randomUUID();
    const key = { provider: SUMUP_PROVIDER, paymentRef };

    // T1
    await this.inTransaction((tx) =>
      insertAttempting(tx, {
        origin: params.origin,
        workingOrderId: params.workingOrderId,
        nodeId: params.nodeId,
        provider: SUMUP_PROVIDER,
        paymentRef,
        amount: params.amount,
        billPaymentId: params.billPaymentId,
        requestedBy: params.requestedBy,
        deviceProfileId: params.deviceProfileId,
        readerId: params.readerId,
      }),
    );

    // Network: create. Three outcomes (see `CreateCheckoutOutcome`).
    let created;
    try {
      const checkout = {
        readerId,
        amount: params.amount,
        currency: CURRENCY,
        description: `waitron ${params.workingOrderId}`,
        foreignTransactionId: paymentRef,
      };
      created = await this.opts.client.createCheckout(checkout);
      if (!created.accepted && created.affiliateRejected === true) {
        await this.inTransaction((tx) =>
          this.opts.incidents(tx, {
            origin: params.origin,
            error: new AppError("payment.affiliate_rejected", { paymentRef }),
            severity: "error",
            detectedAt: this.now(),
          }),
        );
        created = await this.opts.client.createCheckout({ ...checkout, omitAffiliate: true });
      }
    } catch {
      return this.pendingResult(paymentRef);
    }
    if (!created.accepted) {
      const row = await this.inTransaction(async (tx) => {
        const current = (await getPaymentByRef(tx, key))!;
        return current.state === "attempting" ? failAttempting(tx, key) : current;
      });
      return {
        provider: SUMUP_PROVIDER,
        paymentRef,
        state: row.state,
        amount: decimal(row.amount),
        settledAt: row.settledAt === null ? null : new Date(row.settledAt),
      };
    }

    // T1.5
    await this.inTransaction((tx) => stampAttemptingRef(tx, key, created.clientTransactionId));

    let collecting = true;
    let stopInFlight: Promise<ReaderStopResult> | undefined;
    params.onReaderCheckout?.(() => {
      if (!collecting) return Promise.resolve("unavailable");
      stopInFlight ??= this.stopReader(readerId, () => collecting).finally(() => {
        stopInFlight = undefined;
      });
      return stopInFlight;
    });

    // Poll — outside any transaction.
    const outcome = await this.pollUntilResolved({
      clientTransactionId: created.clientTransactionId,
    });
    collecting = false;
    // SumUp stops the reader's current checkout. Keep this attempt live until dispatch ends.
    await stopInFlight;

    // T2 — only a captured or failed outcome is a basis for it.
    if (outcome.kind === "pending" || outcome.kind === "deferred") {
      if (outcome.kind === "pending" && outcome.refundUncertain)
        await this.inTransaction((tx) =>
          this.refundIncident(tx, paymentRef, "refund_pending", this.now()),
        );
      return this.pendingResult(paymentRef);
    }
    const card = outcome.kind === "captured" ? outcome.card : undefined;
    const save = () =>
      this.inTransaction(async (tx) => {
        const current = await getPaymentByRef(tx, key);
        if (current?.state !== "attempting") return current!;
        if (outcome.kind === "captured") {
          if (compareDecimal(outcome.amount, params.amount) !== 0) {
            await recordCaptureMismatch(
              tx,
              this.opts.captureAlerts,
              {
                ...key,
                workingOrderId: params.workingOrderId,
                externalRef: outcome.transactionId,
                requestedAmount: params.amount,
                reportedAmount: outcome.amount,
              },
              outcome.settledAt,
            );
          }
          if (compareDecimal(outcome.amount, decimal("0")) === 0) return failAttempting(tx, key);
          await captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
            card,
            amount: outcome.amount,
          });
          await this.saveRefunds(tx, key, outcome);
          return (await getPaymentByRef(tx, key))!;
        }
        return failAttempting(tx, key);
      });
    const row = outcome.kind === "captured" ? await saveCharge(save) : await save();
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: row.state,
      amount: decimal(row.amount),
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
      card,
    };
  }

  private async stopReader(readerId: string, collecting: () => boolean): Promise<ReaderStopResult> {
    try {
      const status = await this.opts.client.readerStatus(readerId);
      if (!collecting() || !status.online || status.activity !== "WAITING_FOR_CARD") {
        return "unavailable";
      }
      return (await this.opts.client.terminateCheckout(readerId)) ? "requested" : "refused";
    } catch {
      return "unknown";
    }
  }

  private async pendingResult(paymentRef: string): Promise<PaymentResult> {
    const row = (await this.inTransaction((tx) =>
      getPaymentByRef(tx, { provider: SUMUP_PROVIDER, paymentRef }),
    ))!;
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: row.state,
      amount: decimal(row.amount),
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  async lookupCompletedRefunds(processorRef: string): Promise<CompletedRefunds> {
    try {
      const transaction = await this.opts.client.findTransaction({ id: processorRef });
      if (transaction?.refundEvents === undefined) return { kind: "unknown" };
      const outcome = SumUpCloudProvider.classify(transaction, this.now());
      if (outcome.kind !== "captured") return { kind: "unknown" };
      return {
        kind: "known",
        processorRef: outcome.transactionId,
        captured: outcome.amount,
        refunds: outcome.refunds.map((refund) => ({
          providerRefundRef: refund.id,
          amount: refund.amount,
        })),
      };
    } catch {
      return { kind: "unknown" };
    }
  }

  static classify(t: SumUpTransaction | null, now: Date): PollOutcome {
    if (t === null || t.status === "PENDING") return { kind: "pending" };
    if (t.status === "SUCCESSFUL" || t.status === "REFUNDED") {
      const events = new Map<string, SumUpRefundEvent>();
      for (const event of t.refundEvents ?? []) {
        const prior = events.get(event.id);
        if (
          prior !== undefined &&
          (refundOutcomeOf(prior.status) !== refundOutcomeOf(event.status) ||
            compareDecimal(prior.amount, event.amount) !== 0 ||
            Date.parse(prior.timestamp) !== Date.parse(event.timestamp))
        )
          return { kind: "pending", refundUncertain: true };
        events.set(event.id, event);
      }
      const refunds = [...events.values()].filter((e) => refundOutcomeOf(e.status) === "completed");
      if (
        t.refundEvidenceInvalid ||
        [...events.values()].some(
          (e) =>
            refundOutcomeOf(e.status) === "pending" || compareDecimal(e.amount, decimal("0")) <= 0,
        ) ||
        compareDecimal(sumDecimals(refunds.map((e) => e.amount)), t.amount) > 0 ||
        (t.status === "REFUNDED" && refunds.length === 0)
      )
        return { kind: "pending", refundUncertain: true };
      return {
        kind: "captured",
        transactionId: t.id,
        amount: t.amount,
        settledAt: now,
        card: cardFromTransaction(t),
        refunds,
      };
    }
    if (t.status === "FAILED" || t.status === "CANCELLED") return { kind: "failed" };
    return { kind: "deferred" };
  }

  /** Poll until a T2 decision or the window closes. A network error mid-poll and an exhausted
   * window both come back as `pending`: the caller leaves the row `attempting` either way. */
  private async pollUntilResolved(query: { clientTransactionId: string }): Promise<PollOutcome> {
    let last: PollOutcome = { kind: "pending" };
    try {
      for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
        const outcome = SumUpCloudProvider.classify(
          await this.opts.client.findTransaction(query),
          this.now(),
        );
        if (outcome.kind !== "pending") return outcome;
        last = outcome;
        await this.poll.sleep(this.poll.intervalMs);
      }
      return last;
    } catch {
      return last;
    }
  }

  private refundIncident(
    tx: Transaction,
    paymentRef: string,
    status: string,
    now: Date,
  ): Promise<boolean> {
    return this.opts.incidents(tx, {
      origin: jobOrigin("payment_check"),
      error: new AppError("payment.pending_outcome_unactionable", { paymentRef, status }),
      severity: "error",
      detectedAt: now,
    });
  }

  private async saveRefunds(
    tx: Transaction,
    key: { provider: string; paymentRef: string },
    outcome: Extract<PollOutcome, { kind: "captured" }>,
  ): Promise<boolean> {
    if (outcome.refunds.length === 0) return false;
    for (const refund of outcome.refunds)
      await recordRefund(tx, { ...key, amount: refund.amount, providerRefundRef: refund.id });
    const row = (await getPaymentByRef(tx, key))!;
    return this.refundIncident(
      tx,
      key.paymentRef,
      row.state === "refunded" ? "refund_completed" : "partial_refund",
      outcome.settledAt,
    );
  }

  async fillMissingCardDetails(
    owners: CollectionOwners,
    onOutcome: (result: CardDetailFollowUp) => void,
    signal?: AbortSignal,
  ): Promise<Date | null> {
    if (signal?.aborted) return null;
    const discoveredAt = this.now().getTime();
    const rows = await listCapturesMissingCard(
      this.opts.db,
      SUMUP_PROVIDER,
      owners,
      new Date(discoveredAt - CARD_DETAILS_MAX_AGE_MS),
    );
    const report = (
      outcome: CardDetailFollowUp["outcome"],
      paymentRef: string,
      retry: CardDetailRetry,
    ) =>
      onOutcome({
        outcome,
        paymentRef,
        attempts: retry.attempts,
        ageSeconds: Math.max(0, Math.floor((this.now().getTime() - retry.settledAt) / 1_000)),
      });
    const refs = new Set(rows.map((row) => row.paymentRef));
    for (const [ref, retry] of this.cardDetailRetries) {
      if (refs.has(ref)) continue;
      this.cardDetailRetries.delete(ref);
      if (retry.dueAt !== null && discoveredAt > retry.expiresAt) report("exhausted", ref, retry);
    }

    let nextDueAt = Infinity;
    for (const row of rows) {
      if (signal?.aborted) return null;
      const at = this.now().getTime();
      const settledAt = Date.parse(row.settledAt);
      if (settledAt > at) continue;
      const ref = row.paymentRef;
      const retry = this.cardDetailRetries.get(ref) ?? {
        attempts: 0,
        settledAt,
        expiresAt: Math.min(
          settledAt + CARD_DETAILS_MAX_AGE_MS,
          discoveredAt + CARD_DETAILS_WINDOW_MS,
        ),
        dueAt: at,
      };
      this.cardDetailRetries.set(ref, retry);
      if (retry.dueAt === null) continue;
      if (at > retry.expiresAt) {
        retry.dueAt = null;
        report("exhausted", ref, retry);
        continue;
      }
      if (retry.dueAt <= at) {
        const card = await this.lookupCapturedCard(row.externalRef, row.amount);
        if (signal?.aborted) return null;
        retry.attempts += 1;
        if (card !== undefined) {
          try {
            // Recheck the stop inside the write turn in case shutdown began while we queued for it.
            const filled = await this.inTransaction(
              async (tx) =>
                !signal?.aborted &&
                fillCapturedCard(
                  tx,
                  { provider: SUMUP_PROVIDER, paymentRef: ref, externalRef: row.externalRef },
                  card,
                ),
            );
            retry.dueAt = null;
            if (filled) report("filled", ref, retry);
            continue;
          } catch {
            // A write refusal uses the same retry budget and leaves the next capture eligible.
          }
        }
        retry.dueAt = at + CARD_DETAILS_RETRY_MS;
        if (retry.attempts >= CARD_DETAILS_MAX_ATTEMPTS || retry.dueAt > retry.expiresAt) {
          retry.dueAt = null;
          report("exhausted", ref, retry);
          continue;
        }
      }
      nextDueAt = Math.min(nextDueAt, retry.dueAt);
    }
    return Number.isFinite(nextDueAt) ? new Date(nextDueAt) : null;
  }

  private async lookupCapturedCard(externalRef: string, amount: Decimal) {
    try {
      const t = await this.opts.client.findTransaction({ id: externalRef });
      if (
        t?.id === externalRef &&
        t.status === "SUCCESSFUL" &&
        compareDecimal(t.amount, amount) === 0 &&
        (t.currency === undefined || t.currency === CURRENCY)
      )
        return cardFromTransaction(t);
    } catch {
      // The settled payment remains printable even when SumUp cannot supply card details.
    }
    return undefined;
  }

  async resolvePending(
    now: Date,
    owners: CollectionOwners,
    signal?: AbortSignal,
  ): Promise<ForwardResult> {
    const rows = await this.inTransaction((tx) => listAttempting(tx, SUMUP_PROVIDER, owners));
    if (rows.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    let forwarded = 0;
    let declined = 0;
    let incidentsRaised = 0;
    let deferred = false;
    const resolve = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof AppError && error.code === "payment.not_found") return undefined;
        throw error;
      }
    };
    const unresolved = (tx: Transaction, paymentRef: string, status: string) =>
      this.opts.incidents(tx, {
        origin: jobOrigin("payment_check"),
        error: new AppError("payment.pending_outcome_unactionable", { paymentRef, status }),
        severity: "error",
        detectedAt: now,
      });
    const failWith = (
      key: { provider: string; paymentRef: string },
      status: string | null,
    ): Promise<{ resolved: boolean; raised: boolean }> =>
      this.inTransaction(async (tx) => {
        if ((await resolve(() => failAttempting(tx, key))) === undefined)
          return { resolved: false, raised: false };
        if (status === null) return { resolved: true, raised: false };
        const raised = await unresolved(tx, key.paymentRef, status);
        return { resolved: true, raised };
      });
    for (const row of rows) {
      if (signal?.aborted) {
        deferred = true;
        break;
      }
      const key = { provider: SUMUP_PROVIDER, paymentRef: row.paymentRef };
      let t: SumUpTransaction | null;
      try {
        t = await this.opts.client.findTransaction(
          row.externalRef === null
            ? { foreignTransactionId: row.paymentRef }
            : { clientTransactionId: row.externalRef },
        );
      } catch {
        deferred = true;
        continue;
      }
      if (t === null) {
        if (now.getTime() - new Date(row.createdAt).getTime() < NOT_FOUND_GRACE_MS) {
          deferred = true;
          continue;
        }
        // A not-found we cannot correlate to a key SumUp recorded is an uncertain charge — surface it.
        const failed = await failWith(key, "not_found");
        if (failed.raised) incidentsRaised++;
        if (failed.resolved) declined++;
        continue;
      }
      const outcome = SumUpCloudProvider.classify(t, now);
      if (outcome.kind === "pending") {
        deferred = true;
        if (
          outcome.refundUncertain &&
          (await this.inTransaction(async (tx) => {
            if ((await getPaymentByRef(tx, key))?.state !== "attempting") return false;
            return this.refundIncident(tx, key.paymentRef, "refund_pending", now);
          }))
        )
          incidentsRaised++;
        continue;
      }
      if (outcome.kind === "captured") {
        const captured = await this.inTransaction(async (tx) => {
          const current = await getPaymentByRef(tx, key);
          if (current?.state !== "attempting") {
            if (current?.state === "failed" && (await unresolved(tx, key.paymentRef, t.status)))
              incidentsRaised++;
            return false;
          }
          if (compareDecimal(outcome.amount, decimal(row.amount)) !== 0) {
            if (
              await recordCaptureMismatch(
                tx,
                this.opts.captureAlerts,
                {
                  ...key,
                  workingOrderId: row.workingOrderId,
                  externalRef: outcome.transactionId,
                  requestedAmount: row.amount,
                  reportedAmount: outcome.amount,
                },
                now,
              )
            )
              incidentsRaised++;
          }
          if (compareDecimal(outcome.amount, decimal("0")) === 0) {
            await failAttempting(tx, key);
            declined++;
            return false;
          }
          // SumUp's `timestamp` is when the checkout began, not the tap
          // (docs/research/2026-09-10-sumup-solo-experiments.md). A time outside the span from this
          // row's `created_at` to its `settled_at`, or none, gives way to `created_at`.
          const createdAt = Date.parse(row.createdAt);
          const sumupTime = t.timestamp === undefined ? NaN : Date.parse(t.timestamp);
          const plausible = sumupTime >= createdAt && sumupTime <= outcome.settledAt.getTime();
          await captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
            card: outcome.card,
            amount: outcome.amount,
            checkoutStartedAt: new Date(plausible ? sumupTime : createdAt),
          });
          if (await this.saveRefunds(tx, key, outcome)) incidentsRaised++;
          return true;
        });
        if (captured) forwarded++;
        continue;
      }
      // Unknown transaction statuses need a provider check.
      const status = outcome.kind === "deferred" ? t.status : null;
      const failed = await failWith(key, status);
      if (failed.raised) incidentsRaised++;
      if (failed.resolved) declined++;
    }
    return {
      nextDueAt: deferred ? new Date(now.getTime() + RESOLVE_RETRY_MS) : null,
      forwarded,
      declined,
      incidentsRaised,
    };
  }

  /** SumUp answers an accepted refund `201` with the body `{}`, so it names no refund and only
   * `lookupRefund` can find it. */
  async sendRefund(req: RefundSend): Promise<RefundAnswer> {
    let httpStatus: number;
    let reason: RefundRefusalReason | undefined;
    try {
      ({ httpStatus, reason } = await this.opts.client.sendRefund({
        transactionId: req.processorRef,
        amount: req.amount,
      }));
    } catch (error) {
      const timedOut = (error as { name?: unknown } | null)?.name === "AbortError";
      return { kind: "uncertain", reason: timedOut ? "timeout" : "network" };
    }
    if (httpStatus >= 200 && httpStatus < 300) return { kind: "accepted" };
    if (httpStatus >= 500) return { kind: "uncertain", reason: "server_error", httpStatus };
    return {
      kind: "refused",
      httpStatus,
      documented: DOCUMENTED_REFUND_REFUSALS.has(httpStatus),
      ...(httpStatus === 409 && reason === "provider_balance_unavailable" ? { reason } : {}),
    };
  }

  /** SumUp's refunds carry none of our ids, so an event can be told from an earlier refund only by
   * this reading, taken before the send. An answer listing no events cannot say. */
  async existingRefundRefs(processorRef: string): Promise<string[]> {
    const t = await this.opts.client.findTransaction({ id: processorRef });
    if (t === null) return [];
    if (t.refundEvents === undefined) throw new Error("SumUp listed no events of the transaction");
    return t.refundEvents.map((event) => event.id);
  }

  /** A `REFUND` event of the transaction for the same amount, not one of `excludeRefs` nor of
   * `refsBeforeSend`, stamped after `sentAt` less {@link CLOCK_ALLOWANCE_MS}. Without
   * `refsBeforeSend`, an event stamped before `sentAt` may be a refund made before the send, so it
   * is `ambiguous`, never a match. */
  async lookupRefund(query: RefundLookupQuery): Promise<RefundLookup> {
    let t: SumUpTransaction | null;
    try {
      t = await this.opts.client.findTransaction({ id: query.processorRef });
    } catch {
      return { kind: "unreachable" };
    }
    const sentAt = query.sentAt.getTime();
    const candidates = (t?.refundEvents ?? []).filter(
      (event) =>
        Date.parse(event.timestamp) >= sentAt - CLOCK_ALLOWANCE_MS &&
        compareDecimal(event.amount, query.amount) === 0 &&
        !query.excludeRefs.includes(event.id) &&
        !(query.refsBeforeSend?.includes(event.id) ?? false),
    );
    return refundLookupOf(
      candidates,
      (event) => ({
        providerRefundRef: event.id,
        outcome: refundOutcomeOf(event.status),
        providerStatus: event.status,
      }),
      query.refsBeforeSend === undefined &&
        candidates.some((event) => Date.parse(event.timestamp) < sentAt),
    );
  }

  /** void / refund / partialRefund all share one reversal path (`reverseViaSumUp`); a `void` is a
   * full refund at SumUp (there is no separate void endpoint), a `partialRefund` carries the
   * amount. */
  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaSumUp(this.opts.db, this.opts.client, ref, kind, amount);
  }
  void(ref: string): Promise<PaymentResult> {
    return this.reverse("void", ref);
  }
  refund(ref: string): Promise<PaymentResult> {
    return this.reverse("refund", ref);
  }
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return this.reverse("refund", ref, amount);
  }
}
