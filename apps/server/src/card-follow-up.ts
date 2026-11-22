import type { SingletonRole } from "@waitron/db";
import type { CollectionOwners, PaymentProvider } from "@waitron/payments";
import { codeOf } from "@waitron/server-kit";
import type { BillPaymentsPass } from "./bill-payments-loop.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";

export interface CardFollowUpSteps {
  sweepProviders(): Promise<readonly PaymentProvider[]>;
  owners(): CollectionOwners;
  settle(signal: AbortSignal): Promise<BillPaymentsPass>;
  recoverRefunds(signal: AbortSignal): Promise<{ pending: number; nextDueAt: Date | null }>;
  startRefundResolvers(): void;
  stopRefundResolvers(): Promise<string[]>;
}

const FLOOR_MS = 5_000;
const CEILING_MS = 60_000;

export function cardFollowUpJob(
  steps: CardFollowUpSteps,
  deps: {
    getRole: () => SingletonRole;
    recoversRefunds: boolean;
    admissionReady: () => boolean;
    log: Logger;
  },
): JobDefinition {
  const { getRole, log } = deps;
  let refundSignal: AbortSignal | undefined;
  let refundResolversStarted = false;
  let stopping: Promise<string[]> | undefined;
  const stopRefunds = () => {
    stopping ??= steps.stopRefundResolvers();
  };
  const watchRefundStop = (signal: AbortSignal) => {
    if (refundSignal !== undefined) return;
    refundSignal = signal;
    signal.addEventListener("abort", stopRefunds, { once: true });
  };
  return {
    name: "card.follow_up",
    applies: deps.admissionReady,
    wakeOn: ["payments", "payment_refunds", "refunds"],
    minSleepMs: FLOOR_MS,
    maxSleepMs: CEILING_MS,
    backoff: { firstMs: FLOOR_MS, maxMs: CEILING_MS },
    async pass({ now, signal }) {
      // A request can have an active refund send while the first provider sweep is still running.
      if (!signal.aborted && deps.recoversRefunds && getRole() === "primary")
        watchRefundStop(signal);
      const failures: unknown[] = [];
      let nextDueAt: Date | null = null;
      const due = (at: Date | null | undefined) => {
        if (at != null && (nextDueAt === null || at < nextDueAt)) nextDueAt = at;
      };

      let owned: CollectionOwners | undefined;
      let providers: readonly PaymentProvider[] = [];
      if (!signal.aborted) {
        try {
          owned = steps.owners();
          providers = await steps.sweepProviders();
        } catch (error) {
          failures.push(error);
          log("warn", "resolve_pending.failed", { error: String(error) });
        }
      }
      if (owned !== undefined) {
        for (const provider of providers) {
          if (signal.aborted) break;
          try {
            const r = await provider.resolvePending(now, owned, signal);
            due(r.nextDueAt);
            const hasWork =
              r.nextDueAt !== null || r.forwarded > 0 || r.declined > 0 || r.incidentsRaised > 0;
            log(hasWork ? "info" : "debug", "resolve_pending.complete", {
              provider: provider.provider,
              captured: r.forwarded,
              failed: r.declined,
              incidentsRaised: r.incidentsRaised,
              nextDueAt: r.nextDueAt?.toISOString() ?? null,
            });
          } catch (error) {
            failures.push(error);
            log("warn", "resolve_pending.failed", {
              provider: provider.provider,
              error: String(error),
            });
          }
        }
      }

      if (!signal.aborted && getRole() === "primary") {
        try {
          const { errors, pending, ...counts } = await steps.settle(signal);
          if (counts.received + counts.failed > 0) log("info", "bill_payment.settled", counts);
          for (const failure of errors) log("warn", "bill_payment.settle_failed", failure);
          if (pending > 0) due(new Date(now.getTime() + CEILING_MS));
        } catch (error) {
          failures.push(error);
          log("warn", "bill_payment.settle_failed", { error: String(error) });
        }
      }

      // Receipt enrichment can wait for the provider, so settle the bill before looking up details.
      if (owned !== undefined) {
        for (const provider of providers) {
          if (signal.aborted) break;
          try {
            due(
              await provider.fillMissingCardDetails?.(
                owned,
                ({ outcome, ...fields }) =>
                  log("info", `payment.card_details_${outcome}`, {
                    provider: provider.provider,
                    ...fields,
                  }),
                signal,
              ),
            );
          } catch (error) {
            log("warn", "payment.card_details_failed", {
              provider: provider.provider,
              errorCode: codeOf(error),
            });
          }
        }
      }

      if (!signal.aborted && deps.recoversRefunds && getRole() === "primary") {
        try {
          watchRefundStop(signal);
          if (!refundResolversStarted) {
            steps.startRefundResolvers();
            refundResolversStarted = true;
          }
          due((await steps.recoverRefunds(signal)).nextDueAt);
        } catch (error) {
          failures.push(error);
          log("error", "tender_refund.recovery_failed", { errorCode: codeOf(error) });
        }
      }

      if (failures.length > 0) throw new AggregateError(failures, "Card follow-up failed");
      return { nextDueAt };
    },
    async onStop() {
      if (refundSignal === undefined) return;
      refundSignal.removeEventListener("abort", stopRefunds);
      stopRefunds();
      const refundIds = await stopping!;
      if (refundIds.length > 0) log("warn", "tender_refund.shutdown_pending", { refundIds });
    },
  };
}
