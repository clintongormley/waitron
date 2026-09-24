/**
 * The 14 EU allergen names (Regulation (EU) No 1169/2011, Annex II) are regulated text, copied in
 * `apps/till/src/i18n/allergen-names.ts` and `apps/dashboard/src/i18n/domain.ts` because the
 * dashboard does not import the till. This pins the two copies equal, reading both as TEXT.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const TILL_FILE = resolve(REPO_ROOT, "apps/till/src/i18n/allergen-names.ts");
const DASHBOARD_FILE = resolve(REPO_ROOT, "apps/dashboard/src/i18n/domain.ts");

// The key set is asserted so the text parse cannot pass vacuously: two empty objects are equal.
const EU_ALLERGEN_CODES = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

type NameEntry = { en: string; es: string };

/**
 * The `ALLERGEN_NAMES` object literal's body, by a balanced-brace walk. The `[^=]*` skips the till
 * file's type annotation so the walk starts at the VALUE brace; the names hold no braces.
 */
function allergenMapBody(source: string): string {
  const decl = /(?:export\s+)?const ALLERGEN_NAMES\b[^=]*=\s*\{/.exec(source);
  if (!decl) throw new Error("ALLERGEN_NAMES declaration not found");
  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unterminated ALLERGEN_NAMES object literal");
}

/** Parse `code: { en: "…", es: "…" }` entries out of an object-literal body. */
function parseAllergenMap(file: string): Record<string, NameEntry> {
  const body = allergenMapBody(readFileSync(file, "utf8"));
  const entry = /(\w+):\s*\{\s*en:\s*"([^"]*)",\s*es:\s*"([^"]*)"\s*\}/g;
  const out: Record<string, NameEntry> = {};
  for (let m = entry.exec(body); m !== null; m = entry.exec(body)) {
    out[m[1]] = { en: m[2], es: m[3] };
  }
  return out;
}

describe("EU allergen names stay in step across till and dashboard", () => {
  const till = parseAllergenMap(TILL_FILE);
  const dashboard = parseAllergenMap(DASHBOARD_FILE);

  it("the till map parsed to exactly the 14 EU allergen codes", () => {
    expect(Object.keys(till).sort()).toEqual([...EU_ALLERGEN_CODES].sort());
  });

  it("the dashboard map parsed to exactly the 14 EU allergen codes", () => {
    expect(Object.keys(dashboard).sort()).toEqual([...EU_ALLERGEN_CODES].sort());
  });

  it("the two maps are identical (en and es) — a corrected spelling in one must mirror the other", () => {
    expect(dashboard).toEqual(till);
  });
});
