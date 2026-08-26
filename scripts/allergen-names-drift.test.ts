/**
 * Drift guard for the 14 EU allergen display names (Regulation (EU) No 1169/2011, Annex II).
 *
 * The names are REGULATED text and are duplicated in two apps on purpose — the dashboard is
 * deliberately decoupled from `@waitron/catalogue` and from `apps/till`, so it holds its own copy
 * rather than importing one (a runtime import would drag the catalogue barrel, and through it
 * `@waitron/db` and Node builtins, into the browser bundle). The two copies:
 *
 *   - `apps/till/src/i18n/allergen-names.ts`   — the source, `export const ALLERGEN_NAMES`
 *   - `apps/dashboard/src/i18n/domain.ts`      — a local `const ALLERGEN_NAMES`, whose own comment
 *                                                says its `es` column is copied VERBATIM from the till file
 *
 * With two hand-maintained copies of a legally-mandated string, a corrected spelling in one can
 * silently diverge from the other. This guard pins the two allergen maps EQUAL (both `en` and
 * `es`), so a fix to one that is not mirrored in the other fails here.
 *
 * It lives in the repo-level Vitest project rather than in either app, because the dashboard does
 * not import from the till (that is the whole point of the decoupling) so no single package is a
 * natural home. Like the other guards here it reads the files as TEXT and does NOT typecheck (the
 * root project has no typecheck — see the repo-root `vitest.config.ts`), so it is kept plain.
 *
 * Proven by deletion: change one allergen's spelling in one file and this suite goes red.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const TILL_FILE = resolve(REPO_ROOT, "apps/till/src/i18n/allergen-names.ts");
const DASHBOARD_FILE = resolve(REPO_ROOT, "apps/dashboard/src/i18n/domain.ts");

// The EU-14 codes (Annex II). The count and key set are asserted so the text parse below can never
// pass VACUOUSLY: two empty objects are deep-equal, so a regex that matched nothing would fake a
// green — CLAUDE.md §1, "a measurement taken where both answers look alike measures nothing".
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
 * Extract the body of the `ALLERGEN_NAMES` object literal from a source file by a balanced-brace
 * walk. Safe against the till file's `Record<AllergenCode, { en: string; es: string }>` type
 * annotation — the leading `[^=]*` stops at the assignment `=`, so the walk starts at the VALUE
 * brace, not the type literal's — and against the dashboard file's many other `NameTable`s, which
 * this never reaches because it stops at the matching close brace. The allergen string values hold
 * no `{`/`}`, so a naive brace count is exact here.
 */
function allergenMapBody(source: string): string {
  const decl = /(?:export\s+)?const ALLERGEN_NAMES\b[^=]*=\s*\{/.exec(source);
  if (!decl) throw new Error("ALLERGEN_NAMES declaration not found");
  const open = decl.index + decl[0].length - 1; // index of the value-literal '{'
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
