import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { runCloudWorker } from "./cloud-worker.js";
it("refreshes a real installation without a manager session, waits between ticks and stops on abort", async () => {
  const f = await installationFixture(),
    controller = new AbortController();
  let wake = () => {},
    waiting = () => {};
  let ticks = 0;
  const reached = new Promise<void>((r) => {
    waiting = r;
  });
  try {
    const worker = runCloudWorker({
      connection: f.client,
      signal: controller.signal,
      isPrimary: () => true,
      sleep: async (ms, signal) => {
        expect(ms).toBe(60000);
        ticks++;
        waiting();
        await new Promise<void>((r) => {
          wake = r;
          signal.addEventListener("abort", () => r(), { once: true });
        });
      },
    });
    await reached;
    expect((await f.client.status()).installation?.state).toBe("active");
    expect(ticks).toBe(1);
    controller.abort();
    wake();
    await worker;
    expect(f.requests.filter((v) => v[2] === "renew")).toHaveLength(1);
  } finally {
    controller.abort();
    wake();
    await f.close();
  }
});
it("a secondary does not refresh and an outage is retried on the next scheduled tick", async () => {
  const f = await installationFixture(),
    controller = new AbortController();
  let primary = false,
    ticks = 0;
  const errors: unknown[] = [];
  try {
    await runCloudWorker({
      connection: f.client,
      signal: controller.signal,
      isPrimary: () => primary,
      onError: (e) => errors.push(e),
      sleep: async () => {
        ticks++;
        if (ticks === 1) {
          expect(f.requests).toHaveLength(0);
          primary = true;
          f.offline();
        } else if (ticks === 2) {
          expect(errors).toHaveLength(1);
          f.online();
        } else controller.abort();
      },
    });
    expect((await f.client.status()).installation?.state).toBe("active");
    expect(f.requests[0]![4]).toBe(f.requests[1]![4]);
  } finally {
    controller.abort();
    await f.close();
  }
});
