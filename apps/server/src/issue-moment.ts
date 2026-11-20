import { localCalendarDate, rateLines } from "@waitron/menu";
import type { GrossLines, PricedLines } from "@waitron/menu";
import type { FiscalBackend, TrustedClock, TrustedReading } from "@waitron/fiscal";
import { deductAdvances, type AdvanceCredit, type DeductionLine } from "./advance-deduction.js";

/** An invoice's rated lines, and the clock that issues it. */
export interface IssueMoment {
  /** What the invoice files: the meal less its bill's advances, rate by rate. */
  priced: PricedLines;
  /** The meal's own lines and figures, before any advance is taken off. */
  meal: PricedLines;
  /** One line per advance and rate, to follow `priced.lines` on the invoice. */
  deductionLines: DeductionLine[];
  /** The lines `priced` was rated from, still holding the gross unit prices they were sold at. */
  gross: GrossLines;
  /** Answers the reading `issueMoment` took on every `now()`, so `recordSale` dates the invoice on
   * the issue day `priced` and `operationDate` were worked out from, even across midnight. */
  clock: TrustedClock;
  /** The earlier venue day the sale happened on, when it closed before the issue day. */
  operationDate?: string;
}

/** The bill's advances to take off its invoice, and the sale's invoice languages for their lines. */
export interface IssueAdvances {
  credits: readonly AdvanceCredit[];
  languages: readonly string[];
}

/**
 * Take ONE clock reading and rate `gross` at its local calendar date, or at `mealDay` when the meal
 * ended on an earlier venue day: the rate in force when the sale happened applies, and that day is
 * returned as the operation date to file. Every till path that issues an invoice from an order's
 * lines rates them here and hands `recordSale` the returned clock.
 */
export function issueMoment(
  clock: TrustedClock,
  gross: GrossLines,
  fiscal: Pick<FiscalBackend, "assertRecordableAt">,
  mealDay?: string,
  advances?: IssueAdvances,
): IssueMoment {
  const reading = clock.now();
  fiscal.assertRecordableAt(reading);
  const issueDay = localCalendarDate(reading.instant, reading.offsetMinutes);
  const earlier = mealDay !== undefined && mealDay < issueDay ? mealDay : undefined;
  const meal = rateLines(gross, earlier ?? issueDay);
  const { priced, deductionLines } = deductAdvances(meal, advances?.credits ?? [], {
    languages: advances?.languages ?? [],
  });
  return {
    priced,
    meal,
    deductionLines,
    gross,
    clock: pinnedAt(clock, reading),
    ...(earlier === undefined ? {} : { operationDate: earlier }),
  };
}

export function pinnedAt(clock: TrustedClock, reading: TrustedReading): TrustedClock {
  return {
    now: () => reading,
    anchor: (trusted) => clock.anchor(trusted),
    currentAnchor: () => clock.currentAnchor(),
  };
}
