import { AppError } from "@waitron/shared";
import "./errors.js";
import type { ReceiptConfig } from "./types.js";

export const MAX_RECEIPT_FIELD_LENGTH = 200;

const RECEIPT_FIELDS = ["headerSubtitle", "footerMessage"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReceiptConfig(input: unknown): ReceiptConfig {
  if (!isPlainObject(input)) {
    throw new AppError("receipt.invalid", { reason: "not_object" });
  }
  for (const key of Object.keys(input)) {
    if (!(RECEIPT_FIELDS as readonly string[]).includes(key)) {
      throw new AppError("receipt.invalid", { reason: "unknown_field" });
    }
  }
  const result: ReceiptConfig = {};
  for (const field of RECEIPT_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new AppError("receipt.invalid", { reason: "not_string", field });
    }
    if (value.length > MAX_RECEIPT_FIELD_LENGTH) {
      throw new AppError("receipt.invalid", {
        reason: "too_long",
        field,
        maxLength: MAX_RECEIPT_FIELD_LENGTH,
      });
    }
    result[field] = value;
  }
  return result;
}
