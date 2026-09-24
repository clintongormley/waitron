import { expect, test } from "vitest";
import type { CSSResult } from "lit";

// The negative pattern matters: eagerly importing a *.test.ts file would register its tests into
// this file's run.
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

/** The sign sits inside the lookbehind's guard so `-2px` is matched too. */
function numbersWithUnit(css: string, unitPattern: string): number[] {
  return [...css.matchAll(new RegExp(`(?<![\\w-])(-?\\d*\\.?\\d+)${unitPattern}`, "g"))].map((m) =>
    Number(m[1]),
  );
}

for (const [name, ctor] of Object.entries(components)) {
  test(`${name} declares no literal colours`, () => {
    const css = cssOf(ctor.styles);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i);
    // Only these named colours are caught; any other keyword colour passes.
    expect(css).not.toMatch(
      /\b(red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown)\b/i,
    );
  });

  test(`${name} declares no literal px/rem/em sizing`, () => {
    // Up to 1px is allowed as a hairline; rem and em are banned at any size.
    const css = cssOf(ctor.styles);
    const pxOffenders = numbersWithUnit(css, "px").filter((n) => Math.abs(n) > 1);
    const remEmOffenders = numbersWithUnit(css, String.raw`(?:rem|em)\b`);
    expect([...pxOffenders, ...remEmOffenders]).toEqual([]);
  });
}
