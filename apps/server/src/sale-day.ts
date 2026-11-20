import {
  issueClockIn,
  readIssueZone,
  type FiscalBackend,
  type IssueScope,
  type TrustedClock,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import type { GrossLines } from "@waitron/menu";
import { payments } from "@waitron/payments";
import { civilDateOf } from "@waitron/reporting";
import { closeOfDayEnd } from "./close-of-day.js";
import { issueMoment, type IssueAdvances, type IssueMoment } from "./issue-moment.js";

/** The card row's columns {@link cardSaleMoment} reads. */
export interface CardTiming {
  providerCheckoutStartedAt: string | null;
  resolutionOutcome: string | null;
  createdAt: string;
  settledAt: string | null;
}

/** The selection that reads a card row's {@link CardTiming}. */
export const CARD_TIMING_COLUMNS = {
  providerCheckoutStartedAt: payments.providerCheckoutStartedAt,
  resolutionOutcome: payments.resolutionOutcome,
  createdAt: payments.createdAt,
  settledAt: payments.settledAt,
};

/**
 * The moment a card payment dates its sale by, or null for one that never settled: a live answer's
 * `settled_at`; for a card a check found after its live answer was missed, which settles the row
 * when the check asked, SumUp's start of the checkout as its check stored it, or, for a row
 * recording a resolution, when the row was written.
 */
export function cardSaleMoment(card: CardTiming): string | null {
  if (card.providerCheckoutStartedAt !== null) return card.providerCheckoutStartedAt;
  if (card.settledAt === null) return null;
  return card.resolutionOutcome === null ? card.settledAt : card.createdAt;
}

/**
 * Prepare the issue clock and {@link issueMoment} order `orderId`'s invoice: every till path that
 * files an order's invoice issues it here. `mealEndedAt` is when the meal ended, for an invoice
 * issued after that. A bill the close of day counts as due, issued after its business day ended,
 * is dated no later than that day's end ({@link closeOfDayEnd}).
 */
export async function issueOrderMoment(
  tx: Transaction,
  scope: IssueScope,
  issuer: { clock: TrustedClock; backend: Pick<FiscalBackend, "assertRecordableAt"> },
  orderId: string,
  gross: GrossLines,
  advances: IssueAdvances,
  mealEndedAt?: string,
): Promise<IssueMoment> {
  const zone = await readIssueZone(tx, scope);
  const issueClock = issueClockIn(zone, issuer.clock);
  const ended = earlier(
    mealEndedAt,
    await closeOfDayEnd(tx, scope, orderId, issueClock.now().instant),
  );
  // The zone's offset at the instant itself: across a change of clocks the issue's offset would
  // name the wrong day.
  const mealDay = ended === undefined ? undefined : civilDateOf(new Date(ended), zone);
  return issueMoment(issueClock, gross, issuer.backend, advances, mealDay);
}

function earlier(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b) < Date.parse(a) ? b : a;
}
