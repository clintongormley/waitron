import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@waitron/dashboard-modules";
import { currentLocale, setLocale } from "../i18n/t.js";
import { bookedReason } from "./floor-plan-booked.js";

const sentence = "This table has an upcoming booking. Move the booking first";

let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  vi.restoreAllMocks();
});

it("names the booking's day and time", () => {
  expect(bookedReason({ tableId: "l2", date: "2026-10-12", time: "21:00" })).toBe(
    "Booked 12 Oct, 21:00",
  );
  setLocale("es-ES");
  expect(bookedReason({ tableId: "l2", date: "2026-10-12", time: "21:00" })).toBe(
    "Reservada el 12 oct, 21:00",
  );
});

it("keeps the booking's day for a reader west of UTC", () => {
  const Real = Intl.DateTimeFormat;
  // Stands in for a browser whose own zone is New York: a format given no zone uses it.
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    locale?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new Real(locale, { timeZone: "America/New_York", ...options });
  } as typeof Intl.DateTimeFormat);
  expect(bookedReason({ tableId: "l2", date: "2026-10-12", time: "21:00" })).toBe(
    "Booked 12 Oct, 21:00",
  );
});

it.each([
  [{ tableId: "l2" }],
  [{ tableId: "l2", time: "21:00" }],
  [{ tableId: "l2", date: "2026-10-12" }],
  [{ tableId: "l2", date: "soon", time: "21:00" }],
  [{ tableId: "l2", date: "2026-10-12", time: "9pm" }],
  [{ tableId: "l2", date: "2026-10-12T00:00", time: "21:00" }],
])("falls back to the code's own sentence for %o", (params) => {
  expect(bookedReason(params)).toBe(sentence);
});
