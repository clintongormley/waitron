import { localCalendarDate } from "@waitron/catalogue";
import type { TrustedClock } from "@waitron/fiscal";

/**
 * The one clock reading an invoice is issued at, and its local calendar date: the day whose VAT
 * rates the invoice files.
 */
export interface IssueMoment {
  /** Answers that same reading on every `now()`, so `recordSale` dates the invoice on the day its
   * lines were priced, even when the request runs across midnight. */
  clock: TrustedClock;
  on: string;
}

export function issueMoment(clock: TrustedClock): IssueMoment {
  const reading = clock.now();
  return {
    on: localCalendarDate(reading.instant, reading.offsetMinutes),
    clock: {
      now: () => reading,
      anchor: (trusted) => clock.anchor(trusted),
      currentAnchor: () => clock.currentAnchor(),
    },
  };
}
