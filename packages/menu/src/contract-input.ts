import { AppError, isUuid, nonBlankTranslations } from "@waitron/shared";
import { validateOptionalTranslations } from "./optional-translations.js";
import "./errors.js";

interface ContractInput {
  invalid: (field: string) => never;
  record: (value: unknown, field: string) => Record<string, unknown>;
  keys: (value: Record<string, unknown>, allowed: string[], field: string) => void;
  staffName: (value: unknown, field: string) => string;
  translations: (value: unknown, field: string) => Record<string, string> | null;
  kitchenName: (value: unknown, field: string) => string | null;
  id: (value: unknown, field: string) => string;
}

export function contractInput(code: "extras.invalid" | "options.invalid"): ContractInput {
  function invalid(field: string): never {
    throw new AppError(code, { field });
  }
  function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
    return value as Record<string, unknown>;
  }
  function keys(value: Record<string, unknown>, allowed: string[], field: string) {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`);
  }
  function staffName(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") invalid(field);
    return value;
  }
  // Translation refusals carry the input field so the list editor can mark the right map.
  function translations(value: unknown, field: string): Record<string, string> | null {
    if (value === undefined || value === null) return null;
    const map = record(value, field);
    try {
      validateOptionalTranslations(map);
    } catch {
      invalid(field);
    }
    return nonBlankTranslations({ ...map } as Record<string, string>);
  }
  function kitchenName(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") invalid(field);
    return value.trim() === "" ? null : value;
  }
  function id(value: unknown, field: string): string {
    if (typeof value !== "string" || !isUuid(value)) invalid(field);
    return value.toLowerCase();
  }
  return { invalid, record, keys, staffName, translations, kitchenName, id };
}
