import { describe, expect, it } from "vitest";

/**
 * Vite supplies `import.meta.glob` at runtime — Vitest always runs through Vite's transform
 * pipeline, whether or not the `vite` package itself is resolvable from this workspace member —
 * but its *type* normally comes from a `/// <reference types="vite/client" />`, which requires
 * `vite` to be an installed, resolvable package. This package deliberately carries no
 * dependency beyond `vitest` (see package.json's own comment on why), so rather than add `vite`
 * as a devDependency solely to pull in that reference, this narrowly types the one member this
 * file actually calls.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

// `?raw` so the sources are read as text and never evaluated. The negative pattern excluding
// *.test.ts is load-bearing regardless: this file's own forbidden-token lists contain the very
// tokens being searched for, and a guard that flags itself is a guard nobody keeps.
const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sourceOf(name: string): string {
  const path = Object.keys(sources).find((key) => key.endsWith(`/${name}`) || key === `./${name}`);
  if (path === undefined) {
    throw new Error(`no source found for ${name}; the glob in conventions.test.ts is stale`);
  }
  return sources[path];
}

describe("the source glob itself", () => {
  it("discovers every module in this package", () => {
    // Without this the whole file degrades silently: a glob that matches nothing makes every
    // check below vacuously pass while reporting green.
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
  });

  it("does not pick up test files", () => {
    expect(Object.keys(sources).some((key) => key.includes(".test."))).toBe(false);
  });
});

describe("money.ts never touches a float", () => {
  const source = sourceOf("money.ts");

  it.each([
    ["Number(", "Number("],
    ["parseFloat", "parseFloat"],
    ["parseInt", "parseInt"],
    ["toFixed", ".toFixed("],
    ["Math.round", "Math.round"],
    ["Math.floor", "Math.floor"],
    ["Math.abs", "Math.abs"],
  ])("contains no %s", (_label, token) => {
    expect(source).not.toContain(token);
  });

  it("exports no numeric conversion", () => {
    // The absence of an export is the policy. `Object.hasOwn`-style existence checks on the
    // module object would work too, but a text check also catches a conversion added as a
    // non-exported helper that a colleague then exports next week.
    expect(source).not.toMatch(/export\s+(?:function|const)\s+to(?:Number|Float)/);
  });

  it("still uses number for scales, which are counts rather than quantities", () => {
    // Stated as a positive assertion so the rule above is not misread as "no `number` type in
    // this file". An exponent is a count of digit positions; it is exactly representable and
    // has nothing to do with money.
    expect(source).toContain("scale: number");
  });
});

describe("errors never carry prose", () => {
  it.each(Object.entries(sources))("%s throws only AppError", (_path, source) => {
    // `new Error("...")` anywhere in this package would produce a message no translation table
    // can key off, which is the precise failure spec §9 names.
    expect(source).not.toMatch(/throw new Error\(/);
  });
});
