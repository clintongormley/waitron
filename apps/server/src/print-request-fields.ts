import { requireString } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";

export function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  return requireString(v, field);
}
export function nullableOptionalString(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return requireString(v, field);
}
export function nullableOptionalInt(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}
export function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new AppError("management.request_invalid", { field });
  return v;
}
