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

/** The card row's columns {@link cardTakenAt} reads. */
export interface CardTiming {
  providerTakenAt: string | null;
  resolutionOutcome: string | null;
  createdAt: string;
  settledAt: string | null;
}

/**
 * When a card was taken, or null for one that never settled. A live answer's `settled_at` is that
 * moment, but a check made after the answer was missed settles the row when it asked: SumUp's check
 * stores SumUp's own time, and a card Stripe's check resolved falls back to when the row was written,
 * just before the reader was asked, as Stripe's lookup names no time.
 */
export function cardTakenAt(card: CardTiming): string | null {
  if (card.providerTakenAt !== null) return card.providerTakenAt;
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
