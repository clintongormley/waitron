import { describe, expect, it } from "vitest";
import { createTrustedClock } from "./clock.js";

/**
 * Vite supplies `import.meta.glob` at runtime — Vitest always runs through Vite's transform
 * pipeline, whether or not the `vite` package itself is resolvable from this workspace member —
 * but its *type* normally comes from a `/// <reference types="vite/client" />`, which requires
 * `vite` to be an installed, resolvable package. This package deliberately carries no dependency
 * beyond `@waitron/shared` and `vitest` (see package.json), so rather than add `vite` as a
 * devDependency solely to pull in that reference, this narrowly types the one member this file
 * actually calls — the same technique packages/shared/src/conventions.test.ts and
 * packages/ui/src/no-hardcoded-chrome.test.ts use for the same reason.
 */
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
  // The published AEAT text says only «admitiéndose un margen de error», with no number. The
  // 240 s figure circulating on vendor pages comes from errores.properties and practitioner
  // reports, not from the specification, and AEAT appears to serve it dynamically. Encoding it
  // would pin the code to a number nobody chose and which nobody can cite.
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
    // A default silently overriding the injected value would make these two clocks agree no
    // matter how far the monotonic source advances (a fixed default is a fixed default, whatever
    // it is). The assertion is that they DISAGREE once advanced past 1s but short of 100_000s,
    // which no single substituted constant can satisfy for both configured values at once.
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
    // Advance 2 seconds: past the strict threshold, nowhere near the lax one.
    monotonicMs += 2_000;
    expect(strict.now().confidence).toBe("degraded");
    expect(lax.now().confidence).toBe("anchored");
  });
});
