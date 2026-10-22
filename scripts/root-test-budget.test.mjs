import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ parallelism: 18, load: 10, freeGiB: 16 }));
vi.mock("node:os", () => ({
  availableParallelism: () => host.parallelism,
  loadavg: () => [host.load, 0, 0],
  freemem: () => host.freeGiB * 1024 ** 3,
}));

beforeEach(() => vi.stubEnv("CI", ""));
afterEach(() => vi.unstubAllEnvs());

describe("root guard workers share the host with child processes and other work", () => {
  it.each([
    ["CPU work already running", 18, 10, 16, 2],
    ["an idle host", 18, 0, 16, 4],
    ["fractional processor headroom", 18, 9.2, 16, 2],
    ["more runnable work than processors", 18, 24, 16, 1],
    ["less than one worker's memory allowance", 18, 0, 0.75, 1],
    ["memory limits a large host", 64, 0, 2.5, 2],
    ["memory just below four GiB", 18, 0, 3.95, 3],
    ["a two-processor runner", 2, 0, 16, 1],
  ])(
    "uses a whole positive worker budget with %s",
    async (_name, parallelism, load, freeGiB, want) => {
      Object.assign(host, { parallelism, load, freeGiB });
      vi.resetModules();
      const { default: config } = await import("../vitest.config.ts");
      expect(config.test.maxWorkers).toBe(want);
    },
  );
});

describe("CI keeps Vitest's existing processor-based worker default", () => {
  it.each(["true", "1"])("does not apply the local allowance when CI=%s", async (value) => {
    Object.assign(host, { parallelism: 4, load: 0.01, freeGiB: 15 });
    vi.stubEnv("CI", value);
    vi.resetModules();
    const { default: config } = await import("../vitest.config.ts");
    expect(config.test.maxWorkers).toBeUndefined();
  });
});
