import { randomUUID } from "node:crypto";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import { captureAttempting, failAttempting, insertAttempting } from "@waitron/payments";
import { workingOrderIdempotencyKey } from "./client.js";
import type { StripeClient } from "./client.js";
import "./errors.js";
import { reverseViaStripe } from "./reverse.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";
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
 * resolves to `failed` rather than a throw. */
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
    const stripeIdempotencyKey = workingOrderIdempotencyKey(params.workingOrderId);
    const key = { provider: PROVIDER, paymentRef };

    // Commit the attempt before any network call.
    await this.inTransaction((tx) =>
      insertAttempting(tx, {
        workingOrderId: params.workingOrderId,
        provider: PROVIDER,
        paymentRef,
        amount: params.amount,
      }),
    );

    const outcome = await this.drive(readerId, params.amount, stripeIdempotencyKey);

    const row = await this.inTransaction((tx) =>
      outcome.captured
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

  /** Server-driven fixed-counter readers have no device-local offline queue, so a
   * `StripeTerminalProvider` never holds `accepted_offline` payments to forward: the pass is always a
   * no-op. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface; a no-op forward ignores it
  forward(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  /** `collect` resolves its own `attempting` row before it returns. A row a crash leaves between the
   * two transactions is not resolved here. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface
  resolvePending(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  /** Every failure — an error at any step, a decline or a timeout — returns `{ captured: false }`;
   * a timeout or an error first cancels the reader action, best-effort, so the terminal is not left
   * mid-action. */
  private async drive(
    readerId: string,
    amount: Decimal,
    idempotencyKey: string,
  ): Promise<{ captured: true; settledAt: Date; piId: string } | { captured: false }> {
    try {
      const intent = await this.opts.client.createPaymentIntent({
        amount,
        currency: CURRENCY,
        idempotencyKey,
      });
      const piId = intent.id;
      await this.opts.client.processPaymentIntent(readerId, piId);

      for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
        const o = await this.opts.client.readerOutcome(readerId);
        if (o.status === "succeeded") return { captured: true, settledAt: new Date(), piId };
        if (o.status === "failed") return { captured: false };
        await this.poll.sleep(this.poll.intervalMs);
      }
      await this.opts.client.cancelReaderAction(readerId).catch(() => {});
      return { captured: false };
    } catch {
      await this.opts.client.cancelReaderAction(readerId).catch(() => {});
      return { captured: false };
    }
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
