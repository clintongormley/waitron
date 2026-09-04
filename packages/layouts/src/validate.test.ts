import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import { MAX_RECEIPT_FIELD_LENGTH, validateReceiptConfig } from "./validate.js";

/** Run `fn`, assert it threw an `AppError`, and return it so the caller can inspect code + params.
 *  A plain `toThrow` checks the message (= the code) but not the params, which is where these codes
 *  carry the whole of what went wrong (CLAUDE.md §1: params name the problem). */
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
});
