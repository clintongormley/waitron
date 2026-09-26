import { randomUUID } from "node:crypto";
import { AppError, compareDecimal, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { UNIQUE_VIOLATION, refusalOn, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  AbandonedAttemptOutcome,
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import {
  captureAttempting,
  countProviderCancelledResolutions,
  failAttempting,
  getPaymentByRef,
  insertAttempting,
  stampAttemptingRef,
} from "@waitron/payments";
import { fromMinorUnits, workingOrderIdempotencyKey } from "./client.js";
import type { StripeClient } from "./client.js";
import "./errors.js";
import { reverseViaStripe } from "./reverse.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";
/** Stripe (stripe@22.6.2, `PaymentIntents.d.ts`): "You can cancel a PaymentIntent object when it's
 * in one of these statuses: requires_payment_method, requires_capture, requires_confirmation,
 * requires_action or, in rare cases, processing." */
const CANCELLABLE = new Set([
  "requires_payment_method",
  "requires_capture",
  "requires_confirmation",
  "requires_action",
  "processing",
]);
const EXTERNAL_REF_KEY = { table: "payments", columns: ["provider", "external_ref"] };
const DEFAULT_POLL = {
  maxAttempts: 60,
  intervalMs: 1000,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export interface StripeTerminalProviderOptions {
  client: StripeClient;
  db: Database;
  /** Passed to `reverseViaStripe`, which does not read it. */
  nodeId: string;
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

/** The server-driven Stripe Terminal `PaymentProvider`. `collect` commits an `attempting` row
 * BEFORE the network call, so a crash during it still leaves a local row; that is why, unlike the
 * on-device and hosted creates, it stamps no attribution metadata. A stalled or failed reader
 * resolves to `failed` rather than a throw.
 *
 * The row carries its PaymentIntent id before the reader is asked to process it, and a PaymentIntent
 * the row could not claim is never processed. So an `attempting` row with no id never reached a
 * reader, which `resolveAbandonedAttempt` relies on. */
export class StripeTerminalProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private readonly poll: Required<NonNullable<StripeTerminalProviderOptions["poll"]>>;

  constructor(private readonly opts: StripeTerminalProviderOptions) {
    this.poll = { ...DEFAULT_POLL, ...opts.poll };
  }

  /** Guard: `tenant-scoping.test.ts` refuses a bare `.transaction(` in this package's sources. */
  private inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(this.opts.db, fn);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    // Per-collect, not per-provider: one cached provider serves every reader on this vendor.
    if (params.readerRef === undefined)
      throw new Error(
        "stripe collect requires a readerRef (the chosen reader's provider reference)",
      );
    const readerId = params.readerRef;
    const paymentRef = randomUUID();
    const key = { provider: PROVIDER, paymentRef };

    // Commit the attempt before any network call.
    const stripeIdempotencyKey = await this.inTransaction(async (tx) => {
      await insertAttempting(tx, {
        workingOrderId: params.workingOrderId,
        provider: PROVIDER,
        paymentRef,
        amount: params.amount,
      });
      const cancelled = await countProviderCancelledResolutions(tx, {
        provider: PROVIDER,
        workingOrderId: params.workingOrderId,
      });
      return workingOrderIdempotencyKey(params.workingOrderId, cancelled);
    });

    const outcome = await this.drive(readerId, params.amount, stripeIdempotencyKey, (piId) =>
      this.stamp(key, piId),
    );

    if (outcome.kind === "unclaimed") {
      // A row already resolved by someone else stays as they left it.
      if (outcome.claim === "held_elsewhere") {
        await this.inTransaction((tx) => failAttempting(tx, key));
      }
      return {
        provider: PROVIDER,
        paymentRef,
        state: "failed",
        amount: params.amount,
        settledAt: null,
      };
    }
    const row = await this.inTransaction((tx) =>
      outcome.kind === "captured"
        ? captureAttempting(tx, { ...key, settledAt: outcome.settledAt, externalRef: outcome.piId })
        : failAttempting(tx, key),
    );
    return {
      provider: PROVIDER,
      paymentRef,
      state: row.state,
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  /** `held_elsewhere`: another payment row already carries this PaymentIntent, so it may be live on
   * a reader right now. `not_attempting`: the row was resolved before the stamp landed. */
  private async stamp(
    key: { provider: string; paymentRef: string },
    piId: string,
  ): Promise<"stamped" | "held_elsewhere" | "not_attempting"> {
    try {
      const stamped = await this.inTransaction((tx) => stampAttemptingRef(tx, key, piId));
      return stamped ? "stamped" : "not_attempting";
    } catch (error) {
      if (refusalOn(error, UNIQUE_VIOLATION, EXTERNAL_REF_KEY)) return "held_elsewhere";
      throw error;
    }
  }

  /** Server-driven fixed-counter readers have no device-local offline queue, so a
   * `StripeTerminalProvider` never holds `accepted_offline` payments to forward: the pass is always a
   * no-op. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface; a no-op forward ignores it
  forward(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  /** `collect` resolves its own `attempting` row before it returns. A row a crash leaves between the
   * two transactions is not resolved here: while a collect is live its PaymentIntent awaits the
   * card, so an automatic cancel would cancel a payment a customer is about to make. A person
   * resolves such a row through `resolveAbandonedAttempt`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface
  resolvePending(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  /** The network half of `collect`, one row's PaymentIntent from creation to a final reader outcome.
   * Every failure — an error at any step, a decline or a timeout — returns `failed`; a timeout or an
   * error first cancels the reader action, best-effort, so the terminal is not left mid-action. A
   * PaymentIntent `claim` could not stamp on the row is never processed, and its reader action is
   * left alone: another payment may be using it. */
  private async drive(
    readerId: string,
    amount: Decimal,
    idempotencyKey: string,
    claim: (piId: string) => Promise<"stamped" | "held_elsewhere" | "not_attempting">,
  ): Promise<
    | { kind: "captured"; settledAt: Date; piId: string }
    | { kind: "failed" }
    | { kind: "unclaimed"; claim: "held_elsewhere" | "not_attempting" }
  > {
    let piId: string;
    try {
      const intent = await this.opts.client.createPaymentIntent({
        amount,
        currency: CURRENCY,
        idempotencyKey,
      });
      piId = intent.id;
    } catch {
      await this.cancelReaderAction(readerId);
      return { kind: "failed" };
    }

    const claimed = await claim(piId);
    if (claimed !== "stamped") return { kind: "unclaimed", claim: claimed };

    try {
      await this.opts.client.processPaymentIntent(readerId, piId);
      for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
        const o = await this.opts.client.readerOutcome(readerId);
        if (o.status === "succeeded") return { kind: "captured", settledAt: new Date(), piId };
        if (o.status === "failed") return { kind: "failed" };
        await this.poll.sleep(this.poll.intervalMs);
      }
      await this.cancelReaderAction(readerId);
      return { kind: "failed" };
    } catch {
      await this.cancelReaderAction(readerId);
      return { kind: "failed" };
    }
  }

  /** Best-effort: a reader that refuses the cancel changes nothing about the payment's outcome. */
  private cancelReaderAction(readerId: string): Promise<void> {
    return this.opts.client.cancelReaderAction(readerId).catch(() => {});
  }

  /** Called only for an attempt nothing in this process is still driving. Reads the row, asks
   * Stripe with no transaction open, then writes: a PaymentIntent still awaiting its card is
   * cancelled first and read again, because the cancel can lose a race to the card. */
  async resolveAbandonedAttempt(paymentRef: string, now: Date): Promise<AbandonedAttemptOutcome> {
    const key = { provider: PROVIDER, paymentRef };
    const row = await this.inTransaction((tx) => getPaymentByRef(tx, key));
    if (row?.state !== "attempting") throw new AppError("payment.not_found", key);

    if (row.externalRef === null) {
      await this.inTransaction((tx) => failAttempting(tx, key));
      return { outcome: "failed", cancelledAtProvider: false };
    }
    const piId = row.externalRef;
    const first = await this.readIntent(piId);
    if (first === undefined) return { outcome: "unknown", reason: "unreachable" };
    if (!CANCELLABLE.has(first.status)) return this.settleFrom(key, row.amount, first, now);

    await this.opts.client.cancelPaymentIntent(piId).catch(() => {});
    const after = await this.readIntent(piId);
    if (after === undefined) return { outcome: "unknown", reason: "unreachable" };
    return this.settleFrom(key, row.amount, after, now);
  }

  private readIntent(
    piId: string,
  ): Promise<{ id: string; status: string; amountReceived: number } | undefined> {
    return this.opts.client.retrievePaymentIntent(piId).catch(() => undefined);
  }

  /** A `canceled` PaymentIntent counts as cancelled at the provider whoever cancelled it: either way
   * the order's key must move on (`workingOrderIdempotencyKey`). Any status still awaiting the card
   * here is one a cancel did not move, so it is left for a person. */
  private async settleFrom(
    key: { provider: string; paymentRef: string },
    amount: string,
    intent: { id: string; status: string; amountReceived: number },
    now: Date,
  ): Promise<AbandonedAttemptOutcome> {
    if (intent.status === "succeeded") {
      if (compareDecimal(fromMinorUnits(intent.amountReceived), decimal(amount)) !== 0) {
        return { outcome: "unknown", reason: "ambiguous", providerStatus: intent.status };
      }
      await this.inTransaction((tx) =>
        captureAttempting(tx, { ...key, settledAt: now, externalRef: intent.id }),
      );
      return { outcome: "captured" };
    }
    if (intent.status === "canceled") {
      await this.inTransaction((tx) => failAttempting(tx, key));
      return { outcome: "failed", cancelledAtProvider: true };
    }
    return { outcome: "unknown", reason: "ambiguous", providerStatus: intent.status };
  }

  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, kind, amount, {
      nodeId: this.opts.nodeId,
    });
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
