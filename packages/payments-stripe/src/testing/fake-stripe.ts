import type { Decimal } from "@waitron/shared";
import type { StripeClient, StripeRefund, StripeRefundCreate } from "../client.js";
import { toMinorUnits } from "../client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

type Outcome = "succeeded" | "failed" | "in_progress";

interface FakeIntent {
  status: string;
  amount: number;
  amountReceived: number;
}

/** Stripe's own list of the statuses a PaymentIntent can be cancelled from. */
const CANCELLABLE = new Set([
  "requires_payment_method",
  "requires_capture",
  "requires_confirmation",
  "requires_action",
  "processing",
]);

type CreateRefundParams = Parameters<StripeClient["createRefund"]>[0];

/** What the next `createRefund` does: refuse with an HTTP status (or none) and make nothing, or
 * make a refund in `status` and answer it, or answer `answer` although it was made. `attempts` is
 * how many HTTP requests the refusal reports; unscripted, one. */
type RefusalScript = { httpStatus: number | null; attempts?: number };
export type CreateRefundScript = RefusalScript | { status: string; answer?: RefusalScript };

/** A stalled action stays `in_progress` until `cancelReaderAction` flips it to `failed`. */
export class FakeStripe implements StripeClient {
  lastRefund: { paymentIntentId: string; amount?: Decimal; idempotencyKey: string } | undefined;
  lastCreateIntent: { amount: Decimal; currency: string; idempotencyKey: string } | undefined;
  processedReaders: string[] = [];
  private outcome: Outcome = "succeeded";
  private nextRefundFails = false;
  private nextPollThrows = false;
  private readerAction = new Map<string, Outcome>();
  private readonly intents = new Map<string, FakeIntent>();
  private unreachable = 0;
  private cancelRaces = false;
  /** Every intent `cancelPaymentIntent` cancelled, in order. */
  readonly cancelledIntents: string[] = [];
  /** Every `createRefund` call, in order. */
  readonly createRefundCalls: CreateRefundParams[] = [];
  private readonly madeRefunds: (StripeRefund & { paymentIntentId: string; key: string })[] = [];
  private readonly refundScripts: CreateRefundScript[] = [];
  private listUnreachable = 0;

  /** Queued, one per `createRefund`; unscripted, a call makes a succeeded refund, and a key already
   * used answers the refund it made, as Stripe replays a key's first result. */
  scriptNextCreateRefund(script: CreateRefundScript): void {
    this.refundScripts.push(script);
  }
  setRefundStatus(refundId: string, status: string): void {
    const refund = this.madeRefunds.find((r) => r.id === refundId);
    if (refund === undefined) throw new Error(`FakeStripe: no refund ${refundId}`);
    refund.status = status;
  }
  /** The next `listRefunds` rejects as a network failure would. */
  listRefundsUnreachableNext(): void {
    this.listUnreachable += 1;
  }

  declineNext(): void {
    this.outcome = "failed";
  }
  stallNext(): void {
    this.outcome = "in_progress";
  }
  /** Creates or replaces an intent as Stripe would report it; amounts in minor units. */
  setIntent(id: string, intent: { status: string; amount: number; amountReceived?: number }): void {
    this.intents.set(id, { amountReceived: 0, ...intent });
  }
  /** The next `retrievePaymentIntent` rejects as a network failure would. */
  unreachableNext(): void {
    this.unreachable += 1;
  }
  /** The next `cancelPaymentIntent` loses a race to the card: the intent succeeds first, so the
   * cancel is refused. */
  cancelRacesNext(): void {
    this.cancelRaces = true;
  }
  refundFailsNext(): void {
    this.nextRefundFails = true;
  }
  throwOnPollNext(): void {
    this.nextPollThrows = true;
  }

  createPaymentIntent(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    this.lastCreateIntent = params;
    const id = nextId("pi");
    this.setIntent(id, { status: "requires_payment_method", amount: toMinorUnits(params.amount) });
    return Promise.resolve({ id });
  }
  processPaymentIntent(readerId: string, paymentIntentId: string): Promise<void> {
    const intent = this.intents.get(paymentIntentId);
    if (intent?.status === "canceled") {
      return Promise.reject(
        new Error("This PaymentIntent cannot be processed because it has a status of canceled."),
      );
    }
    this.processedReaders.push(readerId);
    this.readerAction.set(readerId, this.outcome);
    if (intent !== undefined && this.outcome === "succeeded") {
      intent.status = "succeeded";
      intent.amountReceived = intent.amount;
    }
    this.outcome = "succeeded";
    return Promise.resolve();
  }
  readerOutcome(readerId: string): Promise<{ status: Outcome; failureCode?: string }> {
    if (this.nextPollThrows) {
      this.nextPollThrows = false;
      return Promise.reject(new Error("reader unreachable"));
    }
    const status = this.readerAction.get(readerId) ?? "succeeded";
    return Promise.resolve(
      status === "failed" ? { status, failureCode: "card_declined" } : { status },
    );
  }
  cancelReaderAction(readerId: string): Promise<void> {
    this.readerAction.set(readerId, "failed");
    return Promise.resolve();
  }
  retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<{ id: string; status: string; amount: number; amountReceived: number }> {
    if (this.unreachable > 0) {
      this.unreachable -= 1;
      return Promise.reject(new Error("stripe unreachable"));
    }
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined) {
      return Promise.reject(new Error(`No such payment_intent: '${paymentIntentId}'`));
    }
    return Promise.resolve({ id: paymentIntentId, ...intent });
  }
  cancelPaymentIntent(paymentIntentId: string): Promise<{ status: string }> {
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined) {
      return Promise.reject(new Error(`No such payment_intent: '${paymentIntentId}'`));
    }
    if (this.cancelRaces) {
      this.cancelRaces = false;
      intent.status = "succeeded";
      intent.amountReceived = intent.amount;
    }
    if (!CANCELLABLE.has(intent.status)) {
      return Promise.reject(
        new Error(
          `You cannot cancel this PaymentIntent because it has a status of ${intent.status}.`,
        ),
      );
    }
    intent.status = "canceled";
    this.cancelledIntents.push(paymentIntentId);
    return Promise.resolve({ status: "canceled" });
  }
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    this.lastRefund = params;
    const fails = this.nextRefundFails;
    this.nextRefundFails = false;
    return Promise.resolve({ id: nextId("re"), status: fails ? "failed" : "succeeded" });
  }
  createRefund(params: CreateRefundParams): Promise<StripeRefundCreate> {
    this.createRefundCalls.push(params);
    const script = this.refundScripts.shift();
    if (script === undefined) {
      const earlier = this.madeRefunds.find((r) => r.key === params.idempotencyKey);
      return Promise.resolve({
        ok: true,
        refund: this.view(earlier ?? this.make(params, "succeeded")),
      });
    }
    const refusal = (answer: RefusalScript): StripeRefundCreate => ({
      ok: false,
      httpStatus: answer.httpStatus,
      attempts: answer.attempts ?? 1,
    });
    if (!("status" in script)) return Promise.resolve(refusal(script));
    const made = this.make(params, script.status);
    return Promise.resolve(
      script.answer === undefined ? { ok: true, refund: this.view(made) } : refusal(script.answer),
    );
  }
  listRefunds(paymentIntentId: string): Promise<StripeRefund[]> {
    if (this.listUnreachable > 0) {
      this.listUnreachable -= 1;
      return Promise.reject(new Error("stripe unreachable"));
    }
    return Promise.resolve(
      this.madeRefunds
        .filter((r) => r.paymentIntentId === paymentIntentId)
        .map((r) => this.view(r)),
    );
  }
  private make(params: CreateRefundParams, status: string) {
    const made = {
      id: nextId("re"),
      status,
      metadata: { ...params.metadata },
      paymentIntentId: params.paymentIntentId,
      key: params.idempotencyKey,
    };
    this.madeRefunds.push(made);
    return made;
  }
  private view(refund: StripeRefund): StripeRefund {
    return { id: refund.id, status: refund.status, metadata: { ...refund.metadata } };
  }
}
