import { AppError } from "@waitron/shared";
// Load this package's error-code registry so the `layout.invalid` / `receipt.invalid` throws below
// have their `declare module "@waitron/shared"` augmentation in scope (reachability rule,
// packages/shared/src/errors.ts).
import "./errors.js";
import type { LayoutDef, ReceiptConfig, WidgetType } from "./types.js";
import { WIDGET_TYPES } from "./types.js";
import { WIDGET_CONFIG } from "./widget-config.js";

/**
 * The sale-critical widgets a sellable till MUST place (design D4). "A till that cannot sell is a
 * shop that cannot trade" (CLAUDE.md §5); `held-orders` / `prep-queue` stay optional. Relaxes when a
 * non-selling till type (a KDS) arrives.
 */
const SALE_CRITICAL: readonly WidgetType[] = ["product-grid", "basket", "total", "tender-pay"];

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

function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && (WIDGET_TYPES as readonly string[]).includes(value);
}

/**
 * Validate an untrusted `LayoutDef` (design §6). Returns the layout on success; throws
 * `layout.invalid` with a `reason` naming the first rule broken. Never echoes a user value — see
 * errors.ts for the param contract.
 */
export function validateLayout(input: unknown): LayoutDef {
  if (!Array.isArray(input)) {
    throw new AppError("layout.invalid", { reason: "not_array" });
  }
  const seen = new Set<WidgetType>();
  const result: LayoutDef = [];
  for (const item of input) {
    if (!isPlainObject(item) || !isWidgetType(item.type)) {
      throw new AppError("layout.invalid", { reason: "unknown_widget" });
    }
    const type = item.type;
    if (seen.has(type)) {
      throw new AppError("layout.invalid", { reason: "duplicate", widget: type });
    }
    const region = item.region;
    if (region !== "main" && region !== "aside") {
      throw new AppError("layout.invalid", { reason: "bad_region", widget: type });
    }
    const config = item.config;
    if (!isPlainObject(config)) {
      throw new AppError("layout.invalid", { reason: "bad_config", widget: type });
    }
    const schema = WIDGET_CONFIG[type];
    for (const [key, value] of Object.entries(config)) {
      const validator = schema[key];
      if (validator === undefined || !validator(value)) {
        throw new AppError("layout.invalid", {
          reason: "bad_config",
          widget: type,
          configKey: key,
        });
      }
    }
    seen.add(type);
    result.push({ type, region, config });
  }
  for (const required of SALE_CRITICAL) {
    if (!seen.has(required)) {
      throw new AppError("layout.invalid", { reason: "missing_required", widget: required });
    }
  }
  return result;
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
