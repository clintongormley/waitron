import { afterEach, describe, expect, it, vi } from "vitest";
import { readHourRelease } from "./hour-release.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});
describe("source builds without an embedded release stamp", () => {
  it("cannot derive a floor from a runtime date or mutable build environment", () => {
    vi.stubEnv("WAITRON_BUILD_ID", "0123456789012345678901234567890123456789");
    vi.stubEnv("WAITRON_IMAGE_CREATED", "2020-01-01T00:00:00.000Z");
    vi.stubEnv("WAITRON_HOUR_RELEASE", '{"instantMs":0}');
    vi.useFakeTimers({ now: new Date("2030-01-01T00:00:00Z") });
    expect(readHourRelease()).toBeNull();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    expect(readHourRelease()).toBeNull();
  });
});

const stamp = {
  sourceCommit: "0123456789012345678901234567890123456789",
  committedAt: "2026-10-15T11:00:00.000Z",
  instantMs: 1792062000000,
  generator: "scripts/generate-hour-release.mjs:v1",
  generatorSha256: "a".repeat(64),
};
describe("the embedded source stamp", () => {
  it("is snapshotted and frozen at module load", async () => {
    const input = { ...stamp };
    vi.stubGlobal("__WAITRON_HOUR_RELEASE__", input);
    const { readHourRelease } = await import("./hour-release.js");
    expect(readHourRelease()).toEqual(stamp);
    input.instantMs = 0;
    vi.stubGlobal("__WAITRON_HOUR_RELEASE__", null);
    vi.stubEnv("WAITRON_BUILD_ID", "old");
    vi.useFakeTimers({ now: 0 });
    expect(readHourRelease()).toEqual(stamp);
    expect(Object.isFrozen(readHourRelease())).toBe(true);
  });

  it.each([
    null,
    false,
    "stamp",
    { ...stamp, sourceCommit: 1 },
    { ...stamp, sourceCommit: "a" },
    { ...stamp, instantMs: 1.5 },
    { ...stamp, instantMs: 9_000_000_000_000_000 },
    { ...stamp, committedAt: "2020-01-01T00:00:00.000Z" },
    { ...stamp, generator: "other" },
    { ...stamp, generatorSha256: 1 },
    { ...stamp, generatorSha256: "z".repeat(64) },
  ])("an absent or malformed embedded floor cannot grant admission: %j", async (input) => {
    vi.stubGlobal("__WAITRON_HOUR_RELEASE__", input);
    const { readHourRelease } = await import("./hour-release.js");
    expect(readHourRelease()).toBeNull();
  });
});
