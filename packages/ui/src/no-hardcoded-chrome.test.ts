import { expect, test } from "vitest";
import type { CSSResult } from "lit";

// Every primitive under src/components/*.ts is picked up automatically via import.meta.glob,
// rather than a hand-maintained `{ WtButton, WtCard, ... }` registry. A registry silently stops
// covering a new primitive unless someone remembers to add it to this file too — the glob makes
// coverage the default instead of an opt-in step (see "Adding a primitive" in
// docs/developers/design-system.md).
// The negative pattern is required, not cosmetic: eagerly importing a *.test.ts file here would
// execute its top-level `test(...)` calls as a side effect of the import, registering them into
// THIS file's run (confirmed empirically — omitting the exclusion inflated this file from 12
// tests to 60, silently absorbing every other component test file's suite).
const modules = import.meta.glob(["./components/*.ts", "!./components/*.test.ts"], {
  eager: true,
}) as Record<string, Record<string, unknown>>;

interface StyledCtor {
  styles: unknown;
}

function isStyledCtor(value: unknown): value is StyledCtor {
  return typeof value === "function" && "styles" in value;
}

const components: Record<string, StyledCtor> = {};
for (const mod of Object.values(modules)) {
  for (const [exportName, value] of Object.entries(mod)) {
    if (isStyledCtor(value)) {
      components[exportName] = value;
    }
  }
}

function cssOf(styles: unknown): string {
  const list = Array.isArray(styles) ? styles : [styles];
  return list.map((s) => (s as CSSResult).cssText).join("\n");
}

/**
 * Matches `<number><unitPattern>` occurrences in `css` and returns the parsed numbers. Shared by
 * the px and rem/em checks in the "declares no literal px/rem/em sizing" test below — the two
 * share the identical number-capturing prefix and differ only in the unit suffix and whether a
 * magnitude filter applies afterward. See that test for why the number pattern and lookbehind
 * are shaped the way they are.
 */
function numbersWithUnit(css: string, unitPattern: string): number[] {
  return [...css.matchAll(new RegExp(`(?<![\\w-])(-?\\d*\\.?\\d+)${unitPattern}`, "g"))].map((m) =>
    Number(m[1]),
  );
}

for (const [name, ctor] of Object.entries(components)) {
  test(`${name} declares no literal colours`, () => {
    const css = cssOf(ctor.styles);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Covers the legacy functional colour syntaxes (rgb/hsl and their alpha variants) as well as
    // the modern CSS Color 4/5 functions (oklch/oklab/lch/lab/hwb/color-mix/color) — none of these
    // are hex, so the check above alone would let them straight through. `color(...)` (e.g.
    // `color(display-p3 1 0 0)`) is the CSS Color 4 predefined-colour-space function — distinct
    // from `color-mix(...)` and easy to miss since it looks like it could be the property name
    // `color:` at a glance. Relative-colour syntax (`rgb(from ... )`, `oklch(from ...)`, etc.)
    // reuses these same function names, so it's already covered without a separate pattern.
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i);
    // Catches keyword colours too, narrowly, without flagging
    // transparent/currentColor/inherit (which are legitimate escape hatches,
    // not hardcoded chrome).
    expect(css).not.toMatch(
      /\b(red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown)\b/i,
    );
  });

  test(`${name} declares no literal px/rem/em sizing`, () => {
    // 1px (and -1px) borders and 0 are permitted; anything with a magnitude greater than 1 must
    // be a token. Sub-1 fractional values (0.5px, -0.25px, ...) are treated the same as the 1px
    // hairline exception, not flagged: they're strictly less visually significant than a 1px
    // border, so demanding a token for 0.5px while permitting 1px outright would be an
    // inconsistent line to draw. rem/em sizing has no such exception at all — the rule bans
    // rem/em outright regardless of magnitude, so even 0.5rem must resolve through a token —
    // and min()/max()/clamp() must always resolve through a token too (e.g.
    // min(90vw, var(--wt-dialog-max-width))), not spell out a literal rem/em value inline.
    // The number pattern (`-?\d*\.?\d+`) catches decimals (2.5px, 1.25px — bare `\d+` missed
    // these) and signed values: the lookbehind `(?<![\w-])` that keeps this from matching inside
    // an identifier previously sat *between* the sign and the digits, which meant it silently
    // blocked matching negative numbers too (`-2px`'s "-" is itself excluded by `[\w-]`) — moving
    // the optional sign inside the guarded token fixes both gaps at once.
    const css = cssOf(ctor.styles);
    const pxOffenders = numbersWithUnit(css, "px").filter((n) => Math.abs(n) > 1);
    const remEmOffenders = numbersWithUnit(css, String.raw`(?:rem|em)\b`);
    expect([...pxOffenders, ...remEmOffenders]).toEqual([]);
  });
}
