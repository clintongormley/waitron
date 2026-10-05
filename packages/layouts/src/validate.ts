import { isValidEmail } from "@waitron/identity";
import { AppError, isValidTelephone, MEDIA_FILENAME } from "@waitron/shared";
import "./errors.js";
import type { ReceiptConfig } from "./types.js";

export const MAX_RECEIPT_FIELD_LENGTH = 200;
export const MAX_RECEIPT_PHONE_LENGTH = 30;
export const MAX_RECEIPT_EMAIL_LENGTH = 254;

const TEXT_FIELDS = ["headerSubtitle", "footerMessage"] as const;
export const RECEIPT_STRING_FIELDS = [...TEXT_FIELDS, "phone", "email", "logo"] as const;
const RECEIPT_FIELDS = [...RECEIPT_STRING_FIELDS, "printAddress"] as const;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPhone(value: string): boolean {
  return value.length <= MAX_RECEIPT_PHONE_LENGTH && isValidTelephone(value);
}

/** `isValidEmail` trims first; the receipt prints what is stored, so surrounding space is refused. */
function isEmail(value: string): boolean {
  return value.length <= MAX_RECEIPT_EMAIL_LENGTH && value.trim() === value && isValidEmail(value);
}

const SHAPED_FIELDS = {
  phone: { valid: isPhone, reason: "invalid_phone" },
  email: { valid: isEmail, reason: "invalid_email" },
  logo: { valid: (value: string) => MEDIA_FILENAME.test(value), reason: "invalid_logo" },
} as const;

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
  for (const field of TEXT_FIELDS) {
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
  for (const [field, { valid, reason }] of Object.entries(SHAPED_FIELDS) as [
    keyof typeof SHAPED_FIELDS,
    (typeof SHAPED_FIELDS)[keyof typeof SHAPED_FIELDS],
  ][]) {
    const value = input[field];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string") {
      throw new AppError("receipt.invalid", { reason: "not_string", field });
    }
    if (!valid(value)) throw new AppError("receipt.invalid", { reason, field });
    result[field] = value;
  }
  if (input.printAddress !== undefined) {
    if (typeof input.printAddress !== "boolean") {
      throw new AppError("receipt.invalid", { reason: "not_boolean", field: "printAddress" });
    }
    result.printAddress = input.printAddress;
  }
  return result;
}
