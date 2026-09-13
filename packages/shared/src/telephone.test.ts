import { describe, expect, it } from "vitest";
import { isValidTelephone } from "./telephone.js";

describe("isValidTelephone", () => {
  it("accepts well-formed numbers with optional '+' and separators", () => {
    expect(isValidTelephone("+34 600 000 000")).toBe(true);
    expect(isValidTelephone("+44 20 7946 0958")).toBe(true);
    expect(isValidTelephone("600123456")).toBe(true);
    expect(isValidTelephone("(020) 7946 0958")).toBe(true);
    expect(isValidTelephone("+1-222-333-4444")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidTelephone("")).toBe(false);
  });

  it("rejects letters and junk", () => {
    expect(isValidTelephone("not a phone")).toBe(false);
    expect(isValidTelephone("555-CALL")).toBe(false);
    expect(isValidTelephone("+44 20x")).toBe(false);
  });

  it("rejects tabs and newlines — only a literal space separates, per the documented list", () => {
    expect(isValidTelephone("123\t456")).toBe(false);
    expect(isValidTelephone("123\n456")).toBe(false);
  });

  it("rejects too few digits (fewer than 6)", () => {
    expect(isValidTelephone("+44 20")).toBe(false); // 4 digits
    expect(isValidTelephone("+34 600")).toBe(false); // 5 digits
    expect(isValidTelephone("12345")).toBe(false); // 5 digits
  });

  it("rejects too many digits (more than 15)", () => {
    expect(isValidTelephone("+1234567890123456")).toBe(false); // 16 digits
  });

  it("rejects a '+' that is not leading", () => {
    expect(isValidTelephone("44+20")).toBe(false);
  });
});
