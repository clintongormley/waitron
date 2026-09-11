import type { Decimal } from "@waitron/shared";
import type {
  CreateCheckoutOutcome,
  SumUpClient,
  SumUpTransaction,
  TransactionQuery,
} from "../client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

/** The card facts a transaction carries, mirroring `SumUpTransaction`'s optional card fields. */
interface CardFacts {
  card?: { last4: string; type: string };
  entryMode?: string;
  authCode?: string | null;
}

/** A VISA contactless block matching the live control run (docs/research SumUp Solo experiments);
 * every created/held transaction carries it unless a test overrides with `cardNext`. */
const DEFAULT_CARD: CardFacts = {
  card: { last4: "5838", type: "VISA" },
  entryMode: "contactless",
  authCode: "328600",
};

interface Held extends CardFacts {
  id: string;
  clientTransactionId: string;
  foreignTransactionId: string;
  status: SumUpTransaction["status"];
  amount: Decimal;
  /** When set, the FIRST `findTransaction` that locates this checkout rewrites its status to this
   * value, then clears the field — models a checkout that resolves the moment the adapter first
   * polls it (`resolveOnFirstFind`). */
  onFirstFind?: SumUpTransaction["status"];
}

/** A deterministic in-memory `SumUpClient`. NOT barrel-exported. Test controls shape the NEXT
 * checkout: `declineNext` (the customer's card is refused → `FAILED`), `cancelNext` (→ `CANCELLED`),
 * `stallNext` (stays `PENDING` until `settle`/`decline` is called by name), `refuseNext` (SumUp
 * rejects the create with a 4xx), `throwOnCreateNext` (network error on create),
 * `throwOnFindNext` (network error mid-poll), `invisibleUntilSettled` (the transaction is not
 * findable — 404 — until it resolves; models a reader that has not started the checkout),
 * `refundRefusesNext`; `resolveOnFirstFind(status)` gives the next checkout `status` the first time
 * it is polled (a resolution that lands mid-collect); `setStatus(clientTransactionId, status)`
 * writes any status, including `REFUNDED` or an unknown one, for the sweep tests. */
export class FakeSumUp implements SumUpClient {
  lastCreate: Parameters<SumUpClient["createCheckout"]>[0] | undefined;
  lastRefund: { transactionId: string; amount?: Decimal } | undefined;
  private next: "SUCCESSFUL" | "FAILED" | "CANCELLED" | "PENDING" = "SUCCESSFUL";
  private nextCreateRefused = false;
  private nextCreateThrows = false;
  private nextFindThrows = false;
  private nextRefundRefuses = false;
  private hideUntilSettled = false;
  private nextResolveOnFirstFind: SumUpTransaction["status"] | undefined;
  private nextCard: CardFacts | undefined;
  private readonly held: Held[] = [];

  declineNext(): void {
    this.next = "FAILED";
  }
  cancelNext(): void {
    this.next = "CANCELLED";
  }
  stallNext(): void {
    this.next = "PENDING";
  }
  refuseNext(): void {
    this.nextCreateRefused = true;
  }
  throwOnCreateNext(): void {
    this.nextCreateThrows = true;
  }
  throwOnFindNext(): void {
    this.nextFindThrows = true;
  }
  invisibleUntilSettled(): void {
    this.hideUntilSettled = true;
  }
  refundRefusesNext(): void {
    this.nextRefundRefuses = true;
  }
  /** The next checkout created is given `status` the first time it is looked up — the sweep tests'
   * "resolved mid-collect" control (e.g. a `REFUNDED` the adapter must not treat as a T2 basis). */
  resolveOnFirstFind(status: SumUpTransaction["status"]): void {
    this.nextResolveOnFirstFind = status;
  }
  /** Give the next created checkout these card facts, or `null` for a transaction that carries NO
   * card object (a SUCCESSFUL sale SumUp returned without card fields). One-shot; the default
   * otherwise is the VISA contactless block. */
  cardNext(facts: CardFacts | null): void {
    this.nextCard = facts === null ? {} : facts;
  }

  /** Resolve a stalled checkout by its client transaction id. */
  settle(clientTransactionId: string): void {
    this.setStatus(clientTransactionId, "SUCCESSFUL");
  }
  decline(clientTransactionId: string): void {
    this.setStatus(clientTransactionId, "FAILED");
  }
  setStatus(clientTransactionId: string, status: SumUpTransaction["status"]): void {
    const h = this.held.find((x) => x.clientTransactionId === clientTransactionId);
    if (h === undefined) throw new Error(`FakeSumUp: no checkout ${clientTransactionId}`);
    h.status = status;
  }
  /** Register a transaction the adapter never created through this fake (a crash-before-stamp row
   * the sweep must find by OUR key) — `foreignTransactionId` is the adapter's payment_ref. */
  hold(
    t: {
      foreignTransactionId: string;
      status: SumUpTransaction["status"];
      amount: Decimal;
    } & CardFacts,
  ): string {
    const clientTransactionId = nextId("ctx");
    this.held.push({ id: nextId("txn"), clientTransactionId, ...DEFAULT_CARD, ...t });
    return clientTransactionId;
  }

  createCheckout(
    params: Parameters<SumUpClient["createCheckout"]>[0],
  ): Promise<CreateCheckoutOutcome> {
    this.lastCreate = params;
    if (this.nextCreateThrows) {
      this.nextCreateThrows = false;
      return Promise.reject(new Error("sumup unreachable"));
    }
    if (this.nextCreateRefused) {
      this.nextCreateRefused = false;
      return Promise.resolve({ accepted: false, reason: "Unprocessable Entity" });
    }
    const clientTransactionId = nextId("ctx");
    this.held.push({
      id: nextId("txn"),
      clientTransactionId,
      foreignTransactionId: params.foreignTransactionId,
      status: this.next,
      amount: params.amount,
      ...(this.nextCard ?? DEFAULT_CARD),
      ...(this.nextResolveOnFirstFind === undefined
        ? {}
        : { onFirstFind: this.nextResolveOnFirstFind }),
    });
    this.next = "SUCCESSFUL";
    this.nextResolveOnFirstFind = undefined;
    this.nextCard = undefined;
    return Promise.resolve({ accepted: true, checkoutId: nextId("chk"), clientTransactionId });
  }

  findTransaction(query: TransactionQuery): Promise<SumUpTransaction | null> {
    if (this.nextFindThrows) {
      this.nextFindThrows = false;
      return Promise.reject(new Error("sumup unreachable"));
    }
    const h = this.held.find((x) =>
      "clientTransactionId" in query
        ? x.clientTransactionId === query.clientTransactionId
        : "foreignTransactionId" in query
          ? x.foreignTransactionId === query.foreignTransactionId
          : x.id === query.id,
    );
    if (h === undefined) return Promise.resolve(null);
    if (h.onFirstFind !== undefined) {
      h.status = h.onFirstFind;
      h.onFirstFind = undefined;
    }
    if (this.hideUntilSettled && h.status === "PENDING") return Promise.resolve(null);
    return Promise.resolve({
      id: h.id,
      status: h.status,
      amount: h.amount,
      ...(h.card === undefined ? {} : { card: h.card }),
      ...(h.entryMode === undefined ? {} : { entryMode: h.entryMode }),
      ...(h.authCode === undefined ? {} : { authCode: h.authCode }),
    });
  }

  refund(params: {
    transactionId: string;
    amount?: Decimal;
  }): Promise<{ status: "accepted" | "refused" }> {
    this.lastRefund = params;
    if (this.nextRefundRefuses) {
      this.nextRefundRefuses = false;
      return Promise.resolve({ status: "refused" });
    }
    const h = this.held.find((x) => x.id === params.transactionId);
    if (h !== undefined && params.amount === undefined) h.status = "REFUNDED";
    return Promise.resolve({ status: "accepted" });
  }
}
