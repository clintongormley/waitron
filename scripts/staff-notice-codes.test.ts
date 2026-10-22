// Reads source TEXT, which makes it weaker than its name: only a double-quoted `code: "..."` literal
// with one or more dots in the files listed below is found, so a code assembled at runtime, spelled
// with another quote, or sent from a source in another file escapes this scan. It checks the till's
// strings, not that the till's wording function maps the code to them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en, es } from "../apps/till/src/i18n/strings.js";

const root = join(import.meta.dirname, "..");

/** Files whose staff-notice sources name a notice code as a `code: "..."` string literal. */
const NOTICE_CODE_SOURCES = [
  "apps/server/src/box-staff-notices.ts",
  "packages/fiscal-verifactu/src/staff-notices.ts",
];

const CODE_RE = /code: "([a-z0-9_]+(?:\.[a-z0-9_]+)+)"/g;

function noticeCodes(): string[] {
  const codes = new Set<string>();
  for (const file of NOTICE_CODE_SOURCES) {
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(CODE_RE)) codes.add(match[1]!);
  }
  return [...codes];
}

function worded(strings: Record<string, string>, code: string): boolean {
  const words = strings[`staff_notice.${code}`];
  return typeof words === "string" && words.trim() !== "";
}

function withoutWords(codes: readonly string[]): string[] {
  return codes.filter((code) => !(worded(en, code) && worded(es, code)));
}

describe("staff-notice codes have till words", () => {
  it("finds the notice codes it is meant to guard", () => {
    expect(noticeCodes()).toEqual(
      expect.arrayContaining([
        "storage.disk_full",
        "storage.space_low",
        "clock.unusable",
        "fiscal.records_unsent",
      ]),
    );
  });

  it("every notice code has English and Spanish words", () => {
    expect(withoutWords(noticeCodes())).toEqual([]);
  });

  it("names only the codes without words, and refuses blank words", () => {
    expect(withoutWords(["storage.disk_full", "zz.probe"])).toEqual(["zz.probe"]);
    expect(worded({ "staff_notice.zz.blank": " " }, "zz.blank")).toBe(false);
  });
});
