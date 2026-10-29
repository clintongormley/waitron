import { describe, expect, it } from "vitest";
import { SPAIN } from "./spain.js";

describe("Spain's country-free invoice address", () => {
  it.each([
    "2 Main Street, 28013 Madrid, Madrid",
    "Main Street, 2, 28013 Madrid, Madrid",
    " 2 Main Street , 28013 Madrid , Madrid ",
    "2 Main Street, 00000 Madrid, Madrid",
    "2 Main Street, 99999 Madrid, Madrid",
  ])("accepts a complete address: %s", (address) => {
    expect(SPAIN.postalAddress?.isComplete(address)).toBe(true);
  });

  it.each([
    "",
    "2 Main Street",
    "28013 Madrid, Madrid",
    "2 Main Street, 28013 Madrid",
    "2 Main Street, 28013, Madrid",
    "2 Main Street, 2801 Madrid, Madrid",
    "2 Main Street, 280133 Madrid, Madrid",
    "2 Main Street, Madrid, Madrid",
    ", 28013 Madrid, Madrid",
    "Main Street, , 28013 Madrid, Madrid",
    "2 Main Street, 28013 Madrid, ",
    "2 Main Street, 28013 Madrid, Madrid, España",
  ])("refuses an incomplete or country-suffixed address: %s", (address) => {
    expect(SPAIN.postalAddress?.isComplete(address)).toBe(false);
  });

  it("supplies country names for English screens and every offered receipt language", () => {
    expect(SPAIN.countryNames).toEqual({
      "en-GB": "Spain",
      en: "Spain",
      es: "España",
      "es-ES": "España",
      "ca-ES": "Espanya",
      "gl-ES": "España",
      "eu-ES": "Espainia",
    });
  });
});
