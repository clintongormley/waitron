import { recordIncidentOnce } from "@waitron/core";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { DEFAULT_SETTLEMENT_LAG_MS, reconcilePayments } from "@waitron/payments";
import type { PaymentReconcileResult, PaymentReconciler, ReconcilePeriod } from "@waitron/payments";
import type { StripeReportClient } from "./report-client.js";
import { stripeSettlementReport } from "./report-source.js";
import { reverseViaStripe } from "./reverse.js";
import type { StripeRefunder } from "./reverse.js";

const PROVIDER = "stripe";

/** The prefix Stripe gives a Checkout Session id (`cs_test_…` / `cs_live_…`), and the only thing
 * that distinguishes a HOSTED payment's stored `external_ref` from a terminal or on-device one (a
 * PaymentIntent, `pi_…`). Sniffing the reference rather than reading the row's capture mode is
 * deliberate: all three adapters write `provider = "stripe"` and the `payments` table records no
 * capture mode at all, so the reference itself is the only signal the sweep has. */
const SESSION_PREFIX = "cs_";

/**
 * One tenant's Stripe account, as the sweep uses it: the read surface it audits against, and the
 * refund surface it hands money back through.
 *
 * The two are resolved TOGETHER, from a single call, rather than by two independent option
 * functions — because they are not independent. A standalone Stripe account (one per merchant, no
 * Connect) holds exactly one tenant's money and issues exactly one secret key, so `report` and
 * `refund` are two views of the SAME credentials. Two independent resolvers would not make a
 * mispairing IMPOSSIBLE — an implementation could still hand back `{ report: forTenantA, refund:
 * forTenantB }` from two separately-called functions — but it would make that mispairing a second
 * invariant for every future caller to uphold by hand, at however many places `resolveAccount` gets
 * invoked from. Resolving both from one call makes the pairing a single decision, made once, at one
 * call site, instead of an open-ended number of places that must all agree independently; a caller
 * would have to go out of its way to mismatch two credentials it fetched together in one place.
 *
 * They stay two NAMED surfaces rather than one widened interface for the reason `report-client.ts`
 * already states: each seam names only the calls its own consumer makes. `StripeReportClient` is
 * the audit's read surface and `StripeRefunder` is the reversal path's write surface (shared
 * verbatim with both other Stripe providers); folding `refund` into the report client would give
 * every future report-only implementer a money-moving method to implement.
 */
export interface StripeReconcileAccount {
  report: StripeReportClient;
  refund: StripeRefunder;
}

export interface StripeReconcilerOptions {
  db: Database;
  /** The tenant's own Stripe account surfaces. A FUNCTION, not fixed clients: a reconciler is built
   * once and swept across many tenants, while the accounts are standalone (one per merchant, no
   * Connect), so the resolved account IS the tenant scoping the report source's contract demands.
   * Mirrors `StripeTerminalProviderOptions.resolveReader`; provisioning stays deferred. */
  resolveAccount: (tenantId: TenantId) => Promise<StripeReconcileAccount>;
  /** How long the processor may legitimately take to report a settlement. Defaults to the neutral
   * layer's own seven days. */
  settlementLagMs?: number;
  /** This node's origin id, forwarded into `reconcilePayments`'s deps for sync origin attribution. */
  nodeId: string;
}

/**
 * The Stripe implementation of the reconciliation audit — ONE reconciler for the whole settlement
 * identity, per `PaymentReconciler`'s own rule: whatever writes `provider = "stripe"` is audited by
 * this single sweep, however many capture mechanisms do the writing. Today that is three (server-driven
 * terminal, on-device, and hosted Checkout); a fourth landing tomorrow needs no new reconciler and no
 * change here — this class does not enumerate them, on purpose, so it cannot go stale the way an
 * exhaustive list would the moment one is added. That is exactly why the audit hangs off its own
 * interface instead of `PaymentProvider`, whose hosted implementer does not exist.
 *
 * The method is a delegation: the neutral `reconcilePayments` owns the algorithm, and this wires its
 * three vendor ports — the report source, a reversal that can address a hosted payment, and the
 * incident sink.
 */
export class StripeReconciler implements PaymentReconciler {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeReconcilerOptions) {}

  async reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult> {
    const account = await this.opts.resolveAccount(tenantId);
    const settlementLagMs = this.opts.settlementLagMs ?? DEFAULT_SETTLEMENT_LAG_MS;
    return reconcilePayments(
      {
        db: this.opts.db,
        provider: PROVIDER,
        report: stripeSettlementReport(account.report, settlementLagMs),
        reverse: (paymentRef) => this.reverse(account, tenantId, paymentRef),
        incidents: recordIncidentOnce,
        settlementLagMs,
        nodeId: this.opts.nodeId,
      },
      tenantId,
      period,
      now,
    );
  }

  /**
   * Reverse one claimed orphan in full — the neutral sweep's `ReversalFn`, delegating to the same
   * `reverseViaStripe` both interactive providers use, so the local pre-check, the failure
   * bookkeeping and the state transitions are shared code rather than a second implementation.
   *
   * This caller adds two things to the shared helper, and a hosted orphan needs BOTH to be refunded
   * at all.
   *
   * The first is the processor-ref resolver — a Checkout Session id is not something
   * `stripe.refunds` can address.
   *
   * The second is the tenant, threaded from `reconcile`'s argument to the reversal's explicit
   * tenant check. The callback itself receives only a payment reference.
   *
   * Throwing out of the resolver remains the correct failure mode: `reconcilePayments` catches it,
   * records the `AppError` code on `remediationFailures` and folds it into ONE aggregated
   * `payment.reconcile_remediation_failed` incident per till. An under-remediated orphan carrying an
   * open incident is the safe failure, a double refund is not.
   */
  private async reverse(
    account: StripeReconcileAccount,
    tenantId: TenantId,
    paymentRef: string,
  ): Promise<void> {
    await reverseViaStripe(
      this.opts.db,
      account.refund,
      PROVIDER,
      paymentRef,
      "refund",
      undefined,
      {
        tenantId,
        // The sweep's own node id, so the refund's enrolled `payment_refunds`/`payments` writes capture
        // a real origin instead of the all-zero sentinel (design §4d(B); sync origin attribution). The
        // marker UPDATE in `reconcilePayments` already threads this via its own withTenant.
        nodeId: this.opts.nodeId,
        resolveProcessorRef: (externalRef) =>
          this.processorRef(account.report, externalRef, paymentRef),
      },
    );
  }

  /**
   * The stored `external_ref` translated into the identifier `stripe.refunds` addresses.
   *
   * A terminal or on-device payment already stores that identifier, so it passes through untouched
   * and costs no network call. A hosted one stores its Checkout Session id, which the refund API
   * cannot use — the gap that made every hosted orphan's auto-reversal fail permanently — so it is
   * looked up. `reverseViaStripe` calls this outside every transaction, after the reversibility
   * pre-check, precisely because that lookup is a network call.
   *
   * A session with no PaymentIntent behind it was never paid: there is no money to hand back, so
   * `payment.not_found` (the same code the reversal path already raises for a payment it cannot
   * address) is the honest answer rather than a silent success that would report a refund that
   * never happened.
   */
  private async processorRef(
    report: StripeReportClient,
    externalRef: string,
    paymentRef: string,
  ): Promise<string> {
    if (!externalRef.startsWith(SESSION_PREFIX)) return externalRef;
    const paymentIntentId = await report.paymentIntentForSession(externalRef);
    if (paymentIntentId === null) {
      throw new AppError("payment.not_found", { provider: PROVIDER, paymentRef });
    }
    return paymentIntentId;
  }
}
