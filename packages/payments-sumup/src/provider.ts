import { randomUUID } from "node:crypto";
import { AppError, compareDecimal, decimal, jobOrigin } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CardDetails,
  CollectParams,
  CollectionOwners,
  ForwardResult,
  CaptureMismatchSink,
  IncidentSink,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
  RefundAnswer,
  RefundLookup,
  RefundLookupQuery,
  RefundOutcome,
  RefundSend,
} from "@waitron/payments";
import {
  captureAttempting,
  getPaymentByRef,
  hasCaptureMismatch,
  recordCaptureMismatch,
  failAttempting,
  insertAttempting,
  listAttempting,
  refundLookupOf,
  saveCharge,
  stampAttemptingRef,
} from "@waitron/payments";
import type { SumUpClient, SumUpTransaction } from "./client.js";
import { SUMUP_PROVIDER } from "./client.js";
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
/** How long a row SumUp holds NO transaction for is still "pending". A create whose response was
 * lost may have been accepted; SumUp's own 60 s reader window plus a generous tap allowance is far
 * inside 15 min. After it, SumUp having nothing means no money moved: `failed`, no incident. */
export const NOT_FOUND_GRACE_MS = 15 * 60_000;

/**
 * Refusals of `POST /v1.0/merchants/{merchant_code}/payments/{transaction_id}/refunds` that SumUp's
 * OpenAPI file (`RefundTransaction`, read 2026-09-27) documents as the refund not happening: "'400':
 * The refund request is invalid.", "'403': The request is authenticated but not permitted for this
 * operation.", "'404': The requested transaction does not exist or does not belong to the
 * merchant.", "'409': The transaction cannot be refunded due to business constraints." and "'422':
 * The refund could not be processed by the payment processor." None says "not created" in those
 * words. No 401, 429 or 5xx is documented for this operation, so those settle nothing.
 */
const DOCUMENTED_REFUND_REFUSALS = new Set([400, 403, 404, 409, 422]);

/**
 * How far before `sentAt` SumUp may stamp a REFUND event that is still the refund sent then: the
 * event carries SumUp's clock and `sentAt` the box's, so a box running ahead puts the event before
 * it. Reasoned, not measured. A time cannot say which refund an event is; the reading taken before
 * the send (`refsBeforeSend`) does.
 */
const CLOCK_ALLOWANCE_MS = 2 * 60_000;

/** SumUp's event statuses: "`REFUNDED`: A refund event has been accepted and recorded in the refund
 * flow", "`SUCCESSFUL`: The event completed successfully", "`FAILED`: The event could not be
 * completed" and "`PENDING`: … whose final outcome is not known yet"
 * (https://developer.sumup.com/api/transactions). A status it adds later is `pending`. */
function refundOutcomeOf(status: string): RefundOutcome {
  if (status === "REFUNDED" || status === "SUCCESSFUL") return "completed";
  if (status === "FAILED") return "failed";
  return "pending";
}

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

/** One SumUp status mapped onto a T2 decision, as DATA. `pending` = keep polling; `deferred` = a
 * status this adapter is not entitled to act on (`REFUNDED`, unknown) — the loop stops, the row
 * stays `attempting`, and `resolvePending` decides. `card` rides the `captured`
 * variant so both capture paths persist it without re-fetching the transaction. */
type PollOutcome =
  | {
      kind: "captured";
      transactionId: string;
      settledAt: Date;
      amount: Decimal;
      card?: CardDetails;
    }
  | { kind: "failed" }
  | { kind: "pending" }
  | { kind: "deferred" };

/** The attempt is committed before the checkout begins. While attempting, `externalRef` is the
 * poll key; capture replaces it with the refundable transaction id. */
export class SumUpCloudProvider implements PaymentProvider {
  readonly provider = SUMUP_PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  /** SumUp's refund takes no idempotency key, so a resend could refund twice. */
  readonly refundResendWindowMs = null;
  private readonly poll: Required<NonNullable<SumUpCloudProviderOptions["poll"]>>;
  private readonly now: () => Date;

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
        deviceProfileId: params.deviceProfileId,
        readerId: params.readerId,
      }),
    );

    // Network: create. Three outcomes (see `CreateCheckoutOutcome`).
    let created;
    try {
      created = await this.opts.client.createCheckout({
        readerId,
        amount: params.amount,
        currency: CURRENCY,
        description: `waitron ${params.workingOrderId}`,
        foreignTransactionId: paymentRef,
      });
    } catch {
      return this.pendingResult(paymentRef, params.amount);
    }
    if (!created.accepted) {
      const row = await this.inTransaction(async (tx) =>
        (await hasCaptureMismatch(tx, key))
          ? (await getPaymentByRef(tx, key))!
          : failAttempting(tx, key),
      );
      return {
        provider: SUMUP_PROVIDER,
        paymentRef,
        state: row.state,
        ...(row.state === "attempting" &&
        (await this.inTransaction((tx) => hasCaptureMismatch(tx, key)))
          ? { captureMismatch: true as const }
          : {}),
        amount: params.amount,
        settledAt: null,
      };
    }

    // T1.5
    await this.inTransaction((tx) => stampAttemptingRef(tx, key, created.clientTransactionId));

    // Poll — outside any transaction.
    const outcome = await this.pollUntilResolved({
      clientTransactionId: created.clientTransactionId,
    });

    // T2 — only a captured or failed outcome is a basis for it.
    if (outcome.kind === "pending" || outcome.kind === "deferred") {
      return this.pendingResult(paymentRef, params.amount);
    }
    const card = outcome.kind === "captured" ? outcome.card : undefined;
    const save = () =>
      this.inTransaction(async (tx) => {
        if (await hasCaptureMismatch(tx, key)) return (await getPaymentByRef(tx, key))!;
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
            return (await getPaymentByRef(tx, key))!;
          }
          return captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
            card,
          });
        }
        return failAttempting(tx, key);
      });
    const row = outcome.kind === "captured" ? await saveCharge(save) : await save();
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: row.state,
      ...(row.state === "attempting" &&
      (await this.inTransaction((tx) => hasCaptureMismatch(tx, key)))
        ? { captureMismatch: true as const }
        : {}),
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
      card,
    };
  }

  private async pendingResult(paymentRef: string, amount: Decimal): Promise<PaymentResult> {
    const captureMismatch = await this.inTransaction((tx) =>
      hasCaptureMismatch(tx, { provider: SUMUP_PROVIDER, paymentRef }),
    );
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: "attempting",
      amount,
      settledAt: null,
      ...(captureMismatch ? { captureMismatch: true as const } : {}),
    };
  }

  static classify(t: SumUpTransaction | null, now: Date): PollOutcome {
    if (t === null || t.status === "PENDING") return { kind: "pending" };
    if (t.status === "SUCCESSFUL")
      return {
        kind: "captured",
        transactionId: t.id,
        amount: t.amount,
        settledAt: now,
        card: cardFromTransaction(t),
      };
    if (t.status === "FAILED" || t.status === "CANCELLED") return { kind: "failed" };
    return { kind: "deferred" };
  }

  /** Poll until a T2 decision or the window closes. A network error mid-poll and an exhausted
   * window both come back as `pending`: the caller leaves the row `attempting` either way. */
  private async pollUntilResolved(query: { clientTransactionId: string }): Promise<PollOutcome> {
    try {
      for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
        const outcome = SumUpCloudProvider.classify(
          await this.opts.client.findTransaction(query),
          this.now(),
        );
        if (outcome.kind !== "pending") return outcome;
        await this.poll.sleep(this.poll.intervalMs);
      }
      return { kind: "pending" };
    } catch {
      return { kind: "pending" };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface; a no-op forward ignores it
  forward(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }
  // Known amount mismatches stay attempting, including after their alert is handled.
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
    // Recheck evidence in the same transaction as the outcome; the lookup ran without the lock.
    const failWith = (
      key: { provider: string; paymentRef: string },
      status: string | null,
    ): Promise<{ resolved: boolean; raised: boolean }> =>
      this.inTransaction(async (tx) => {
        if (await hasCaptureMismatch(tx, key)) return { resolved: false, raised: false };
        await failAttempting(tx, key);
        if (status === null) return { resolved: true, raised: false };
        const raised = await this.opts.incidents(tx, {
          origin: jobOrigin("payment_check"),
          error: new AppError("payment.pending_outcome_unactionable", {
            paymentRef: key.paymentRef,
            status,
          }),
          severity: "error",
          detectedAt: now,
        });
        return { resolved: true, raised };
      });
    for (const row of rows) {
      if (signal?.aborted) {
        deferred = true;
        break;
      }
      const key = { provider: SUMUP_PROVIDER, paymentRef: row.paymentRef };
      if (await this.inTransaction((tx) => hasCaptureMismatch(tx, key))) continue;
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
        continue;
      }
      if (outcome.kind === "captured") {
        const captured = await this.inTransaction(async (tx) => {
          if ((await getPaymentByRef(tx, key))?.state !== "attempting") return false;
          if (await hasCaptureMismatch(tx, key)) return false;
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
            return false;
          }
          await captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
            card: outcome.card,
          });
          return true;
        });
        if (captured) forwarded++;
        continue;
      }
      // failed → no incident; deferred (REFUNDED / unknown) → incident naming the status.
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
    try {
      ({ httpStatus } = await this.opts.client.sendRefund({
        transactionId: req.processorRef,
        amount: req.amount,
      }));
    } catch (error) {
      const timedOut = (error as { name?: unknown } | null)?.name === "AbortError";
      return { kind: "uncertain", reason: timedOut ? "timeout" : "network" };
    }
    if (httpStatus >= 200 && httpStatus < 300) return { kind: "accepted" };
    if (httpStatus >= 500) return { kind: "uncertain", reason: "server_error", httpStatus };
    return { kind: "refused", httpStatus, documented: DOCUMENTED_REFUND_REFUSALS.has(httpStatus) };
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
