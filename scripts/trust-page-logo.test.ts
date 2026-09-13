import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pins the drawing inside `apps/server/src/trust-page-logo.ts` against the one brand lockup,
 * `packages/ui/brand/waitron-lockup.svg`.
 *
 * There are two copies of that drawing on purpose. The certificate-help page is one self-contained
 * HTML string served to a browser that may have no internet and no access to anything else on the
 * box, and `apps/server` does not depend on `@waitron/ui`, so the page cannot import or fetch the
 * brand file — the svg has to sit in the server's own source. Nothing else compares them: the brand
 * directory is excluded from `packages/ui`'s coverage, and `apps/server`'s own suite asserts what
 * the page renders, not whether the logo in it is still the logo. So redrawing the lockup would
 * leave the certificate page showing the old one behind a fully green gate.
 *
 * It lives in the ROOT project (CLAUDE.md §4) because it spans packages — the assertion is about
 * `apps/server` and `packages/ui/brand` agreeing, a fact neither package's own suite owns, and a
 * push that touches only `packages/ui/brand` does not put `apps/server` in scope.
 *
 * It reads TEXT and never imports, renders or executes either file. WHAT THAT CANNOT SEE, stated
 * rather than guarded:
 *
 *   - It proves the two DRAWINGS match. It proves nothing about whether the pasted svg actually
 *     renders, whether the wordmark and mark are readable against the page in either theme, or
 *     whether the `prefers-color-scheme` rule inside the svg works at all. Nothing anywhere checks
 *     those — there is no browser test of this page.
 *   - Paint and labelling are ignored deliberately, because they are the parts that differ: `fill`,
 *     `class`, `style`, the whole inline `<style>` block, `role` and `aria-label`. A wrong colour
 *     is invisible to this guard.
 *   - Attribute values are compared as raw TEXT, so two spellings of the same geometry (`x="0"` vs
 *     `x="0.0"`, or a reordered `transform`) read as drift. That is the intent: the copy is meant to
 *     be a copy.
 *   - The root `<svg>` element's own `width` and `height` are not compared — they are the page's
 *     display size and the brand file has none. Its `viewBox` IS compared.
 *   - Only markup between the first `<svg` and the last `</svg>` is read, so a second svg pasted
 *     elsewhere in the TypeScript file, or the constant being renamed, is not noticed here.
 *
 * Proven by deletion on 2026-09-13: perturbing one coordinate in `waitron-lockup.svg`
 * (`cx="102.45071"` → `cx="102.55071"` on the mark's head) turned this red, naming the position and
 * both values; restoring the file turned it green again.
 */
const REPO_ROOT = join(import.meta.dirname, "..");
const BRAND_PATH = join(REPO_ROOT, "packages", "ui", "brand", "waitron-lockup.svg");
const PAGE_PATH = join(REPO_ROOT, "apps", "server", "src", "trust-page-logo.ts");

/** Attributes that describe the drawing. Drift in any of these is a different picture. */
const GEOMETRY = new Set([
  "d",
  "viewBox",
  "transform",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "fill-rule",
]);

/** Attributes the two copies are allowed to differ on, or that say nothing about the drawing. */
const NOT_GEOMETRY = new Set(["fill", "class", "style", "role", "aria-label", "xmlns"]);

const ATTRIBUTE = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/g;
const ROOT_TAG = /^<svg\b[^>]*>/;

const RE_COPY =
  `The logo in apps/server/src/trust-page-logo.ts no longer draws the same picture as ` +
  `packages/ui/brand/waitron-lockup.svg. Re-copy the lockup's markup into that constant and ` +
  `re-apply only the three deliberate differences: the inline <style> block, class= in place of ` +
  `fill= on the two groups, and role/aria-label plus width/height on the root <svg>.`;

/** The svg element out of a file that may be TypeScript wrapping it in a template literal. */
function inlineSvg(source: string, path: string): string {
  const start = source.indexOf("<svg");
  const end = source.lastIndexOf("</svg>");
  if (start === -1 || end === -1) throw new Error(`no <svg> element found in ${path}`);
  return source.slice(start, end + "</svg>".length);
}

/** The root element's opening tag, and everything drawn inside it with any <style> removed. */
function parts(svg: string): { root: string; drawing: string } {
  const root = svg.match(ROOT_TAG)?.[0];
  if (!root) throw new Error("the svg does not start with an <svg ...> tag");
  return { root, drawing: svg.slice(root.length).replace(STYLE_BLOCK, "") };
}

/** Every geometry attribute value in the markup, in source order. */
function geometry(markup: string): string[] {
  return [...markup.matchAll(ATTRIBUTE)]
    .filter(([, name]) => GEOMETRY.has(name))
    .map(([, , value]) => value);
}

/** Every attribute name in the markup that this guard has no opinion about. */
function unclassified(markup: string): string[] {
  return [...markup.matchAll(ATTRIBUTE)]
    .map(([, name]) => name)
    .filter((name) => !GEOMETRY.has(name) && !NOT_GEOMETRY.has(name));
}

function show(value: string | undefined): string {
  if (value === undefined) return "nothing — the sequence ends here";
  return JSON.stringify(value.length > 90 ? `${value.slice(0, 90)}…` : value);
}

/** "" when the two drawings match, otherwise a line naming where and how they differ. */
function describeDrift(page: string[], brand: string[]): string {
  const longest = Math.max(page.length, brand.length);
  for (let i = 0; i < longest; i++) {
    if (page[i] !== brand[i]) {
      return (
        `${RE_COPY}\nFirst difference at geometry value ${i + 1} of ${longest}: ` +
        `the page has ${show(page[i])}, the lockup has ${show(brand[i])}.`
      );
    }
  }
  return "";
}

describe("the certificate page's logo still draws the brand lockup", () => {
  const brand = parts(inlineSvg(readFileSync(BRAND_PATH, "utf8"), BRAND_PATH));
  const page = parts(inlineSvg(readFileSync(PAGE_PATH, "utf8"), PAGE_PATH));

  it("draws the same geometry, attribute for attribute, in the same order", () => {
    expect(describeDrift(geometry(page.drawing), geometry(brand.drawing))).toBe("");
  });

  it("finds geometry to compare at all", () => {
    // Without this, an extractor that matched nothing would compare two empty lists and pass.
    expect(geometry(brand.drawing).length).toBeGreaterThan(20);
  });

  it("shares the lockup's viewBox", () => {
    const viewBox = (root: string) => root.match(/viewBox="([^"]*)"/)?.[1];
    expect(viewBox(page.root)).toBe(viewBox(brand.root));
  });

  it("carries no attribute this guard has not classified as drawing or not-drawing", () => {
    // A new attribute would otherwise be silently unchecked. Add it to GEOMETRY or NOT_GEOMETRY.
    expect({
      brand: [...new Set(unclassified(brand.root + brand.drawing))],
      page: [...new Set(unclassified(page.root + page.drawing))],
    }).toEqual({ brand: [], page: [] });
  });

  it("names the two copies and the fix when it fails", () => {
    const message = describeDrift(["a", "b"], ["a", "c"]);
    expect(message).toContain("trust-page-logo.ts");
    expect(message).toContain("waitron-lockup.svg");
    expect(message).toContain("Re-copy");
    expect(message).toContain('the page has "b", the lockup has "c"');
  });
});

describe("the detector itself", () => {
  it("collects geometry in source order and ignores paint and labelling", () => {
    expect(
      geometry('<g class="m" fill="#fff" transform="scale(2)"><rect x="1" width="3" /></g>'),
    ).toEqual(["scale(2)", "1", "3"]);
  });

  it("does not mistake fill-rule for fill", () => {
    expect(geometry('<path fill="#000" fill-rule="evenodd" d="M0,0" />')).toEqual([
      "evenodd",
      "M0,0",
    ]);
  });

  it("drops the inline <style> block along with the rest of the paint", () => {
    const { drawing } = parts('<svg viewBox="0 0 1 1"><style>.m{fill:#1f6feb}</style><g d="M0" />');
    expect(drawing).toBe('<g d="M0" />');
  });

  it("reads the svg out of a TypeScript file and leaves the surrounding source behind", () => {
    const source = 'export const X = `<svg viewBox="0 0 1 1"><g d="M0,0" /></svg>`;\n';
    expect(inlineSvg(source, "x.ts")).toBe('<svg viewBox="0 0 1 1"><g d="M0,0" /></svg>');
  });

  it("says which file has no svg in it", () => {
    expect(() => inlineSvg("export const X = 1;", "x.ts")).toThrow(
      "no <svg> element found in x.ts",
    );
  });

  it("reports a shorter drawing rather than passing on a prefix", () => {
    expect(describeDrift(["a"], ["a", "b"])).toContain(
      "the page has nothing — the sequence ends here",
    );
  });

  it("reports nothing when the two drawings match", () => {
    expect(describeDrift(["a", "b"], ["a", "b"])).toBe("");
  });

  it("flags an attribute it has never classified", () => {
    expect(unclassified('<path stroke="#000" d="M0,0" class="m" />')).toEqual(["stroke"]);
  });
});
