import { describe, expect, it } from "vitest";
import { WIZARD_LOCALE, countryName } from "./country-name.js";

describe("countryName", () => {
  it("names a country in the language it is asked for", () => {
    expect(countryName("ES", "en")).toBe("Spain");
    expect(countryName("ES", "es")).toBe("España");
  });

  it("names countries for the wizard in British English, where American English differs", () => {
    expect(countryName("ES", WIZARD_LOCALE)).toBe("Spain");
    expect(countryName("VI", WIZARD_LOCALE)).toBe("US Virgin Islands");
    expect(countryName("VI", "en")).toBe("U.S. Virgin Islands");
  });

  it("shows a well-formed code that has no name as the code itself", () => {
    expect(countryName("AA", "en")).toBe("AA");
  });

  it("shows a malformed code as it was stored rather than throwing", () => {
    expect(countryName("España", "en")).toBe("España");
  });

  it("shows the code rather than throwing when the locale is malformed", () => {
    expect(countryName("ES", "not a locale")).toBe("ES");
  });
});
