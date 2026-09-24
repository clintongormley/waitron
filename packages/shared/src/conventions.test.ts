import { describe, expect, it } from "vitest";

/**
 * Vite supplies `import.meta.glob` at runtime, but its type normally comes from `vite/client`,
 * and `vite` does not resolve from this package, so this types the one member this file calls.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

// `?raw` so the sources are read as text and never evaluated.
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
    expect(source).not.toMatch(/export\s+(?:function|const)\s+to(?:Number|Float)/);
  });

  it("still uses number for scales, which are counts rather than quantities", () => {
    expect(source).toContain("scale: number");
  });
});

describe("cents.ts crosses into the number type without rounding one", () => {
  const source = sourceOf("cents.ts");

  it.each([
    ["parseFloat", "parseFloat"],
    ["parseInt", "parseInt"],
    ["toFixed", ".toFixed("],
    ["Math.round", "Math.round"],
    ["Math.floor", "Math.floor"],
    ["Math.abs", "Math.abs"],
  ])("contains no %s", (_label, token) => {
    // This file is allowed the number constructor — converting a count of cents is what it is
    // for — and nothing else from the float family.
    expect(source).not.toContain(token);
  });

  it("rounds only through scales.ts's scaledCount, which calls money.ts", () => {
    expect(source).toContain("scaledCount(");
  });
});

describe("scales.ts crosses into the number type without rounding one", () => {
  const source = sourceOf("scales.ts");

  it.each([
    ["parseFloat", "parseFloat"],
    ["parseInt", "parseInt"],
    ["toFixed", ".toFixed("],
    ["Math.round", "Math.round"],
    ["Math.floor", "Math.floor"],
    ["Math.abs", "Math.abs"],
  ])("contains no %s", (_label, token) => {
    expect(source).not.toContain(token);
  });

  it("rounds only by calling money.ts", () => {
    expect(source).toContain("toScale(");
  });
});

describe("errors never carry prose", () => {
  it.each(Object.entries(sources))("%s throws only AppError", (_path, source) => {
    // `new Error("...")` anywhere in this package would produce a message no translation table
    // can key off.
    expect(source).not.toMatch(/throw new Error\(/);
  });
});
