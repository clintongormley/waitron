import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** No product code calls `assertIdentifier`; its removal is listed in `docs/backlog.md`. */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export function assertIdentifier(kind: "database", value: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new AppError("provisioning.invalid_identifier", { kind, value });
  }
}

export function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export { quoteLiteral } from "@waitron/shared";

/**
 * A generated secret, never operator-supplied — base64url's alphabet is `[A-Za-z0-9_-]`, which
 * contains no quote, no backslash and nothing a URL would re-encode.
 *
 * 24 bytes → 32 characters, 192 bits: base64url of a multiple of 3 bytes carries no `=` padding.
 */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}
