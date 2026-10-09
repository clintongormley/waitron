import { describe, expect, it } from "vitest";
import {
  addDecimal,
  AppError,
  assertSupportedLocale,
  blankComments,
  blankCommentsAndLiterals,
  BAND_RANK,
  classifyBand,
  compareDecimal,
  decimal,
  deriveDisplayName,
  deviceId,
  deviceOrigin,
  draftLineMergeKey,
  firstCodeInCauseChain,
  formatEquipmentCode,
  divideDecimal,
  FALLBACK_LOCALE,
  fiscalRecordId,
  grossOf,
  hasCode,
  isAppError,
  isSaleOrigin,
  isSupportedLocale,
  isUuid,
  isValidGuestCount,
  isValidTelephone,
  isZeroDecimal,
  jobOrigin,
  locationId,
  mapComments,
  MAX_GUEST_COUNT,
  MEDIA_FILENAME,
  MAX_MONEY_INTEGER_DIGITS,
  MAX_QUANTITY_INTEGER_DIGITS,
  MAX_RATE_INTEGER_DIGITS,
  MONEY_SCALE,
  multiplyDecimal,
  negateDecimal,
  nodeId,
  normaliseDraftLines,
  normaliseUuid,
  parseEquipmentCode,
  mayTakeOver,
  tillProviderForReader,
  readOrigin,
  readSaleOrigin,
  resolveActiveLocale,
  QUANTITY_SCALE,
  RATE_SCALE,
  SALE_SOURCES,
  saleId,
  saleLineId,
  seriesId,
  SOURCES,
  subtractDecimal,
  sumDecimals,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALES,
  tenderId,
  toScale,
  workingOrderId,
  workingOrderLineId,
  searchFor,
  sqliteFailureOf,
  stringToBasisPoints,
  stringToCents,
  stringToThousandths,
  textSearch,
  worstBand,
} from "./index.js";

describe("package public surface (./index.js)", () => {
  it("re-exports AppError, isAppError and hasCode", () => {
    const error = new AppError("shared.invalid_id", { kind: "DeviceId", value: "x" });
    expect(isAppError(error)).toBe(true);
    expect(hasCode(error, "shared.invalid_id")).toBe(true);
  });

  it("re-exports every id constructor and both uuid screens", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(isUuid(uuid)).toBe(true);
    expect(normaliseUuid(uuid.toUpperCase(), "ProductId")).toBe(uuid);
    expect(locationId(uuid)).toBe(uuid);
    expect(deviceId(uuid)).toBe(uuid);
    expect(nodeId(uuid)).toBe(uuid);
    expect(seriesId(uuid)).toBe(uuid);
    expect(workingOrderId(uuid)).toBe(uuid);
    expect(workingOrderLineId(uuid)).toBe(uuid);
    expect(saleId(uuid)).toBe(uuid);
    expect(saleLineId(uuid)).toBe(uuid);
    expect(tenderId(uuid)).toBe(uuid);
    expect(fiscalRecordId(uuid)).toBe(uuid);
  });

  it("re-exports the source vocabulary and its origin readers", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(SOURCES).toContain("dashboard");
    expect(SALE_SOURCES).toContain("readiness_test");
    expect(deviceOrigin(uuid)).toEqual({ source: "device", deviceId: uuid });
    expect(readOrigin("kitchen_timer", null)).toEqual(jobOrigin("kitchen_timer"));
    expect(isSaleOrigin(jobOrigin("demo_seed"))).toBe(true);
    expect(readSaleOrigin("demo_seed", null)).toEqual(jobOrigin("demo_seed"));
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
    expect(MONEY_SCALE).toBe(2);
    expect(MAX_MONEY_INTEGER_DIGITS).toBe(12);
    expect(QUANTITY_SCALE).toBe(3);
    expect(MAX_QUANTITY_INTEGER_DIGITS).toBe(9);
    expect(RATE_SCALE).toBe(2);
    expect(MAX_RATE_INTEGER_DIGITS).toBe(3);
  });

  it("re-exports the seating bound and its check", () => {
    expect(MAX_GUEST_COUNT).toBe(999);
    expect(isValidGuestCount(MAX_GUEST_COUNT)).toBe(true);
  });

  it("re-exports the string-to-stored-count converters", () => {
    expect(stringToCents("12.34")).toBe(1234);
    expect(stringToThousandths("1.5")).toBe(1500);
    expect(stringToBasisPoints("21.00")).toBe(2100);
  });

  it("re-exports every locale binding", () => {
    expect(isSupportedLocale("es-ES")).toBe(true);
    expect(assertSupportedLocale("en-GB")).toBe("en-GB");
    expect(resolveActiveLocale("en-GB", "es-ES")).toBe("en-GB");
    expect(SUPPORTED_LOCALES).toBeDefined();
    expect([...SUPPORTED_LOCALE_CODES]).toEqual(["es-ES", "en-GB"]);
    expect(FALLBACK_LOCALE).toBe("en-GB");
  });

  it("re-exports the cause-chain readers", () => {
    const wrapped = new Error("Failed query", {
      cause: Object.assign(new Error("no such table: tenants"), { errcode: 1 }),
    });
    expect(sqliteFailureOf(wrapped)).toEqual({ errcode: 1, message: "no such table: tenants" });
    const coded = new Error("w", { cause: Object.assign(new Error("d"), { code: "ENOENT" }) });
    expect(firstCodeInCauseChain(coded, (code) => code === "ENOENT")).toBe("ENOENT");
  });

  it("re-exports the profile helpers", () => {
    expect(deriveDisplayName("", "", "", "Alba", "Ruiz")).toBe("Alba Ruiz");
    expect(isValidTelephone("+34 600 000 000")).toBe(true);
  });

  it("re-exports the media library filename pattern", () => {
    expect(MEDIA_FILENAME.test(`${"ab".repeat(32)}.webp`)).toBe(true);
  });

  it("re-exports the equipment label code", () => {
    const id = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
    expect(parseEquipmentCode(formatEquipmentCode("printer", id))).toEqual({ kind: "printer", id });
  });

  it("re-exports the search matcher", () => {
    expect(
      searchFor("gin")([
        ["a", "virgin"],
        ["b", "gin"],
      ]),
    ).toEqual(["b", "a"]);
    expect(textSearch(" ")).toBeUndefined();
  });

  it("re-exports the equipment takeover rule", () => {
    expect(mayTakeOver("manage", true)).toBe(false);
  });

  it("re-exports the till's name for a reader's provider", () => {
    expect(tillProviderForReader("sumup")).toBe("sumup_cloud");
  });

  it("re-exports the timing band classifier", () => {
    const t = { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
    expect(classifyBand(0, 5 * 60_000, t)).toBe("warm");
    expect(worstBand(["fresh", "overdue", "warm"])).toBe("overdue");
    expect(BAND_RANK.forgotten).toBe(3);
  });

  it("re-exports the comment scanner", () => {
    expect(blankComments("a // c")).toBe("a     ");
    expect(blankCommentsAndLiterals('f("}") // c')).toBe('f(" ")     ');
    expect(mapComments("a /* c */", () => "")).toBe("a ");
  });

  it("re-exports the draft merge rule", () => {
    const beer = {
      menuItemId: "beer",
      variantId: null,
      menuVersionId: null,
      courseId: null,
      note: null,
      options: [],
      extras: [],
      quantity: "1",
      noMerge: false,
    };
    expect(normaliseDraftLines([beer, beer])).toEqual([{ ...beer, quantity: "2.000" }]);
  });

  it("re-exports the draft merge key", () => {
    const line = {
      menuItemId: "beer",
      variantId: null,
      menuVersionId: null,
      courseId: null,
      note: null,
      options: [],
      extras: [],
      quantity: "1",
      noMerge: false,
    };
    expect(draftLineMergeKey(line)).toEqual(expect.any(String));
    expect(draftLineMergeKey(line)).toBe(draftLineMergeKey({ ...line, quantity: "3.000" }));
    expect(draftLineMergeKey({ ...line, noMerge: true })).toBeNull();
  });
});
