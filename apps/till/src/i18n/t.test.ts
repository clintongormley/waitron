import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en } from "./strings.js";

afterEach(() => {
  // t.ts holds module-level locale state; reset to the shipped default so a
  // setLocale in one test cannot leak into another (order-independence, §4).
  setLocale("es-ES");
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

it("defaults to the module locale when none is passed", () => {
  // The shipped default is es-ES (the deli renders Spanish), restored in afterEach.
  expect(t("action.pay")).toBe("Cobrar");
  setLocale("en");
  expect(currentLocale()).toBe("en");
  expect(t("action.pay")).toBe("Pay");
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
