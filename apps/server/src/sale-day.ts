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
