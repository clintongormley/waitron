import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentLocale,
  makeT,
  pickLocale,
  registerCatalogue,
  resolveNameTable,
  setLocale,
  subscribeLocale,
  t,
  type NameTable,
} from "./i18n.js";

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

describe("resolveNameTable", () => {
  const table: NameTable = { booked: { en: "Booked", es: "Reservada" } };

  it("resolves a known token, region-stripped, then degrades to English", () => {
    expect(resolveNameTable(table, "booked")).toBe("Reservada"); // default es-ES -> es
    expect(resolveNameTable(table, "booked", "en-GB")).toBe("Booked"); // en-GB -> en
    expect(resolveNameTable(table, "booked", "fr")).toBe("Booked"); // unknown language -> English base
  });

  it("renders an unknown token as itself, never undefined", () => {
    expect(resolveNameTable(table, "not_a_token")).toBe("not_a_token");
  });

  it("renders a prototype-chain token as itself, not the inherited member", () => {
    for (const token of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      expect(resolveNameTable(table, token)).toBe(token);
    }
  });
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

it("strips every subtag after the language, and leaves a locale with no dash whole", () => {
  const entry = { en: "En", es: "Es" };
  expect(pickLocale(entry, "es-ES-valencia")).toBe("Es");
  expect(pickLocale(entry, "es")).toBe("Es");
  expect(t("x.hi", "es-419")).toBe("Hola");
  expect(t("x.hi", "-es")).toBe("Hi"); // an empty language has no catalogue
});

it("resolves a crafted 200,000-character locale in linear time", () => {
  const crafted = `${"-".repeat(200_000)}\n`;
  const started = performance.now();
  expect(t("x.hi", crafted)).toBe("Hi");
  expect(pickLocale({ en: "En", es: "Es" }, crafted)).toBe("En");
  expect(performance.now() - started).toBeLessThan(1000);
});
