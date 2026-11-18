import { expect, it, onTestFinished } from "vitest";
import { emergencyReply } from "../test/cloud-emergency-fixture.js";
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
  const f = await installationFixture(undefined, {
    emergency: async (_v, saved, _q, res) => {
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      res.end(
        JSON.stringify(emergencyReply(r.installationId, r.venueId, new Date().toISOString())),
      );
    },
  });
  onTestFinished(() => f.close());
  const controller = new AbortController();
  let primary = true,
    deliveries = 0;
  f.delay(async () => {
    primary = false;
  });
  await runCloudConnectionForTest({
    connection: f.client,
    managementOrigin: "https://staff.test",
    signal: controller.signal,
    isPrimary: () => primary,
    onGuestMenu: async () => {
      deliveries++;
    },
    sleep: async () => controller.abort(),
  });
  expect(deliveries).toBe(0);
  expect(f.requests.filter((v) => v[2] === "emergency-hosting-display")).toHaveLength(0);
});

it.each([true, false])(
  "A1188 refreshes entrance hints without stopping other services (ready=%s)",
  async (ready) => {
    const f = await installationFixture(undefined, {
      emergency: async (_v, saved, _q, res) => {
        const r = (saved.view as { registration: { installationId: string; venueId: string } })
          .registration;
        res.writeHead(ready ? 200 : 503);
        res.end(
          JSON.stringify(
            ready
              ? emergencyReply(r.installationId, r.venueId, new Date().toISOString())
              : { error: "temporarily_unavailable" },
          ),
        );
      },
    });
    onTestFinished(() => f.close());
    const controller = new AbortController(),
      seen: string[] = [],
      errors: unknown[] = [];
    await runCloudConnectionForTest({
      connection: { ...f.client, staffCertificate: async () => true },
      managementOrigin: "https://staff.test",
      signal: controller.signal,
      isPrimary: () => true,
      onGuestMenu: () => seen.push("guest"),
      onStaffCertificate: () => seen.push("staff"),
      onError: (error) => {
        throw error;
      },
      onEmergencyError: (error, level) => errors.push({ error, level }),
      sleep: async () => controller.abort(),
    });
    expect(f.requests.filter((v) => v[2] === "emergency-hosting-display")).toHaveLength(1);
    expect(f.client.emergencyHints("https://staff.test")).toEqual(
      ready ? { address: "https://emergency.example.test/" } : null,
    );
    expect(seen).toEqual(["guest", "staff"]);
    if (ready) expect(errors).toEqual([]);
    else expect(errors).toMatchObject([{ error: { code: "cloud.unavailable" }, level: "info" }]);
  },
);
