import { afterEach, beforeEach, expect, it } from "vitest";
import { currentLocale, makeT, pickLocale, registerCatalogue, setLocale, subscribeLocale, t } from "./i18n.js";

beforeEach(() => {
  registerCatalogue({ en: { "x.hi": "Hi" }, es: { "x.hi": "Hola" } });
  setLocale("es-ES");
});
afterEach(() => {
  // Module-level locale state — reset to the shipped default so a setLocale in one test cannot leak.
  setLocale("es-ES");
});

it("resolves the region-stripped locale, then English, then the key", () => {
  expect(t("x.hi")).toBe("Hola"); // es-ES -> es
  expect(t("x.hi", "en-GB")).toBe("Hi"); // en-GB -> en
  expect(t("x.missing")).toBe("x.missing"); // unknown key degrades to the key, never undefined
});

it("falls back to the English base for a locale with no catalogue", () => {
  expect(t("x.hi", "fr")).toBe("Hi"); // fr has no catalogue -> catalogues.en
});

it("defaults t to the active locale, which setLocale swaps", () => {
  expect(currentLocale()).toBe("es-ES");
  expect(t("x.hi")).toBe("Hola");
  setLocale("en");
  expect(currentLocale()).toBe("en");
  expect(t("x.hi")).toBe("Hi");
});

it("makeT returns a t bound to the caller's key union", () => {
  const tk = makeT<"x.hi">();
  expect(tk("x.hi")).toBe("Hola");
  expect(tk("x.hi", "en")).toBe("Hi");
});

it("pickLocale strips the region, then degrades to English", () => {
  const entry = { en: "En", es: "Es" };
  expect(pickLocale(entry)).toBe("Es"); // default es-ES -> es
  expect(pickLocale(entry, "en-GB")).toBe("En"); // en-GB -> en
  expect(pickLocale(entry, "fr")).toBe("En"); // unknown language -> English base
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
