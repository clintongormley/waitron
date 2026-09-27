import { localCalendarDate, rateLines } from "@waitron/catalogue";
import type { GrossLines, PricedLines } from "@waitron/catalogue";
import type { TrustedClock } from "@waitron/fiscal";

/** An invoice's lines at the rates of the day it is issued, and the clock that issues it. */
export interface IssueMoment {
  priced: PricedLines;
  /** Answers the one reading the lines were rated at on every `now()`, so `recordSale` dates the
   * invoice on the day whose rates it files, even when the request runs across midnight. */
  clock: TrustedClock;
}

/**
 * Take ONE clock reading and rate `gross` at its local calendar date. Every till path that issues an
 * invoice from an order's lines rates them here and hands `recordSale` the returned clock.
 */
export function issueMoment(clock: TrustedClock, gross: GrossLines): IssueMoment {
  const reading = clock.now();
  return {
    priced: rateLines(gross, localCalendarDate(reading.instant, reading.offsetMinutes)),
    clock: {
      now: () => reading,
      anchor: (trusted) => clock.anchor(trusted),
      currentAnchor: () => clock.currentAnchor(),
    },
  };
}
