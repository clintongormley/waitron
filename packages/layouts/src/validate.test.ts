import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import { MAX_RECEIPT_FIELD_LENGTH, validateReceiptConfig } from "./validate.js";

/** Returns the thrown `AppError` so a test can assert its params; `toThrow` does not check them. */
function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error("expected the call to throw an AppError, but it returned");
}

describe("validateReceiptConfig", () => {
  it("accepts an empty config", () => {
    expect(validateReceiptConfig({})).toEqual({});
  });

  it("accepts a footerMessage", () => {
    expect(validateReceiptConfig({ footerMessage: "Gracias por su visita" })).toEqual({
      footerMessage: "Gracias por su visita",
    });
  });

  it("accepts a headerSubtitle and a footerMessage together", () => {
    const input = { headerSubtitle: "Calle Mayor 1", footerMessage: "Hasta pronto" };
    expect(validateReceiptConfig(input)).toEqual(input);
  });

  it("accepts a field exactly at the length cap", () => {
    const value = "x".repeat(MAX_RECEIPT_FIELD_LENGTH);
    expect(validateReceiptConfig({ footerMessage: value })).toEqual({ footerMessage: value });
  });

  it("rejects a non-object input with reason not_object", () => {
    const error = catchAppError(() => validateReceiptConfig(null));
    expect(error.code).toBe("receipt.invalid");
    expect(error.params).toEqual({ reason: "not_object" });
  });

  it("rejects a non-string field with reason not_string, naming the field", () => {
    const error = catchAppError(() => validateReceiptConfig({ footerMessage: 5 }));
    expect(error.params).toEqual({ reason: "not_string", field: "footerMessage" });
  });

  it("rejects an over-length field with reason too_long (the length is not echoed)", () => {
    const value = "x".repeat(MAX_RECEIPT_FIELD_LENGTH + 1);
    const error = catchAppError(() => validateReceiptConfig({ headerSubtitle: value }));
    expect(error.params).toEqual({
      reason: "too_long",
      field: "headerSubtitle",
      maxLength: MAX_RECEIPT_FIELD_LENGTH,
    });
  });

  it("rejects an unknown field with reason unknown_field (fail-closed — no field may suppress the fiscal core, design §8)", () => {
    const error = catchAppError(() => validateReceiptConfig({ showCashChange: true }));
    expect(error.params).toEqual({ reason: "unknown_field" });
  });

  const LOGO = `${"ab".repeat(32)}.png`;

  it("accepts a phone, an email, the address switch and a library logo", () => {
    const input = {
      phone: "+34 (91) 123-45.67/8",
      email: "hola@bar-pepe.es",
      printAddress: false,
      logo: LOGO,
    };
    expect(validateReceiptConfig(input)).toEqual(input);
  });

  it("drops an empty phone, email or logo, which means not set", () => {
    expect(validateReceiptConfig({ phone: "", email: "", logo: "", footerMessage: "x" })).toEqual({
      footerMessage: "x",
    });
  });

  it("accepts a phone at 30 characters with at least six digits", () => {
    const phone = "1".repeat(6) + " ".repeat(24);
    expect(validateReceiptConfig({ phone })).toEqual({ phone });
  });

  it.each([
    ["one character too long", "1".repeat(31)],
    ["fewer than six digits", "(91) 2-34"],
    ["no digit at all", "+ ( ) - ."],
    ["a letter", "912 345 67a"],
    ["a character outside the allowed punctuation", "912#345678"],
  ])("refuses a phone with %s as invalid_phone", (_, phone) => {
    const error = catchAppError(() => validateReceiptConfig({ phone }));
    expect(error.params).toEqual({ reason: "invalid_phone", field: "phone" });
  });

  it("accepts an email at 254 characters", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(185)}.com`;
    expect(email).toHaveLength(254);
    expect(validateReceiptConfig({ email })).toEqual({ email });
  });

  it.each([
    ["one character too long", `${"a".repeat(64)}@${"b".repeat(186)}.com`],
    ["no at sign", "hola.bar-pepe.es"],
    ["no dot in the domain", "hola@localhost"],
    ["a space", "hola @bar.es"],
    ["two at signs", "a@b@c.es"],
    ["nothing before the at sign", "@bar.es"],
    ["nothing after the last dot", "hola@bar."],
  ])("refuses an email with %s as invalid_email", (_, email) => {
    const error = catchAppError(() => validateReceiptConfig({ email }));
    expect(error.params).toEqual({ reason: "invalid_email", field: "email" });
  });

  it("refuses a printAddress that is not a boolean as not_boolean", () => {
    const error = catchAppError(() => validateReceiptConfig({ printAddress: "false" }));
    expect(error.params).toEqual({ reason: "not_boolean", field: "printAddress" });
  });

  it.each([
    ["an uppercase hash", `${"AB".repeat(32)}.png`],
    ["a short hash", `${"ab".repeat(31)}.png`],
    ["another extension", `${"ab".repeat(32)}.gif`],
    ["a path", `../${"ab".repeat(32)}.png`],
  ])("refuses a logo with %s as invalid_logo", (_, logo) => {
    const error = catchAppError(() => validateReceiptConfig({ logo }));
    expect(error.params).toEqual({ reason: "invalid_logo", field: "logo" });
  });

  it.each(["phone", "email", "logo"])("refuses a non-string %s as not_string", (field) => {
    const error = catchAppError(() => validateReceiptConfig({ [field]: 912345678 }));
    expect(error.params).toEqual({ reason: "not_string", field });
  });

  it("refuses logoRasters from a caller: the server derives them", () => {
    const error = catchAppError(() => validateReceiptConfig({ logoRasters: {} }));
    expect(error.params).toEqual({ reason: "unknown_field" });
  });
});
