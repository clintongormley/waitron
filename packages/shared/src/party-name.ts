import { AppError } from "./errors.js";

export const TABLE_SEPARATOR = ", ";
export const PARTY_NAME_MAX = 40;

/** Tables sharing their first word are named once ("Table 4, 5, 7"); otherwise each in full. */
export function partyTablesName(
  labels: readonly string[],
  separator: string = TABLE_SEPARATOR,
): string {
  const words = labels.map((label) => {
    const space = label.indexOf(" ");
    return space <= 0 ? null : { first: label.slice(0, space), rest: label.slice(space + 1) };
  });
  const first = words[0]?.first;
  if (labels.length > 0 && words.every((word) => word !== null && word.first === first)) {
    return `${first} ${words.map((word) => word!.rest).join(separator)}`;
  }
  return labels.join(separator);
}

export function partyDisplayName(name: string | null, labels: readonly string[]): string {
  return name ?? partyTablesName(labels);
}

export function partyReceiptLabel(name: string | null, labels: readonly string[]): string {
  const tables = partyTablesName(labels);
  return name === null ? tables : `${name} · ${tables}`;
}

export function normalisePartyName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = typeof value === "string" ? value.trim() : null;
  if (trimmed === null || trimmed.length > PARTY_NAME_MAX) {
    throw new AppError("management.request_invalid", { field: "name" });
  }
  return trimmed === "" ? null : trimmed;
}
