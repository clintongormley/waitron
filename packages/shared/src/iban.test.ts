import { describe, expect, it } from "vitest";
import { ibanGroups, ibanProblem, maskIban, normalizeIban } from "./iban.js";

const SPANISH = "ES9121000418450200051332";
const GERMAN = "DE89370400440532013000";
const MALTESE = "MT84MALT011000012345MTLCAST001S";
// The shortest (15) and longest (34) lengths the format allows, each with a correct check.
const NORWEGIAN = "NO9386011117947";
const LONGEST = "GB32ABCD1234567890ABCDEF12345678AB";

describe("normalizeIban", () => {
  it("removes every kind of whitespace and uppercases", () => {
    expect(normalizeIban(" es91 2100 0418\t4502 0005 1332 ")).toBe(SPANISH);
    expect(normalizeIban("de89\n3704 0044 0532 0130 00")).toBe(GERMAN);
  });
});

describe("ibanProblem", () => {
  it("accepts IBANs whose format and check digits are right", () => {
    expect(ibanProblem(SPANISH)).toBeUndefined();
    expect(ibanProblem(GERMAN)).toBeUndefined();
    expect(ibanProblem(MALTESE)).toBeUndefined();
  });

  it("accepts the shortest and longest lengths the format allows", () => {
    expect(ibanProblem(NORWEGIAN)).toBeUndefined();
    expect(ibanProblem(LONGEST)).toBeUndefined();
  });

  it("refuses one changed digit as a checksum problem", () => {
    expect(ibanProblem("ES9121000418450200051333")).toBe("checksum");
    expect(ibanProblem("DE89370400440532013001")).toBe("checksum");
  });

  it("refuses a Spanish IBAN that is not exactly 24 characters", () => {
    expect(ibanProblem("ES91210004184502000513")).toBe("format");
    // Its check digits are right for 25 characters, so only the Spanish length refuses it.
    expect(ibanProblem("ES48210004184502000513321")).toBe("format");
  });

  it("refuses lengths outside 15 to 34 characters", () => {
    expect(ibanProblem(NORWEGIAN.slice(0, 14))).toBe("format");
    expect(ibanProblem(`${LONGEST}0`)).toBe("format");
  });

  it("refuses a value without a country code or with letters in the check digits", () => {
    expect(ibanProblem("9121000418450200051332")).toBe("format");
    expect(ibanProblem("ES9I21000418450200051332")).toBe("format");
  });

  it("refuses a value that was not normalized", () => {
    expect(ibanProblem("es9121000418450200051332")).toBe("format");
    expect(ibanProblem("ES91 2100 0418 4502 0005 1332")).toBe("format");
    expect(ibanProblem(`${SPANISH}-`)).toBe("format");
    expect(ibanProblem("")).toBe("format");
  });
});

describe("ibanGroups", () => {
  it("splits into groups of four", () => {
    expect(ibanGroups(SPANISH)).toEqual(["ES91", "2100", "0418", "4502", "0005", "1332"]);
  });

  it("leaves a shorter last group", () => {
    expect(ibanGroups(GERMAN)).toEqual(["DE89", "3704", "0044", "0532", "0130", "00"]);
  });

  it("gives no groups for an empty value", () => {
    expect(ibanGroups("")).toEqual([]);
  });
});

describe("maskIban", () => {
  it("shows the first four and last four characters and hides the rest, in groups", () => {
    expect(maskIban(SPANISH)).toBe("ES91 •••• •••• •••• •••• 1332");
    expect(maskIban(GERMAN)).toBe("DE89 •••• •••• •••• ••30 00");
  });
});
