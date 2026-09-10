import { randomUUID } from "node:crypto";
import { AppError, tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  IncidentSink,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import {
  captureAttempting,
  failAttempting,
  insertAttempting,
  listAttempting,
  stampAttemptingRef,
  tillsForWorkingOrders,
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

export interface SumUpCloudProviderOptions {
  client: SumUpClient;
  /** A plain `Database` handle; every phase is scoped with `withTenant(db, tenantId, …)`. */
  db: Database;
  /** The tenant this provider serves — a per-till object, one tenant, known at construction. */
  tenantId: TenantId;
  nodeId: string;
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  /** Where `resolvePending` raises `payment.pending_outcome_unactionable`. */
  incidents: IncidentSink;
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  now?: () => Date;
}

/** One SumUp status mapped onto a T2 decision, as DATA. `pending` = keep polling; `deferred` = a
 * status this adapter is not entitled to act on (`REFUNDED`, unknown) — the loop stops, the row
 * stays `attempting`, and `resolvePending` decides (spec §2/§3). */
type PollOutcome =
  | { kind: "captured"; transactionId: string; settledAt: Date }
  | { kind: "failed" }
  | { kind: "pending" }
  | { kind: "deferred" };

/**
 * The SumUp Cloud API `PaymentProvider` (server-driven, asynchronous outcome). `collect`:
 *  T1   commit an `attempting` row keyed by a fresh `payment_ref` (before any network);
 *  net  create a reader checkout carrying that `payment_ref` as `foreign_transaction_id`;
 *  T1.5 stamp SumUp's `client_transaction_id` into `external_ref` (the POLL key — on a captured row
 *       `external_ref` becomes SumUp's transaction id, the REFUNDABLE key; see `captureAttempting`);
 *  poll the transaction until `status` leaves `PENDING`;
 *  T2   `captured` on `SUCCESSFUL`, `failed` on `FAILED`/`CANCELLED` or a definite create refusal.
 * Anything else — a timeout, a network error, `REFUNDED`, an unknown status — is NOT resolved here:
 * the row stays `attempting` and the result carries `state: "attempting"`, `settledAt: null`, so
 * `recordSale` refuses and staff retry or take cash. `Terminate Checkout` is never called: it races
 * the customer's tap (spec §2). `resolvePending` (the sweep) is what terminates those rows.
 */
export class SumUpCloudProvider implements PaymentProvider {
  readonly provider = SUMUP_PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private readonly poll: Required<NonNullable<SumUpCloudProviderOptions["poll"]>>;
  private readonly now: () => Date;

  constructor(private readonly opts: SumUpCloudProviderOptions) {
    this.poll = { ...DEFAULT_POLL, ...opts.poll };
    this.now = opts.now ?? (() => new Date());
  }

  /** Case-insensitive, as `StripeTerminalProvider.requireOwnTenant` explains (Postgres renders a
   * uuid lowercase; `tenantId()` preserves the caller's case). Before any network call. */
  private requireOwnTenant(supplied: TenantId): void {
    if (supplied.toLowerCase() !== this.opts.tenantId.toLowerCase()) {
      throw new AppError("sumup.tenant_mismatch", { expected: this.opts.tenantId, supplied });
    }
  }

  private inTenant<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(this.opts.db, this.opts.tenantId, fn);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    this.requireOwnTenant(params.tenantId);
    const readerId = await this.opts.resolveReader(params.tenantId, params.tillId);
    const paymentRef = randomUUID();
    const key = { tenantId: params.tenantId, provider: SUMUP_PROVIDER, paymentRef };

    // T1
    await this.inTenant((tx) =>
      insertAttempting(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: SUMUP_PROVIDER,
        paymentRef,
        amount: params.amount,
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
      const row = await this.inTenant((tx) => failAttempting(tx, key));
      return {
        provider: SUMUP_PROVIDER,
        paymentRef,
        state: row.state,
        amount: params.amount,
        settledAt: null,
      };
    }

    // T1.5
    await this.inTenant((tx) => stampAttemptingRef(tx, key, created.clientTransactionId));

    // Poll — outside any transaction.
    const outcome = await this.pollUntilResolved({
      clientTransactionId: created.clientTransactionId,
    });

    // T2 — only a captured or failed outcome is a basis for it.
    if (outcome.kind === "pending" || outcome.kind === "deferred") {
      return this.pendingResult(paymentRef, params.amount);
    }
    const row = await this.inTenant((tx) =>
      outcome.kind === "captured"
        ? captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
          })
        : failAttempting(tx, key),
    );
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: row.state,
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  private pendingResult(paymentRef: string, amount: Decimal): PaymentResult {
    return { provider: SUMUP_PROVIDER, paymentRef, state: "attempting", amount, settledAt: null };
  }

  /** Only the three documented terminal statuses resolve a row; `REFUNDED` and anything
   * unrecognised are `deferred` to the sweep (spec §2). A null (SumUp holds no transaction yet —
   * the reader has not started the checkout) is `pending`. */
  static classify(t: SumUpTransaction | null, now: Date): PollOutcome {
    if (t === null || t.status === "PENDING") return { kind: "pending" };
    if (t.status === "SUCCESSFUL") return { kind: "captured", transactionId: t.id, settledAt: now };
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
  /**
   * One pass over this tenant's `attempting` rows (spec §3). T1 lists them (unlocked); each is
   * looked up at SumUp OUTSIDE any transaction — by the stamped poll key, else by OUR
   * `payment_ref` (`foreign_transaction_id`) for a row that crashed before T1.5 — and resolved in
   * its own short T2:
   *   SUCCESSFUL → captured;  FAILED / CANCELLED → failed;
   *   PENDING, or not found inside the grace period, or a network error → left, `nextDueAt` set;
   *   not found past the grace period → failed (SumUp holds nothing: no money moved), no incident;
   *   REFUNDED / unknown → failed + `payment.pending_outcome_unactionable` (money may have moved
   *   through a payment that never carried a sale — a human must look).
   * This is the one place a terminal state is written on incomplete information, safe only because
   * the outcome has stopped moving by the time the sweep sees it. The sweep MUST terminate every
   * row it can, or a deferred status would be swept forever (spec §3).
   *
   * The incident carries no `saleId` (an attempting row has none), so `recordIncidentOnce` dedups
   * per open `(tenant, till, code, sale_id=null)`: two unactionable rows on the SAME till in one
   * sweep collapse to ONE incident and `incidentsRaised` undercounts. Accepted — spec §3 only needs
   * a human alerted, and one incident per till satisfies that; the count is a log field, not a
   * per-row guarantee.
   */
  async resolvePending(now: Date): Promise<ForwardResult> {
    const rows = await this.inTenant((tx) =>
      listAttempting(tx, this.opts.tenantId, SUMUP_PROVIDER),
    );
    if (rows.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    let forwarded = 0;
    let declined = 0;
    let incidentsRaised = 0;
    let deferred = false;
    for (const row of rows) {
      const key = { tenantId: row.tenantId, provider: SUMUP_PROVIDER, paymentRef: row.paymentRef };
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
        await this.inTenant((tx) => failAttempting(tx, key));
        declined++;
        continue;
      }
      if (t.status === "PENDING") {
        deferred = true;
        continue;
      }
      if (t.status === "SUCCESSFUL") {
        await this.inTenant((tx) =>
          captureAttempting(tx, { ...key, settledAt: now, externalRef: t.id }),
        );
        forwarded++;
        continue;
      }
      const unactionable = t.status !== "FAILED" && t.status !== "CANCELLED";
      const raised = await this.inTenant(async (tx) => {
        await failAttempting(tx, key);
        if (!unactionable) return false;
        const tills = await tillsForWorkingOrders(tx, row.tenantId, [row.workingOrderId]);
        const tillId = tills.get(row.workingOrderId);
        if (tillId === undefined) return false;
        return this.opts.incidents(tx, {
          tenantId: brandTenantId(row.tenantId),
          tillId: brandTillId(tillId),
          error: new AppError("payment.pending_outcome_unactionable", {
            paymentRef: row.paymentRef,
            status: t.status,
          }),
          severity: "error",
          detectedAt: now,
        });
      });
      declined++;
      if (raised) incidentsRaised++;
    }
    return {
      nextDueAt: deferred ? new Date(now.getTime() + RESOLVE_RETRY_MS) : null,
      forwarded,
      declined,
      incidentsRaised,
    };
  }

  /** void / refund / partialRefund all share one reversal path (`reverseViaSumUp`); a `void` is a
   * full refund at SumUp (spec §5 — there is no separate void endpoint), a `partialRefund` carries
   * the amount. Every phase is tenant-scoped inside `reverseViaSumUp`. */
  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaSumUp(this.opts.db, this.opts.client, ref, kind, amount, {
      tenantId: this.opts.tenantId,
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
