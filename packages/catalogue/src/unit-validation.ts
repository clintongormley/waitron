import { AppError, MAX_QUANTITY_INTEGER_DIGITS } from "@waitron/shared";
import "./errors.js";

/** The id a product with NO stored unit reads as: Each. It matches the till's own "each" fallback
 * (apps/till/src/widgets/product-name.ts) so server and till agree. */
export const EACH_UNIT_ID = "00000000-0000-0000-0000-000000000001";

export const MAX_UNIT_PRECISION = 3;
const QUANTITY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function validateUnitPrecision(precision: number): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_UNIT_PRECISION) {
    throw new AppError("unit.precision_invalid", {});
  }
  return precision;
}

export function assertQuantityPrecision(
  quantity: string,
  precision: number,
  options: { positive?: boolean } = {},
): string {
  validateUnitPrecision(precision);
  if (typeof quantity !== "string" || !QUANTITY_PATTERN.test(quantity)) {
    throw new AppError("quantity.invalid", { reason: "format" });
  }
  const unsigned = quantity.startsWith("-") ? quantity.slice(1) : quantity;
  const [integer, fraction = ""] = unsigned.split(".");
  if (integer!.length > MAX_QUANTITY_INTEGER_DIGITS) {
    throw new AppError("quantity.invalid", { reason: "limit" });
  }
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > precision) {
    throw new AppError("quantity.invalid", { reason: "precision" });
  }
  if (options.positive && (quantity.startsWith("-") || !/[1-9]/.test(unsigned))) {
    throw new AppError("quantity.invalid", { reason: "positive" });
  }
  return quantity;
}
