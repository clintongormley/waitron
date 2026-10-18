// Reads source TEXT, which makes it weaker than its name: only a double-quoted `code: "..."` literal
// with one dot and nothing but lowercase letters, digits and underscores is found, so a code
// assembled at runtime, or spelled with another quote or a second dot, escapes this scan.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_MESSAGES } from "../apps/dashboard/src/i18n/alert-messages.js";

const root = join(import.meta.dirname, "..");

/** Files that name an ongoing (non-incident) alert code as a `code: "..."` string literal. */
const ONGOING_CODE_SOURCES = [
  "apps/server/src/alert-sources.ts",
  "packages/fiscal-verifactu/src/submission-alerts.ts",
  "packages/fiscal-verifactu/src/certificate-alerts.ts",
];

const CODE_RE = /code: "([a-z0-9_]+\.[a-z0-9_]+)"/g;

function ongoingCodes(): string[] {
  const codes = new Set<string>();
  for (const file of ONGOING_CODE_SOURCES) {
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(CODE_RE)) codes.add(match[1]!);
  }
  return [...codes];
}

describe("ongoing alert codes reach the dashboard", () => {
  it("finds the ongoing codes it is meant to guard", () => {
    expect(ongoingCodes().length).toBeGreaterThanOrEqual(9);
  });

  it("every ongoing code has English and Spanish wording", () => {
    const missing = ongoingCodes().filter(
      (code) => !(ALERT_MESSAGES[code]?.en && ALERT_MESSAGES[code]?.es),
    );
    expect(missing).toEqual([]);
  });
});
