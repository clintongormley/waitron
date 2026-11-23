import { describe, expect, it } from "vitest";
import { PACK_WORDS, PART_WORDS, type PackLocale } from "./pack-words.js";

// The pack calls the Waitron machine "the box" in English and "servidor" in Spanish, never
// "equipo" (owner, 2026-11-22). Weaker than its name: only `PACK_WORDS` and `PART_WORDS` are read,
// and a function's words only for the sample arguments below.
function sentences(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    const args = Array.from({ length: value.length }, (_, index) => `${index + 1}`);
    out.push([path, String((value as (...args: string[]) => unknown)(...args))]);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) sentences(inner, `${path}.${key}`, out);
  }
}

function words(locale: PackLocale): [string, string][] {
  const out: [string, string][] = [];
  sentences(PACK_WORDS[locale], "pack", out);
  sentences(PART_WORDS[locale], "part", out);
  return out;
}

describe("the recovery pack's word for the Waitron machine", () => {
  it("reads both tables, nested ones and functions included", () => {
    const paths = words("en").map(([path]) => path);
    expect(paths).toContain("pack.part.server-key");
    expect(paths).toContain("part.emergency.steps.0");
    expect(paths).toContain("part.alsoServerKey");
  });

  it("calls it the box in English, never the server", () => {
    expect(words("en").filter(([, text]) => /\bservers?\b/i.test(text))).toEqual([]);
  });

  it("calls it servidor in Spanish, never equipo", () => {
    expect(words("es").filter(([, text]) => /\bequipos?\b/i.test(text))).toEqual([]);
  });
});
