import { randomUUID } from "node:crypto";
import { AppError, tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CardDetails,
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
 * with none returns `undefined` — SumUp omits card facts on some successful sales, and a missing
 * sub-field yields a partial/absent block, NEVER a failed capture: the money has moved. `scheme` is
 * the network as SumUp names it, underscores turned to spaces; `authCode` is null when absent. */
export function cardFromTransaction(t: SumUpTransaction): CardDetails | undefined {
  if (t.card === undefined) return undefined;
  return {
    scheme: t.card.type.replaceAll("_", " "),
    last4: t.card.last4,
    entryMode: mapEntryMode(t.entryMode),
    authCode: t.authCode ?? null,
  };
}

/** One SumUp status mapped onto a T2 decision, as DATA. `pending` = keep polling; `deferred` = a
 * status this adapter is not entitled to act on (`REFUNDED`, unknown) — the loop stops, the row
 * stays `attempting`, and `resolvePending` decides (spec §2/§3). `card` rides the `captured`
 * variant so both capture paths persist it without re-fetching the transaction. */
type PollOutcome =
  | { kind: "captured"; transactionId: string; settledAt: Date; card?: CardDetails }
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
    const card = outcome.kind === "captured" ? outcome.card : undefined;
    const row = await this.inTenant((tx) =>
      outcome.kind === "captured"
        ? captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
            card,
          })
        : failAttempting(tx, key),
    );
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: row.state,
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
      card,
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
    if (t.status === "SUCCESSFUL")
      return {
        kind: "captured",
        transactionId: t.id,
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
  /**
   * One pass over this tenant's `attempting` rows (spec §3). T1 lists them (unlocked); each is
   * looked up at SumUp OUTSIDE any transaction — by the stamped poll key, else by OUR
   * `payment_ref` (`foreign_transaction_id`) for a row that crashed before T1.5 — and resolved in
   * its own short T2. The non-null case runs through `classify` (the one status→outcome mapping,
   * shared with `collect`'s poll), so a future SumUp status is taught in one place:
   *   captured → captured;  failed → failed, no incident;
   *   pending → left, `nextDueAt` set;  deferred (REFUNDED / unknown) → failed +
   *   `payment.pending_outcome_unactionable` (money may have moved through a payment that never
   *   carried a sale — a human must look).
   * A null (SumUp holds no transaction) inside the grace period is left; PAST the grace period it is
   * failed AND raises the same unactionable incident with `status: "not_found"`. The old code failed
   * it silently on "SumUp holds nothing → no money moved"; that confidence only held when a
   * correlation key SumUp had recorded was in play. With no affiliate key, the sweep queries by a
   * `foreign_transaction_id` SumUp never received, so a create SumUp accepted but whose response was
   * lost is a not-found we cannot correlate — an uncertain charge, not a proven non-event. A fiscal
   * system errs toward a rare benign alert over a silently concealed charge; the full self-heal (the
   * deferred reconciler) lands later.
   * This is the one place a terminal state is written on incomplete information, safe only because
   * the outcome has stopped moving by the time the sweep sees it. The sweep MUST terminate every
   * row it can, or a deferred status would be swept forever (spec §3).
   *
   * The incident carries no `saleId` (an attempting row has none), so `recordIncidentOnce` dedups
   * per open `(tenant, till, code, sale_id=null)`: two unactionable rows on the SAME till in one
   * sweep collapse to ONE incident and `incidentsRaised` undercounts. Accepted — spec §3 only needs
   * a human alerted, and one incident per till satisfies that; the count is a log field, not a
   * per-row guarantee. The till of each row is resolved in ONE batched read at the head of the sweep
   * (`tillsForWorkingOrders` warns against the per-row call); each row's write transaction still does
   * `failAttempting` + the incident together, so that atomicity is unchanged — only the till READ is
   * lifted out and batched.
   */
  async resolvePending(now: Date): Promise<ForwardResult> {
    const rows = await this.inTenant((tx) =>
      listAttempting(tx, this.opts.tenantId, SUMUP_PROVIDER),
    );
    if (rows.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }
    const tenantId = this.opts.tenantId;
    const tills = await this.inTenant((tx) =>
      tillsForWorkingOrders(
        tx,
        tenantId,
        rows.map((r) => r.workingOrderId),
      ),
    );

    let forwarded = 0;
    let declined = 0;
    let incidentsRaised = 0;
    let deferred = false;
    /** `failAttempting` + (for an unactionable outcome) the incident, in ONE transaction. The till
     * comes from the pre-fetched map; an absent till (order gone) means no incident but the row
     * still fails. Returns whether an incident was raised. */
    const failWith = (
      key: { tenantId: string; provider: string; paymentRef: string },
      workingOrderId: string,
      status: string | null,
    ): Promise<boolean> =>
      this.inTenant(async (tx) => {
        await failAttempting(tx, key);
        if (status === null) return false;
        const tillId = tills.get(workingOrderId);
        if (tillId === undefined) return false;
        return this.opts.incidents(tx, {
          tenantId: brandTenantId(key.tenantId),
          tillId: brandTillId(tillId),
          error: new AppError("payment.pending_outcome_unactionable", {
            paymentRef: key.paymentRef,
            status,
          }),
          severity: "error",
          detectedAt: now,
        });
      });
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
        // A not-found we cannot correlate to a key SumUp recorded is an uncertain charge — surface it.
        if (await failWith(key, row.workingOrderId, "not_found")) incidentsRaised++;
        declined++;
        continue;
      }
      const outcome = SumUpCloudProvider.classify(t, now);
      if (outcome.kind === "pending") {
        deferred = true;
        continue;
      }
      if (outcome.kind === "captured") {
        await this.inTenant((tx) =>
          captureAttempting(tx, {
            ...key,
            settledAt: outcome.settledAt,
            externalRef: outcome.transactionId,
            card: outcome.card,
          }),
        );
        forwarded++;
        continue;
      }
      // failed → no incident; deferred (REFUNDED / unknown) → incident naming the status.
      const status = outcome.kind === "deferred" ? t.status : null;
      if (await failWith(key, row.workingOrderId, status)) incidentsRaised++;
      declined++;
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
