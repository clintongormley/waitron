import { expect, test } from "vitest";
import { CSSResult } from "lit";
import { HOME_GRID_COLUMNS } from "@waitron/shared";

// The negative patterns matter: eagerly importing a *.test.ts file would register its tests into
// this file's run. The package's own style modules sit beside its index, which re-exports them.
const modules = import.meta.glob(
  ["./components/*.ts", "./*.ts", "!./**/*.test.ts", "!./*.d.ts", "!./index.ts"],
  { eager: true },
) as Record<string, Record<string, unknown>>;

interface StyledCtor {
  styles: unknown;
}

function isStyledCtor(value: unknown): value is StyledCtor {
  return typeof value === "function" && "styles" in value;
}

/** Every exported component's styles and every exported stylesheet, and any other stylesheet a
 * component keeps as a static. */
const components: Record<string, StyledCtor> = {};
function add(name: string, path: string, styled: StyledCtor) {
  components[name in components ? `${name} (${path})` : name] = styled;
}
for (const [path, mod] of Object.entries(modules)) {
  for (const [exportName, value] of Object.entries(mod)) {
    if (value instanceof CSSResult) add(exportName, path, { styles: value });
    else if (isStyledCtor(value)) {
      add(exportName, path, value);
      for (const [key, extra] of Object.entries(Object.getOwnPropertyDescriptors(value)))
        if (key !== "styles" && extra.value instanceof CSSResult)
          add(`${exportName}.${key}`, path, { styles: extra.value });
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
    // Up to 1px is allowed as a hairline; rem and em are banned at any size. The menu tiles alone
    // may keep their 720 px height step, since a media condition cannot read a custom property,
    // and the shared column formula.
    let css = cssOf(ctor.styles);
    if (name === "menuTileStyles")
      css = css.replace(/@media \(width >= 720px\)\s*\{/g, "{").replaceAll(HOME_GRID_COLUMNS, "");
    const pxOffenders = numbersWithUnit(css, "px").filter((n) => Math.abs(n) > 1);
    const remEmOffenders = numbersWithUnit(css, String.raw`(?:rem|em)\b`);
    expect([...pxOffenders, ...remEmOffenders]).toEqual([]);
  });
}
