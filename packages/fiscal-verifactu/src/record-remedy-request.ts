import "./errors.js";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { findFilingCase } from "./filing-cases.js";

export function invalid(): never {
  throw new AppError("fiscal.remedy_request_invalid", {});
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

export function only(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}

export function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return invalid();
  return value;
}

/** The request's `caseRegistroId`, or, when it names none, the case open for its record. */
export async function requestCaseRegistroId(
  tx: Transaction,
  caseRegistroId: unknown,
  registroId: string,
): Promise<string> {
  if (caseRegistroId !== undefined) return text(caseRegistroId);
  if ((await findFilingCase(tx, registroId)) === undefined)
    throw new AppError("fiscal.remedy_invalid", { registroId });
  return registroId;
}
