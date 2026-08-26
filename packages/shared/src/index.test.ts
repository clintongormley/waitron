import { describe, expect, it } from "vitest";
import {
  addDecimal,
  AppError,
  assertMoney,
  assertSupportedLocale,
  compareDecimal,
  COUNTRY_DEFAULT_LOCALE,
  decimal,
  divideDecimal,
  FALLBACK_LOCALE,
  fiscalRecordId,
  grossOf,
  hasCode,
  isAppError,
  isSupportedLocale,
  isZeroDecimal,
  locationId,
  MAX_MONEY_INTEGER_DIGITS,
  MONEY_SCALE,
  multiplyDecimal,
  negateDecimal,
  PROVINCE_DEFAULT_LOCALE,
  resolveActiveLocale,
  resolveVenueLocale,
  saleId,
  saleLineId,
  seriesId,
  subtractDecimal,
  sumDecimals,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALES,
  tenantId,
  tenderId,
  tillId,
  toScale,
  workingOrderId,
  workingOrderLineId,
} from "./index.js";

/**
 * A coherence check on the package root, not a duplicate of `errors.test.ts` / `ids.test.ts` /
 * `money.test.ts`. Those files already exercise every function in depth; this one only proves
 * that `./index.js` — the package's ENTIRE public surface, per its own comment — actually
 * re-exports each of them, so a consumer importing from the package root, rather than reaching
 * into `./errors.js` / `./ids.js` / `./money.js` directly, gets a surface that actually works.
 *
 * This is not merely a style nicety: `./index.js`'s re-exports are re-export BINDINGS, and a
 * binding that is declared but never actually imported anywhere shows as its own uncovered
 * function under coverage-v8 — a real (if trivial) gap, since a typo in one export's local name
 * (re-exporting the wrong symbol under the right name) would otherwise pass every other test in
 * this package untouched.
 */
describe("package public surface (./index.js)", () => {
  it("re-exports AppError, isAppError and hasCode", () => {
    const error = new AppError("shared.invalid_id", { kind: "TillId", value: "x" });
    expect(isAppError(error)).toBe(true);
    expect(hasCode(error, "shared.invalid_id")).toBe(true);
  });

  it("re-exports every id constructor", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(tenantId(uuid)).toBe(uuid);
    expect(locationId(uuid)).toBe(uuid);
    expect(tillId(uuid)).toBe(uuid);
    expect(seriesId(uuid)).toBe(uuid);
    expect(workingOrderId(uuid)).toBe(uuid);
    expect(workingOrderLineId(uuid)).toBe(uuid);
    expect(saleId(uuid)).toBe(uuid);
    expect(saleLineId(uuid)).toBe(uuid);
    expect(tenderId(uuid)).toBe(uuid);
    expect(fiscalRecordId(uuid)).toBe(uuid);
  });

  it("re-exports every decimal function and constant", () => {
    const a = decimal("1.10");
    const b = decimal("2.20");
    expect(addDecimal(a, b)).toBe("3.30");
    expect(subtractDecimal(b, a)).toBe("1.10");
    expect(multiplyDecimal(a, b)).toBe("2.4200");
    expect(divideDecimal(b, a, 2)).toBe("2.00");
    expect(negateDecimal(a)).toBe("-1.10");
    expect(isZeroDecimal(decimal("0"))).toBe(true);
    expect(compareDecimal(a, b)).toBe(-1);
    expect(sumDecimals([a, b])).toBe("3.30");
    expect(grossOf("1.50", "2.000")).toBe("3.00");
    expect(toScale(a, 3)).toBe("1.100");
    expect(assertMoney(a)).toBe("1.10");
    expect(MONEY_SCALE).toBe(2);
    expect(MAX_MONEY_INTEGER_DIGITS).toBe(12);
  });

  it("re-exports every locale binding", () => {
    expect(isSupportedLocale("es-ES")).toBe(true);
    expect(assertSupportedLocale("en-GB")).toBe("en-GB");
    expect(resolveVenueLocale({ country: "ES" })).toBe("es-ES");
    expect(resolveActiveLocale("en-GB", "es-ES")).toBe("en-GB");
    expect(SUPPORTED_LOCALES).toBeDefined();
    expect([...SUPPORTED_LOCALE_CODES]).toEqual(["es-ES", "en-GB"]);
    expect(FALLBACK_LOCALE).toBe("en-GB");
    expect(COUNTRY_DEFAULT_LOCALE).toEqual({ ES: "es-ES" });
    expect(PROVINCE_DEFAULT_LOCALE).toEqual({});
  });
});
