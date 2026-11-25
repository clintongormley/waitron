import "./errors.js";

export function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
