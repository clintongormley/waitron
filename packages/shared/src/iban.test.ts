import { describe, expect, it } from "vitest";
import {
  BANK_NAME_MAX_LENGTH,
  bankNameProblem,
  ibanGroups,
  ibanProblem,
  ibanShapeProblem,
  maskIban,
  normalizeIban,
} from "./iban.js";

const SPANISH = "ES9121000418450200051332";
const GERMAN = "DE89370400440532013000";
const MALTESE = "MT84MALT011000012345MTLCAST001S";
// The SWIFT IBAN registry's own example IBANs.
const REGISTRY_EXAMPLES = [
  SPANISH,
  GERMAN,
  MALTESE,
  "FR1420041010050500013M02606",
  "PT50000201231234567890154",
  "IT60X0542811101000000123456",
  "GB29NWBK60161331926819",
  "NL91ABNA0417164300",
  "BE68539007547034",
  "NO9386011117947",
  "RU0304452522540817810538091310419",
];

/** The ISO 7064 mod-97 remainder, computed independently of `ibanProblem`. */
function mod97(iban: string): bigint {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return BigInt(rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))) % 97n;
}

/** `country` and `bban` with the check digits that make the whole value pass mod 97. */
function withCheckDigits(country: string, bban: string): string {
  const check = 98n - mod97(`${country}00${bban}`);
  return `${country}${String(check).padStart(2, "0")}${bban}`;
}

describe("normalizeIban", () => {
  it("removes every kind of whitespace and uppercases", () => {
    expect(normalizeIban(" es91 2100 0418\t4502 0005 1332 ")).toBe(SPANISH);
    expect(normalizeIban("de89\n3704 0044 0532 0130 00")).toBe(GERMAN);
  });
});

describe("ibanProblem", () => {
  it("accepts the registry's example IBANs", () => {
    for (const iban of REGISTRY_EXAMPLES) {
      expect(mod97(iban)).toBe(1n);
      expect(ibanProblem(iban)).toBeUndefined();
    }
  });

  it("refuses one changed digit as a checksum problem", () => {
    expect(ibanProblem("ES9121000418450200051333")).toBe("checksum");
    expect(ibanProblem("DE89370400440532013001")).toBe("checksum");
  });

  it("refuses values whose check digits are right but whose country format is not", () => {
    for (const iban of [
      // A letter where Spain's registry format has only digits.
      "ES08A1000418450200051332",
      // 21 characters; Germany's IBANs have 22.
      "DE5137040044053201300",
      // 15 characters; France's IBANs have 27.
      withCheckDigits("FR", "20041010050"),
      // Longer than the country's length.
      "ES48210004184502000513321",
      withCheckDigits("DE", "37040044053201300000"),
      // A digit where Britain's registry format has a letter.
      withCheckDigits("GB", "1WBK60161331926819"),
      // A letter where Britain's registry format has a digit.
      withCheckDigits("GB", "NWBK6016133192681X"),
      // A letter in the last group of Spain's format.
      withCheckDigits("ES", "2100041845020005133X"),
    ]) {
      expect(mod97(iban)).toBe(1n);
      expect(ibanProblem(iban)).toBe("format");
    }
  });

  it("refuses a country the registry does not list", () => {
    for (const iban of [
      withCheckDigits("US", "21000418450200051332"),
      withCheckDigits("ZZ", "1234"),
    ]) {
      expect(mod97(iban)).toBe(1n);
      expect(ibanProblem(iban)).toBe("format");
    }
  });

  it("refuses a value without a country code or with letters in the check digits", () => {
    expect(ibanProblem("9121000418450200051332")).toBe("format");
    expect(ibanProblem("ES9I21000418450200051332")).toBe("format");
  });

  it("refuses a value that was not normalized", () => {
    expect(ibanProblem("es9121000418450200051332")).toBe("format");
    expect(ibanProblem("ES91 2100 0418 4502 0005 1332")).toBe("format");
    expect(ibanProblem("IT60x0542811101000000123456")).toBe("format");
    expect(ibanProblem(`${SPANISH}-`)).toBe("format");
    expect(ibanProblem(`-${SPANISH}`)).toBe("format");
    expect(ibanProblem("")).toBe("format");
  });
});

describe("ibanShapeProblem", () => {
  it("accepts a value saved before a country's format was checked", () => {
    expect(ibanShapeProblem("ES08A1000418450200051332")).toBeUndefined();
    expect(ibanShapeProblem("DE5137040044053201300")).toBeUndefined();
    expect(ibanShapeProblem("GB32ABCD1234567890ABCDEF12345678AB")).toBeUndefined();
    expect(ibanShapeProblem(withCheckDigits("FR", "20041010050"))).toBeUndefined();
  });

  it("never checks the check digits", () => {
    expect(ibanShapeProblem("ES9121000418450200051333")).toBeUndefined();
  });

  it("refuses a Spanish value that is not exactly 24 characters", () => {
    expect(ibanShapeProblem("ES91210004184502000513")).toBe("format");
    expect(ibanShapeProblem("ES48210004184502000513321")).toBe("format");
  });

  it("refuses lengths outside 15 to 34 characters", () => {
    expect(ibanShapeProblem("NO938601111794")).toBe("format");
    expect(ibanShapeProblem("NO9386011117947")).toBeUndefined();
    expect(ibanShapeProblem("GB32ABCD1234567890ABCDEF12345678AB0")).toBe("format");
  });

  it("refuses a value without a country code, with letters in the check digits or not normalized", () => {
    for (const iban of [
      "9121000418450200051332",
      "ES9I21000418450200051332",
      "es9121000418450200051332",
      "ES91 2100 0418 4502 0005 1332",
      `${SPANISH}-`,
      `-${SPANISH}`,
      "",
    ]) {
      expect(ibanShapeProblem(iban)).toBe("format");
    }
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

describe("bankNameProblem", () => {
  it("accepts no name and a name of exactly 70 characters", () => {
    expect(BANK_NAME_MAX_LENGTH).toBe(70);
    expect(bankNameProblem("")).toBeUndefined();
    expect(bankNameProblem("B".repeat(70))).toBeUndefined();
  });

  it("refuses a name of 71 characters as too long", () => {
    expect(bankNameProblem("B".repeat(71))).toBe("length");
  });

  it("counts characters, not UTF-16 code units", () => {
    // Each of these takes two code units, so 70 of them are 140 units but 70 characters.
    expect(bankNameProblem("\u{1D505}".repeat(70))).toBeUndefined();
    expect(bankNameProblem("\u{1D505}".repeat(71))).toBe("length");
  });
});
