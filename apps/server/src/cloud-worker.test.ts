import { expect, it, onTestFinished } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { runCloudConnectionForTest } from "./testing/cloud-connection-job.js";
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
    const worker = runCloudConnectionForTest({
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
    await runCloudConnectionForTest({
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

it.each(["guest", "certificate"] as const)(
  "tries both Cloud services even when %s fails",
  async (failed) => {
    const f = await installationFixture();
    onTestFinished(() => f.close());
    const controller = new AbortController();
    const failure = new Error("service unavailable");
    const seen: string[] = [],
      guestErrors: unknown[] = [],
      refreshErrors: unknown[] = [];
    await runCloudConnectionForTest({
      connection: {
        ...f.client,
        staffCertificate: async () => {
          if (failed === "certificate") throw failure;
          return true;
        },
      },
      signal: controller.signal,
      isPrimary: () => true,
      staffHostname: "staff.example.test",
      onGuestMenu: async () => {
        seen.push("guest");
        if (failed === "guest") throw failure;
      },
      onGuestMenuError: (error) => guestErrors.push(error),
      onStaffCertificate: () => seen.push("staff ready"),
      onError: (error) => refreshErrors.push(error),
      sleep: async () => controller.abort(),
    });
    expect(seen).toEqual(failed === "guest" ? ["guest", "staff ready"] : ["guest"]);
    expect(guestErrors).toEqual(failed === "guest" ? [failure] : []);
    expect(refreshErrors).toEqual(failed === "certificate" ? [failure] : []);
    expect((await f.client.status()).installation?.state).toBe("active");
  },
);

it("skips guest delivery when the box steps down during connection refresh", async () => {
  const f = await installationFixture();
  onTestFinished(() => f.close());
  const controller = new AbortController();
  let primary = true,
    deliveries = 0;
  f.delay(async () => {
    primary = false;
  });
  await runCloudConnectionForTest({
    connection: f.client,
    signal: controller.signal,
    isPrimary: () => primary,
    onGuestMenu: async () => {
      deliveries++;
    },
    sleep: async () => controller.abort(),
  });
  expect(deliveries).toBe(0);
});
