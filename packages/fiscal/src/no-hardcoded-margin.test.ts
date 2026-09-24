import { describe, expect, it } from "vitest";
import { createTrustedClock } from "./clock.js";

/** Types the one `import.meta.glob` form this file calls, rather than adding `vite` as a
 * dependency for the `vite/client` types. */
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the source glob itself", () => {
  it("discovers the clock", () => {
    // Without this the checks below pass vacuously against an empty set.
    expect(Object.keys(sources).some((key) => key.endsWith("clock.ts"))).toBe(true);
  });
});

describe("no regulatory timestamp margin is encoded anywhere", () => {
  // The published submission tolerance has no number; the commonly reported ones are not in the
  // specification (docs/compliance/verifactu-findings.md). Encoding one would pin the code to a
  // figure nobody can cite.
  it.each(Object.entries(sources))("%s contains no 240-second constant", (_path, source) => {
    expect(source).not.toMatch(/\b240\b/);
    expect(source).not.toMatch(/240_?000/);
  });

  it.each(Object.entries(sources))("%s contains no 120-second constant", (_path, source) => {
    expect(source).not.toMatch(/\b120_?000\b/);
  });

  it.each(Object.entries(sources))("%s does not name a margin", (_path, source) => {
    expect(source.toLowerCase()).not.toMatch(/margen(?!\s+de\s+error»)/);
  });
});

describe("the degraded threshold has no default", () => {
  it("is required by the options type", () => {
    // @ts-expect-error degradedAfterSeconds has no default and must be supplied
    createTrustedClock({ tillId: "t", monotonic: () => 0, wallClock: () => 0 });
    expect(true).toBe(true);
  });

  it("changes behaviour with the value supplied, so no constant is being substituted", () => {
    // A substituted constant would make these two clocks agree; they must DISAGREE.
    const wallClock = () => 0;
    let monotonicMs = 10_000;
    const monotonic = () => monotonicMs;
    const strict = createTrustedClock({
      tillId: "t",
      monotonic,
      wallClock,
      degradedAfterSeconds: 1,
    });
    const lax = createTrustedClock({
      tillId: "t",
      monotonic,
      wallClock,
      degradedAfterSeconds: 100_000,
    });
    strict.anchor({ instant: new Date(0), offsetMinutes: 0, source: "upstream" });
    lax.anchor({ instant: new Date(0), offsetMinutes: 0, source: "upstream" });
    monotonicMs += 2_000;
    expect(strict.now().confidence).toBe("degraded");
    expect(lax.now().confidence).toBe("anchored");
  });
});
