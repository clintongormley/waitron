import { createHash } from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) invalid();
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(",")}]`;
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], depth + 1)}`,
    )
    .join(",")}}`;
}
export const firstFiscalPublicJson = (value: unknown) => canonical(value);
export const firstFiscalPublicDigest = (value: unknown) =>
  createHash("sha256").update(firstFiscalPublicJson(value)).digest("hex");
