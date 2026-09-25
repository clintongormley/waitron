import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en } from "./strings.js";

afterEach(() => {
  // t.ts's locale is module-level, so a setLocale in one test would leak into the next.
  setLocale("en-GB");
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
