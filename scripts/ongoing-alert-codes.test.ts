// Reads source TEXT, which makes it weaker than its name in one way: a code assembled at runtime
// (rather than written as a plain `code: "..."` string literal) escapes this scan. Every ongoing
// alert code today is a plain literal in one of the two listed files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_MESSAGES } from "../apps/dashboard/src/i18n/alert-messages.js";

const root = join(import.meta.dirname, "..");

/** Files that name an ongoing (non-incident) alert code as a `code: "..."` string literal. */
const ONGOING_CODE_SOURCES = [
  "apps/server/src/alert-sources.ts",
  "packages/fiscal-verifactu/src/submission-alerts.ts",
];

const CODE_RE = /code: "([a-z_]+\.[a-z_]+)"/g;

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
    // A control: the list is non-empty, so a broken regex fails loudly rather than passing vacuously.
    expect(ongoingCodes().length).toBeGreaterThanOrEqual(9);
  });

  it("every ongoing code has English and Spanish wording", () => {
    const missing = ongoingCodes().filter(
      (code) => !(ALERT_MESSAGES[code]?.en && ALERT_MESSAGES[code]?.es),
    );
    expect(missing).toEqual([]);
  });
});
