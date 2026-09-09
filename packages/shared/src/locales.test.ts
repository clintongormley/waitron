import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  assertSupportedLocale,
  isSupportedLocale,
  resolveActiveLocale,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALES,
} from "./locales.js";

describe("isSupportedLocale", () => {
  it("accepts the shipped codes and rejects others / nullish", () => {
    expect(isSupportedLocale("es-ES")).toBe(true);
    expect(isSupportedLocale("en-GB")).toBe(true);
    expect(isSupportedLocale("ca-ES")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});

describe("assertSupportedLocale", () => {
  it("returns a supported code unchanged", () => {
    expect(assertSupportedLocale("es-ES")).toBe("es-ES");
  });
  it("throws locale.unsupported carrying the bad value", () => {
    try {
      assertSupportedLocale("ca-ES");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("locale.unsupported");
      expect((err as AppError).params).toEqual({ locale: "ca-ES" });
    }
  });
});

describe("resolveActiveLocale (person ?? venue, always supported)", () => {
  it("a supported personal choice wins", () => {
    expect(resolveActiveLocale("en-GB", "es-ES")).toBe("en-GB");
  });
  it("null/unsupported personal choice falls to the (supported) venue default", () => {
    expect(resolveActiveLocale(null, "es-ES")).toBe("es-ES");
    expect(resolveActiveLocale("ca-ES", "es-ES")).toBe("es-ES");
  });
  it("an unsupported venue default degrades to the English floor", () => {
    expect(resolveActiveLocale(null, "ca-ES")).toBe("en-GB");
  });
});

it("SUPPORTED_LOCALES pins the shipped catalogue, codes and endonym labels", () => {
  expect([...SUPPORTED_LOCALES]).toEqual([
    { code: "es-ES", label: "Español" },
    { code: "en-GB", label: "English" },
  ]);
});

it("SUPPORTED_LOCALE_CODES matches the shipped catalogue set", () => {
  expect([...SUPPORTED_LOCALE_CODES]).toEqual(["es-ES", "en-GB"]);
});
