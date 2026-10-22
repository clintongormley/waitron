import { describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ parallelism: 18, load: 10, freeGiB: 16 }));
vi.mock("node:os", () => ({
  availableParallelism: () => host.parallelism,
  loadavg: () => [host.load, 0, 0],
  freemem: () => host.freeGiB * 1024 ** 3,
}));

describe("root guard workers share the host with child processes and other work", () => {
  it.each([
    ["CPU work already running", 18, 10, 16, 4],
    ["an idle host", 18, 0, 16, 9],
    ["fractional processor headroom", 18, 9.2, 16, 4],
    ["more runnable work than processors", 18, 24, 16, 1],
    ["less than one worker's memory allowance", 18, 0, 0.75, 1],
    ["memory limits a large host", 64, 0, 2.5, 2],
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
