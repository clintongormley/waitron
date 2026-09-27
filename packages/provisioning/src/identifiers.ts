import { randomBytes } from "node:crypto";
import "./errors.js";

export function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export { quoteLiteral } from "@waitron/shared";

/**
 * A generated secret, never operator-supplied — base64url's alphabet is `[A-Za-z0-9_-]`, which
 * contains no quote and nothing a URL would re-encode.
 *
 * 24 bytes → 32 characters, 192 bits: base64url of a multiple of 3 bytes carries no `=` padding.
 */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}
