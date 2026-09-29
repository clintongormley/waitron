import { afterEach, expect, it } from "vitest";
import { clockTime, countText, currentLocale, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en } from "./strings.js";

afterEach(() => {
  // t.ts's locale is module-level, so a setLocale in one test would leak into the next.
  setLocale("en-GB");
});

it("says a count of one with its singular key and any other count with the plural, in the active locale", () => {
  const many = "table.submitted_fired" as const;
  const one = "table.submitted_fired_one" as const;
  expect(countText(1, many, one)).toBe("Fired: 1 group.");
  expect(countText(2, many, one)).toBe("Fired: 2 groups.");
  expect(countText(0, many, one)).toBe("Fired: 0 groups.");
  setLocale("es-ES");
  expect(countText(3, many, one)).toBe(t(many, "es-ES").replace("{n}", "3"));
  expect(countText(1, many, one)).toBe(t(one, "es-ES"));
});

it("writes a time of day as two-digit hours and minutes in the active locale, from a date or a timestamp", () => {
  const fivePastNine = new Date(2026, 8, 28, 9, 5);
  setLocale("en-GB");
  expect(clockTime(fivePastNine)).toBe("09:05");
  expect(clockTime(fivePastNine.getTime())).toBe("09:05");
  setLocale("fi-FI");
  expect(clockTime(fivePastNine)).toBe("09.05");
});

it("resolves an English base key to Spanish", () => {
  expect(t("action.pay", "es-ES")).toBe("Cobrar");
});

it("falls back to the English base when a locale lacks the key", () => {
  expect(t("action.pay", "en")).toBe("Pay");
});

it("falls back to the English base for an unknown locale", () => {
  expect(t("action.pay", "fr")).toBe("Pay");
});

// The startup default is asserted in t.default.test.ts: afterEach's reset here would mask it.

it("uses the active locale when none is passed, and setLocale switches it", () => {
  expect(t("action.pay")).toBe("Pay");
  setLocale("es-ES");
  expect(currentLocale()).toBe("es-ES");
  expect(t("action.pay")).toBe("Cobrar");
});

it("notifies subscribers on setLocale and stops after unsubscribe", () => {
  let calls = 0;
  const off = subscribeLocale(() => {
    calls += 1;
  });
  setLocale("en-GB");
  expect(calls).toBe(1);
  off();
  setLocale("es-ES");
  expect(calls).toBe(1);
});

it("registers en-GB as a first-class catalogue entry", () => {
  // Checks the map directly: a t() comparison passes either way, because a missing en-GB catalogue
  // falls back to the same English base.
  expect(catalogues["en-GB"]).toBe(en);
});
