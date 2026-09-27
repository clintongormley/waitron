import { describe, expect, it, vi } from "vitest";
import { grossBasketWithOptions, type PriceableProduct } from "@waitron/catalogue";
import type { TrustedClock, TrustedTimeAnchor } from "@waitron/fiscal";
import { issueMoment } from "./issue-moment.js";

// A release that ships a reduced rate of 11% from 1 January 2027, the shipped table otherwise.
vi.mock("@waitron/catalogue/src/vat-rates.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@waitron/catalogue/src/vat-rates.js")>();
  const table = {
    ...original.VAT_RATE_TABLE,
    reduced: [
      { from: null, rate: "10.00" },
      { from: "2027-01-01", rate: "11.00" },
    ],
  };
  return {
    ...original,
    VAT_RATE_TABLE: table,
    vatRatesOn: (...[date, given]: Parameters<typeof original.vatRatesOn>) =>
      original.vatRatesOn(date, given ?? table),
  };
});

const cana: PriceableProduct = {
  name: "Caña",
  descriptions: { "es-ES": "Caña" },
  unit: { name: { "es-ES": "unidad" }, precision: 0, abbreviation: { "es-ES": "ud" } },
  unitPrice: "2.50",
  vatClass: "reduced",
  category: null,
};
const gross = () => grossBasketWithOptions([{ product: cana, quantity: "1", options: [] }]);

/** A clock whose every reading is `tickMs` after the one before, starting at `start`. */
function movingClock(start: string, offsetMinutes: number, tickMs: number) {
  let at = Date.parse(start);
  const now = vi.fn(() => {
    const instant = new Date(at);
    at += tickMs;
    return {
      instant,
      offsetMinutes,
      confident: true,
      confidence: "anchored" as const,
      anchorAgeSeconds: 0,
    };
  });
  const current: TrustedTimeAnchor = {
    trustedAtMs: Date.parse(start),
    offsetMinutes,
    monotonicMs: 0,
    wallClockMs: Date.parse(start),
    source: "upstream",
  };
  const anchor = vi.fn(() => current);
  const clock: TrustedClock = { now, anchor, currentAnchor: () => current };
  return { clock, now, anchor, current };
}

describe("issueMoment", () => {
  it("rates the lines on the local date of one reading, and pins the returned clock to it", () => {
    // 23:59:59.999 on 31 December in Madrid; every later reading is New Year's Day.
    const { clock, now } = movingClock("2026-12-31T22:59:59.999Z", 60, 1);

    const issue = issueMoment(clock, gross());

    expect(issue.priced.vatBreakdown).toEqual([{ rate: "10.00", base: "2.27", tax: "0.23" }]);
    expect(issue.priced.total).toBe("2.50");
    expect(now).toHaveBeenCalledTimes(1);
    expect(issue.clock.now().instant.toISOString()).toBe("2026-12-31T22:59:59.999Z");
    expect(issue.clock.now().instant.toISOString()).toBe("2026-12-31T22:59:59.999Z");
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("takes the date at the reading's offset, not in UTC", () => {
    // 23:30 UTC on 31 December is 00:30 on 1 January at UTC+1.
    const east = movingClock("2026-12-31T23:30:00.000Z", 60, 0);
    const utc = movingClock("2026-12-31T23:30:00.000Z", 0, 0);

    expect(issueMoment(east.clock, gross()).priced.lines[0]!.vatRate).toBe("11.00");
    expect(issueMoment(utc.clock, gross()).priced.lines[0]!.vatRate).toBe("10.00");
  });

  it("passes anchoring through to the clock it was given", () => {
    const { clock, anchor, current } = movingClock("2026-12-31T12:00:00.000Z", 60, 0);
    const issue = issueMoment(clock, gross());
    const trusted = {
      instant: new Date("2026-12-31T12:00:05.000Z"),
      offsetMinutes: 60,
      source: "upstream" as const,
    };

    expect(issue.clock.anchor(trusted)).toBe(current);
    expect(anchor).toHaveBeenCalledWith(trusted);
    expect(issue.clock.currentAnchor()).toBe(current);
  });
});
