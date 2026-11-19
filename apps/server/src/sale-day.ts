import {
  prepareIssueClock,
  readIssueZone,
  type FiscalBackend,
  type IssueScope,
  type TrustedClock,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import type { GrossLines } from "@waitron/menu";
import { civilDateOf } from "@waitron/reporting";
import { issueMoment, type IssueMoment } from "./issue-moment.js";

/** The venue's calendar day at `instant`, in its zone at that instant: across a change of clocks
 * the issue's offset would name the wrong day. */
export async function venueDayOf(
  tx: Transaction,
  scope: IssueScope,
  instant: string,
): Promise<string> {
  return civilDateOf(new Date(instant), await readIssueZone(tx, scope));
}

/** The card row's columns {@link cardSaleMoment} reads. */
export interface CardTiming {
  providerCheckoutStartedAt: string | null;
  resolutionOutcome: string | null;
  createdAt: string;
  settledAt: string | null;
}

/**
 * The moment a card payment dates its sale by, or null for one that never settled: a live answer's
 * `settled_at`; for a card a check found after its live answer was missed, which settles the row
 * when the check asked, the provider's start of the checkout (or, when SumUp names none, when the
 * row was written), or, for a row recording a resolution, when the row was written.
 */
export function cardSaleMoment(card: CardTiming): string | null {
  if (card.providerCheckoutStartedAt !== null) return card.providerCheckoutStartedAt;
  if (card.settledAt === null) return null;
  return card.resolutionOutcome === null ? card.settledAt : card.createdAt;
}

/**
 * Prepare the issue clock and {@link issueMoment} an order's invoice: every till path that files an
 * order's invoice issues it here. `mealEndedAt` is when the meal ended, for an invoice issued after
 * that; without it the invoice carries its issue date alone.
 */
export async function issueOrderMoment(
  tx: Transaction,
  scope: IssueScope,
  issuer: { clock: TrustedClock; backend: Pick<FiscalBackend, "assertRecordableAt"> },
  gross: GrossLines,
  mealEndedAt?: string,
): Promise<IssueMoment> {
  const issueClock = await prepareIssueClock(tx, scope, issuer.clock);
  const mealDay = mealEndedAt === undefined ? undefined : await venueDayOf(tx, scope, mealEndedAt);
  return issueMoment(issueClock, gross, issuer.backend, mealDay);
}
