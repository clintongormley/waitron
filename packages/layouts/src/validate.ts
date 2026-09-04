import { AppError } from "@waitron/shared";
// Load this package's error-code registry so the `receipt.invalid` throw below has its
// `declare module "@waitron/shared"` augmentation in scope (reachability rule,
// packages/shared/src/errors.ts).
import "./errors.js";
import type { ReceiptConfig } from "./types.js";

/**
 * The character cap on each receipt trim field (design §5, assumption: 200). Exported so the editor
 * can bound its own inputs to the same policy. Carried in the `too_long` params as the cap, never the
 * offending length (CLAUDE.md §1).
 */
export const MAX_RECEIPT_FIELD_LENGTH = 200;

/** The two authorable receipt trim fields (design §7/§8). Any other key is rejected fail-closed. */
const RECEIPT_FIELDS = ["headerSubtitle", "footerMessage"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate an untrusted `ReceiptConfig` (design §5, §8). Returns the trim on success; throws
 * `receipt.invalid`. Rejects any field outside `headerSubtitle` / `footerMessage` fail-closed, so no
 * unknown field can ride along and later suppress a mandated art. 7.1 element (design §8).
 */
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
