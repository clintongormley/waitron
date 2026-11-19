import { localCalendarDate, rateLines } from "@waitron/menu";
import type { GrossLines, PricedLines } from "@waitron/menu";
import type { FiscalBackend, TrustedClock, TrustedReading } from "@waitron/fiscal";

/** An invoice's rated lines, and the clock that issues it. */
export interface IssueMoment {
  priced: PricedLines;
  /** The lines `priced` was rated from, still holding the gross unit prices they were sold at. */
  gross: GrossLines;
  /** Answers the reading `issueMoment` took on every `now()`, so `recordSale` dates the invoice on
   * the issue day `priced` and `operationDate` were worked out from, even across midnight. */
  clock: TrustedClock;
  /** The earlier venue day the sale happened on, when it closed before the issue day. */
  operationDate?: string;
}

/**
 * Take ONE clock reading and rate `gross` at its local calendar date, or at `closeDay` when the sale
 * closed on an earlier venue day: the rate in force when the sale happened applies, and that day is
 * returned as the operation date to file. Every till path that issues an invoice from an order's
 * lines rates them here and hands `recordSale` the returned clock.
 */
export function issueMoment(
  clock: TrustedClock,
  gross: GrossLines,
  fiscal: Pick<FiscalBackend, "assertRecordableAt">,
  closeDay?: string,
): IssueMoment {
  const reading = clock.now();
  fiscal.assertRecordableAt(reading);
  const issueDay = localCalendarDate(reading.instant, reading.offsetMinutes);
  const earlier = closeDay !== undefined && closeDay < issueDay ? closeDay : undefined;
  return {
    priced: rateLines(gross, earlier ?? issueDay),
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
