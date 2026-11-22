import { describe, expect, it } from "vitest";
import { CODE_TABLES } from "./codes.js";
import { helpEn } from "./help-strings.js";
import { en } from "./strings.js";

// The till calls the Waitron machine "the box" in English (owner, 2026-11-22). "mail server" is the
// email service; "the Servers page" is the dashboard page, whose name the owner kept. Weaker than its
// name: only `en` in strings.ts, `helpEn` and the tables in `CODE_TABLES` are read, not English
// written inline in codes.ts's message functions or in components, nor the guide pages.
const ALLOWED = [/\bmail server\b/gi, /\bthe Servers page\b/g];

function englishSentences(value: unknown, path: string, out: [string, string][]): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value)) {
    if (key === "en" && typeof inner === "string") out.push([path, inner]);
    else englishSentences(inner, `${path}.${key}`, out);
  }
}

function sentences(): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, text] of Object.entries(en)) out.push([`strings.${key}`, text]);
  for (const [key, text] of Object.entries(helpEn)) out.push([`help.${key}`, text]);
  englishSentences(CODE_TABLES, "codes", out);
  return out;
}

describe("the till's English wording", () => {
  it("reads the codes' tables, nested tables included", () => {
    const paths = sentences().map(([path]) => path);
    expect(paths).toContain("codes.CODE_MESSAGES.server.internal");
    expect(paths).toContain("codes.CORRECTION_NOT_ADMITTED.wrong_node");
    expect(paths).toContain("codes.MONEY_SHORT_ADVANCES.one");
  });

  it("calls the Waitron machine the box, never the server", () => {
    const offending = sentences().filter(([, text]) => {
      const rest = ALLOWED.reduce((left, phrase) => left.replace(phrase, ""), text);
      return /\bservers?\b/i.test(rest);
    });
    expect(offending).toEqual([]);
  });
});
