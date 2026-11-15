import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { emergencyReply } from "../test/cloud-emergency-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
afterEach(() => vi.useRealTimers());
it("shares display reads separately from billing and keeps dated facts only in memory", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let reads = 0,
    unavailable = false,
    open = true;
  const f = await installationFixture(undefined, {
    emergency: async (_v, saved, _q, res) => {
      reads++;
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      const value = emergencyReply(r.installationId, r.venueId, new Date().toISOString());
      if (!open) Object.assign(value.emergency, { open: false, closedReason: "setting_off" });
      res.writeHead(unavailable ? 503 : 200);
      res.end(JSON.stringify(unavailable ? { error: "temporarily_unavailable" } : value));
    },
  });
  try {
    await f.client.refresh();
    const file = join(f.options.stateDir, "cloud/connection.json"),
      before = await readFile(file, "utf8");
    const a = await Promise.all([
      f.client.emergency("https://staff.test"),
      f.client.emergency("https://staff.test"),
    ]);
    expect(a[0]).toEqual(a[1]);
    expect(a[0]).toMatchObject({ stale: false, emergency: { open: true } });
    expect(reads).toBe(1);
    expect(await readFile(file, "utf8")).toBe(before);
    unavailable = true;
    vi.setSystemTime(Date.now() + 60000);
    expect(await f.client.emergency("https://staff.test")).toMatchObject({
      stale: true,
      asOf: a[0]!.asOf,
    });
    const restarted = createCloudConnection(f.options);
    await expect(restarted.emergency("https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    unavailable = false;
    open = false;
    vi.setSystemTime(Date.now() + 60000);
    expect(await f.client.emergency("https://staff.test")).toMatchObject({
      stale: false,
      emergency: { open: false, closedReason: "setting_off" },
    });
  } finally {
    await f.close();
  }
});
it("one caller leaving does not cancel the read, refresh stays available and changed registration receives no old facts", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const f = await installationFixture(undefined, {
    emergency: async (_v, saved, _q, res) => {
      entered();
      await wait;
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      res.end(
        JSON.stringify(emergencyReply(r.installationId, r.venueId, new Date().toISOString())),
      );
    },
  });
  try {
    await f.client.refresh();
    const controller = new AbortController();
    const first = f.client.emergency("https://staff.test", controller.signal);
    const refused = expect(first).rejects.toMatchObject({ code: "cloud.unavailable" });
    await started;
    const second = f.client.emergency("https://staff.test");
    controller.abort();
    await refused;
    await expect(f.client.refresh()).resolves.toMatchObject({ state: "complete" });
    const file = join(f.options.stateDir, "cloud/connection.json"),
      state = JSON.parse(await readFile(file, "utf8"));
    state.view.registration.installationId = "44444444-4444-4444-8444-444444444444";
    delete state.lifecycle;
    await writeFile(file, JSON.stringify(state));
    const fenced = expect(second).rejects.toMatchObject({ code: "cloud.unavailable" });
    release();
    await fenced;
    expect(JSON.parse(await readFile(file, "utf8")).view.registration.installationId).toBe(
      state.view.registration.installationId,
    );
  } finally {
    release();
    await f.close();
  }
});

it("respects display Retry-After, retains dated hints for unknown state and drops them on revocation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let reads = 0,
    mode = "limited";
  const f = await installationFixture(undefined, {
    emergency: async (_v, saved, _q, res) => {
      reads++;
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      const value = emergencyReply(r.installationId, r.venueId, new Date().toISOString());
      if (mode === "limited") {
        res.writeHead(429, { "retry-after": "120" });
        res.end('{"error":"rate_limited"}');
      } else if (mode === "revoked") {
        res.writeHead(403);
        res.end('{"error":"revoked"}');
      } else {
        res.end(
          JSON.stringify(
            mode === "unknown"
              ? { ...value, emergency: { status: "unavailable", reason: "state_not_ready" } }
              : value,
          ),
        );
      }
    },
  });
  try {
    await f.client.refresh();
    await expect(f.client.emergency("https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    vi.setSystemTime(Date.now() + 119000);
    await expect(f.client.emergency("https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    expect(reads).toBe(1);
    mode = "ready";
    vi.setSystemTime(Date.now() + 1000);
    const open = await f.client.emergency("https://staff.test");
    expect(open.stale).toBe(false);
    expect(reads).toBe(2);
    mode = "unknown";
    vi.setSystemTime(Date.now() + 60000);
    expect(await f.client.emergency("https://staff.test")).toMatchObject({
      stale: true,
      asOf: open.asOf,
      emergency: { open: true },
    });
    mode = "revoked";
    vi.setSystemTime(Date.now() + 60000);
    await expect(f.client.emergency("https://staff.test")).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect((await f.client.status()).installation?.state).toBe("revoked");
  } finally {
    await f.close();
  }
});
