import { isValidEmail } from "@waitron/identity";
import { AppError, isValidTelephone, MEDIA_FILENAME } from "@waitron/shared";
import "./errors.js";
import type { DepartmentReceiptConfig, ReceiptText, VenueReceiptSettings } from "@waitron/shared";
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

function requireAuthoredObject(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new AppError("receipt.invalid", { reason: "not_object" });
  }
  return input;
}

function requireKnownFields(input: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !fields.includes(key)) {
      throw new AppError("receipt.invalid", { reason: "unknown_field" });
    }
  }
}

function validateReceiptText(
  input: unknown,
  field: (typeof TEXT_FIELDS)[number],
  languages: readonly string[],
): ReceiptText | undefined {
  if (!isPlainObject(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new AppError("receipt.invalid", { reason: "not_object", field });
  }
  const result: Record<string, string> = {};
  for (const language of Reflect.ownKeys(input)) {
    if (
      typeof language !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(language) ||
      !languages.includes(language)
    ) {
      throw new AppError("receipt.invalid", { reason: "invalid_language", field });
    }
    const value = input[language];
    if (typeof value !== "string") {
      throw new AppError("receipt.invalid", { reason: "not_string", field, language });
    }
    if (value.length > MAX_RECEIPT_FIELD_LENGTH) {
      throw new AppError("receipt.invalid", {
        reason: "too_long",
        field,
        language,
        maxLength: MAX_RECEIPT_FIELD_LENGTH,
      });
    }
    if (value.trim() !== "") result[language] = value;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

export function validateDepartmentReceipt(
  input: unknown,
  languages: readonly string[],
): DepartmentReceiptConfig {
  const authored = requireAuthoredObject(input);
  requireKnownFields(authored, RECEIPT_STRING_FIELDS);
  const contact: Record<string, unknown> = {};
  for (const field of ["logo", "phone", "email"] as const) {
    if (Object.hasOwn(authored, field)) contact[field] = authored[field];
  }
  const validatedContact = validateReceiptConfig(contact);
  const result: DepartmentReceiptConfig = {};
  for (const field of ["logo", "phone", "email"] as const) {
    if (validatedContact[field] !== undefined) result[field] = validatedContact[field];
  }
  for (const field of TEXT_FIELDS) {
    if (authored[field] === undefined) continue;
    const text = validateReceiptText(authored[field], field, languages);
    if (text !== undefined) result[field] = text;
  }
  return result;
}

export function validateVenueReceiptSettings(input: unknown): VenueReceiptSettings {
  const authored = requireAuthoredObject(input);
  requireKnownFields(authored, ["logo", ...TEXT_FIELDS, "printAddress"]);
  return validateReceiptConfig(authored);
}
