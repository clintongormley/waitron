import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale, t } from "./t.js";

afterEach(() => {
  // t.ts holds module-level locale state; reset to the shipped default so a
  // setLocale in one test cannot leak into another (order-independence, §4).
  setLocale("es-ES");
});

it("resolves an English base key to Spanish", () => {
  expect(t("action.save", "es-ES")).toBe("Guardar");
});

it("falls back to the English base when a locale lacks the key", () => {
  // "en" is itself a catalogue, so this exercises the base directly; the ??
  // fallback is proven separately below with a locale that has no catalogue.
  expect(t("action.save", "en")).toBe("Save");
});

it("falls back to the English base for an unknown locale", () => {
  // "fr" has no catalogue, so catalogues["fr"] is undefined and t must return
  // the English base rather than throwing — this is the ?? en[key] branch.
  expect(t("action.save", "fr")).toBe("Save");
});

it("defaults to the module locale when none is passed", () => {
  // The shipped default is es-ES (the dashboard renders Spanish), restored in afterEach.
  expect(t("action.save")).toBe("Guardar");
  setLocale("en");
  expect(currentLocale()).toBe("en");
  expect(t("action.save")).toBe("Save");
});
