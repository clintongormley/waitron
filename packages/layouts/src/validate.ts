import { AppError } from "@waitron/shared";
import "./errors.js";
import type { ReceiptConfig } from "./types.js";

export const MAX_RECEIPT_FIELD_LENGTH = 200;
export const MAX_RECEIPT_PHONE_LENGTH = 30;
export const MAX_RECEIPT_EMAIL_LENGTH = 254;

const TEXT_FIELDS = ["headerSubtitle", "footerMessage"] as const;
const RECEIPT_FIELDS = [...TEXT_FIELDS, "phone", "email", "printAddress", "logo"] as const;

const PHONE_CHARACTERS = /^[0-9 +().\-/]*$/;
const MIN_PHONE_DIGITS = 6;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A copy of `MEDIA_FILENAME` (`packages/media/src/routes.ts`): this package cannot import media. */
const LIBRARY_FILENAME = /^[0-9a-f]{64}\.(jpg|png|webp)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPhone(value: string): boolean {
  return (
    value.length <= MAX_RECEIPT_PHONE_LENGTH &&
    PHONE_CHARACTERS.test(value) &&
    (value.match(/[0-9]/g) ?? []).length >= MIN_PHONE_DIGITS
  );
}

function isEmail(value: string): boolean {
  return value.length <= MAX_RECEIPT_EMAIL_LENGTH && EMAIL.test(value);
}

const SHAPED_FIELDS = {
  phone: { valid: isPhone, reason: "invalid_phone" },
  email: { valid: isEmail, reason: "invalid_email" },
  logo: { valid: (value: string) => LIBRARY_FILENAME.test(value), reason: "invalid_logo" },
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
