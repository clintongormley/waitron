import { expect, it } from "vitest";
import { runCloudSnapshotLoop } from "./cloud-snapshot-loop.js";
it("backs off failures, resets after recovery, and keeps shutdown out of outage reporting", async () => {
  const c = new AbortController(),
    delays: number[] = [],
    errors: unknown[] = [];
  let ticks = 0;
  await runCloudSnapshotLoop({
    signal: c.signal,
    worker: {
      async tick() {
        ticks++;
        if (ticks <= 2) throw Error("offline");
        if (ticks === 4) {
          c.abort();
          throw Error("aborted");
        }
      },
    },
    onError: (e) => errors.push(e),
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  expect(ticks).toBe(4);
  expect(delays).toEqual([60000, 120000, 60000]);
  expect(errors).toHaveLength(2);
});
it("stops an idle loop promptly on abort and caps repeated-failure delay", async () => {
  const c = new AbortController(),
    delays: number[] = [];
  let ticks = 0;
  await runCloudSnapshotLoop({
    signal: c.signal,
    worker: {
      async tick() {
        ticks++;
        throw Error("offline");
      },
    },
    onError: () => {},
    sleep: async (ms) => {
      delays.push(ms);
      if (ticks === 7) {
        c.abort();
        throw Error("abort");
      }
    },
  });
  expect(delays).toEqual([60000, 120000, 240000, 480000, 900000, 900000, 900000]);
});
it("cancels the real idle wait and propagates a broken wait without labelling it a capture failure", async () => {
  const controller = new AbortController();
  let reached!: () => void;
  const ticked = new Promise<void>((r) => {
    reached = r;
  });
  const running = runCloudSnapshotLoop({
    signal: controller.signal,
    worker: {
      async tick() {
        reached();
      },
    },
    onError: () => {
      throw Error("unexpected outage");
    },
  });
  await ticked;
  await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  await running;
  await expect(
    runCloudSnapshotLoop({
      signal: new AbortController().signal,
      worker: { async tick() {} },
      onError: () => {},
      sleep: async () => {
        throw Error("broken wait");
      },
    }),
  ).rejects.toThrow("broken wait");
});
it("does not sleep after a successful tick that shuts down", async () => {
  const c = new AbortController();
  await runCloudSnapshotLoop({
    signal: c.signal,
    worker: {
      async tick() {
        c.abort();
      },
    },
    onError: () => {
      throw Error("unexpected");
    },
    sleep: async () => {
      throw Error("must not wait");
    },
  });
});
