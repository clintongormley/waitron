import { describe, expect, it } from "vitest";
import * as countries from "./index.js";

describe("recipient postal countries", () => {
  it.each(["FR", "GB", "IE", "HK", "AX", "TW", "GF", "PS", "AQ", "BQ"])(
    "offers and normalizes assigned postal country %s independently of venue packs",
    (code) => {
      expect(countries).toHaveProperty("normalizeRecipientCountryCode", expect.any(Function));
      expect(countries.normalizeRecipientCountryCode(` ${code.toLowerCase()} `)).toBe(code);
      expect(countries.RECIPIENT_COUNTRY_CODES).toContain(code);
    },
  );
  it.each(
    ["", " ", "XX", "ZZ", "EU", "UK", "SU", "ESP", "123", null, undefined, [], ["FR"], {}].map(
      (input) => [input],
    ),
  )("refuses malformed or unassigned postal country %j", (input) => {
    expect(countries).toHaveProperty("normalizeRecipientCountryCode", expect.any(Function));
    expect(countries.normalizeRecipientCountryCode(input)).toBeUndefined();
  });
});
