import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en } from "./strings.js";

afterEach(() => {
  // t.ts holds module-level locale state; reset to the shipped default (en-GB) so a
  // setLocale in one test cannot leak into another (order-independence, §4).
  setLocale("en-GB");
});

it("resolves an English base key to Spanish", () => {
  expect(t("action.pay", "es-ES")).toBe("Cobrar");
});

it("falls back to the English base when a locale lacks the key", () => {
  // "en" is itself a catalogue, so this exercises the base directly; the ??
  // fallback is proven separately below with a locale that has no catalogue.
  expect(t("action.pay", "en")).toBe("Pay");
});

it("falls back to the English base for an unknown locale", () => {
  // "fr" has no catalogue, so catalogues["fr"] is undefined and t must return
  // the English base rather than throwing — this is the ?? en[key] branch.
  expect(t("action.pay", "fr")).toBe("Pay");
});

// The pristine module STARTUP default (before any setLocale) is asserted in t.default.test.ts, a file
// that never mutates the locale — afterEach's reset here would mask it (§1).

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
  // Check the catalogue map directly: this fails if "en-GB": en is absent. A t()
  // comparison cannot — en-GB's catalogue value IS the en base, identical to the
  // ?? en[key] fallback, so t(k,"en-GB") === t(k,"en") holds either way (CLAUDE.md §1).
  expect(catalogues["en-GB"]).toBe(en);
});
