// Reads source TEXT, which makes it weaker than its name: only a double-quoted `code: "..."` literal
// with one or more dots in the files listed below is found, so a code assembled at runtime, spelled
// with another quote, or sent from a source in another file escapes this scan.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { staffNoticeText } from "../apps/till/src/i18n/staff-notices.js";
import { en, es } from "../apps/till/src/i18n/strings.js";
import { currentLocale, setLocale } from "../apps/till/src/i18n/t.js";

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

const LOCALES = ["en", "es"] as const;

/** Codes `staffNoticeText` draws as unknown in either language, given params a count can show. */
function wordedAsUnknown(codes: readonly string[]): string[] {
  const before = currentLocale();
  try {
    return codes.filter((code) =>
      LOCALES.some((locale) => {
        setLocale(locale);
        const unknown = staffNoticeText({ code: "", params: {} }).main;
        return (
          staffNoticeText({
            code,
            params: { count: 2, held: 0, printer: "Kitchen", since: "2026-10-23T19:16:00.000Z" },
          }).main === unknown
        );
      }),
    );
  } finally {
    setLocale(before);
  }
}

const NOT_A_CODE = "staff_notice_guard.never_a_code";

describe("staff-notice codes are worded by the till", () => {
  const startLocale = currentLocale();
  afterEach(() => setLocale(startLocale));

  it("finds the notice codes it is meant to guard", () => {
    expect(noticeCodes()).toEqual(
      expect.arrayContaining([
        "storage.disk_full",
        "storage.space_low",
        "clock.unusable",
        "fiscal.records_unsent",
        "printer.jobs_waiting",
      ]),
    );
  });

  it("every notice code has English and Spanish words", () => {
    expect(withoutWords(noticeCodes())).toEqual([]);
  });

  it("the till words every notice code, in English and Spanish, as more than 'needs attention'", () => {
    expect(wordedAsUnknown(noticeCodes())).toEqual([]);
  });

  it("names only the codes that are not worded, and refuses blank words", () => {
    expect(withoutWords(["storage.disk_full", NOT_A_CODE])).toEqual([NOT_A_CODE]);
    expect(wordedAsUnknown(["storage.disk_full", NOT_A_CODE])).toEqual([NOT_A_CODE]);
    expect(worded({ [`staff_notice.${NOT_A_CODE}`]: " " }, NOT_A_CODE)).toBe(false);
  });

  it("puts the till's language back", () => {
    setLocale("en-GB");
    wordedAsUnknown(noticeCodes());
    expect(currentLocale()).toBe("en-GB");
  });
});
