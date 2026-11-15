import * as provisioning from "@waitron/provisioning";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { emergencyReply } from "../test/cloud-emergency-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
afterEach(() => {
  vi.useRealTimers();
});
it("shares display reads separately from billing and saves only entrance hints", async () => {
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
    const { emergencyHints, ...connection } = JSON.parse(await readFile(file, "utf8"));
    expect(connection).toEqual(JSON.parse(before));
    expect(emergencyHints).toMatchObject({
      address: "https://emergency.example.test/",
      open: true,
    });
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
    expect(f.client.emergencyHints("https://staff.test")).toBeNull();
    const replacement = JSON.parse(await readFile(file, "utf8"));
    replacement.view.registration.installationId = "44444444-4444-4444-8444-444444444444";
    delete replacement.lifecycle;
    await writeFile(file, JSON.stringify(replacement));
    unavailable = true;
    await expect(f.client.emergency("https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
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
      const value = emergencyReply(
        r.installationId,
        r.venueId,
        new Date(Date.now() + (mode === "older" ? -45000 : 30000)).toISOString(),
      );
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
    mode = "older";
    vi.setSystemTime(Date.now() + 60000);
    expect(await f.client.emergency("https://staff.test")).toMatchObject({
      stale: true,
      asOf: open.asOf,
    });
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
    expect(f.client.emergencyHints("https://staff.test")).toBeNull();
    expect(
      JSON.parse(await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8"))
        .emergencyHints,
    ).toBeUndefined();
  } finally {
    await f.close();
  }
});

it("A1188 saves only registration-bound entrance hints for a restart", async () => {
  const asOf = new Date().toISOString();
  const f = await installationFixture(undefined, {
    emergency: async (_v, saved, _q, res) => {
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      res.end(JSON.stringify(emergencyReply(r.installationId, r.venueId, asOf)));
    },
  });
  onTestFinished(() => f.close());
  await f.client.refresh();
  await f.client.emergency("https://staff.test");
  const saved = JSON.parse(
    await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8"),
  );
  expect(saved.emergencyHints).toEqual({
    registration: `${saved.publicKey} ${saved.view.registration.installationId}`,
    staffOrigin: "https://staff.test",
    address: "https://emergency.example.test/",
    open: true,
    asOf,
  });
});

it("A1188 warms restart hints locally and drops invalid optional hints without losing the connection", async () => {
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
  await f.client.refresh();
  await f.client.emergency("https://staff.test");
  const restarted = createCloudConnection(f.options);
  expect(restarted.emergencyHints?.("https://staff.test")).toBeNull();
  f.offline();
  await restarted.status();
  expect(restarted.emergencyHints("https://staff.test")).toEqual({
    address: "https://emergency.example.test/",
  });
  expect(restarted.emergencyHints("https://other.test")).toBeNull();
  const file = join(f.options.stateDir, "cloud/connection.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, "invalid JSON");
  expect(restarted.emergencyHints("https://staff.test")).toEqual({
    address: "https://emergency.example.test/",
  });
  await expect(restarted.status()).rejects.toMatchObject({ code: "cloud.state_invalid" });
  expect(restarted.emergencyHints("https://staff.test")).toBeNull();
  for (const invalid of [
    { ...saved.emergencyHints, registration: "another installation" },
    { ...saved.emergencyHints, open: "yes" },
    { ...saved.emergencyHints, address: "javascript:alert(1)" },
    { ...saved.emergencyHints, asOf: "tomorrow" },
    { ...saved.emergencyHints, extra: "x".repeat(17000) },
  ]) {
    await writeFile(file, JSON.stringify({ ...saved, emergencyHints: invalid }));
    await expect(restarted.status()).resolves.toMatchObject({ state: "complete" });
    expect(restarted.emergencyHints("https://staff.test")).toBeNull();
  }
});

it("A1188 retains the durable ordering watermark and does not rewrite unchanged facts", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let offset = 30000,
    open = true;
  const f = await installationFixture(undefined, {
    emergency: async (_v, saved, _q, res) => {
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      const value = emergencyReply(
        r.installationId,
        r.venueId,
        new Date(Date.now() + offset).toISOString(),
      );
      if (!open) Object.assign(value.emergency, { open: false, closedReason: "setting_off" });
      res.end(JSON.stringify(value));
    },
  });
  onTestFinished(() => f.close());
  await f.client.refresh();
  await f.client.emergency("https://staff.test");
  const file = join(f.options.stateDir, "cloud/connection.json");
  const before = await readFile(file, "utf8");
  const beforeInode = (await stat(file)).ino;
  vi.setSystemTime(Date.now() + 60000);
  await f.client.emergency("https://staff.test");
  expect(await readFile(file, "utf8")).toBe(before);
  expect((await stat(file)).ino).toBe(beforeInode);
  const restarted = createCloudConnection(f.options);
  await restarted.status();
  vi.setSystemTime(Date.now() - 60000);
  offset = -15000;
  open = false;
  await expect(restarted.emergency("https://staff.test")).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect(restarted.emergencyHints("https://staff.test")).toEqual({
    address: "https://emergency.example.test/",
  });
  expect(await readFile(file, "utf8")).toBe(before);
});

it("A1188 drops optional hints rather than making valid credentials exceed the file limit", async () => {
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
  await f.client.refresh();
  const file = join(f.options.stateDir, "cloud/connection.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.padding = "";
  saved.padding = "x".repeat(65536 - Buffer.byteLength(JSON.stringify(saved)) - 50);
  await writeFile(file, JSON.stringify(saved));
  await expect(f.client.status()).resolves.toMatchObject({ state: "complete" });
  await f.client.emergency("https://staff.test");
  const bytes = await readFile(file, "utf8");
  expect(JSON.parse(bytes).emergencyHints).toBeUndefined();
  expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(65536);
  await expect(f.client.status()).resolves.toMatchObject({ state: "complete" });
});

it("A1188 still returns live facts when the optional hint write fails", async () => {
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
  await f.client.refresh();
  const failures: unknown[] = [];
  const client = createCloudConnection({
    ...f.options,
    onEmergencyHintsError: (error) => failures.push(error),
  });
  const file = join(f.options.stateDir, "cloud/connection.json"),
    before = await readFile(file, "utf8");
  const write = vi
    .spyOn(provisioning, "writeFileDurable")
    .mockRejectedValueOnce(Object.assign(new Error("write refused"), { code: "EACCES" }));
  onTestFinished(() => write.mockRestore());
  await expect(client.emergency("https://staff.test")).resolves.toMatchObject({
    stale: false,
    emergency: { open: true },
  });
  expect(client.emergencyHints("https://staff.test")).toBeNull();
  await client.status();
  expect(client.emergencyHints("https://staff.test")).toBeNull();
  expect(await readFile(file, "utf8")).toBe(before);
  expect(failures).toMatchObject([{ code: "EACCES" }]);
  write.mockRejectedValueOnce(
    Object.assign(new Error("required write refused"), { code: "EACCES" }),
  );
  await expect(client.setRemoteAccess(false, async () => {})).rejects.toMatchObject({
    code: "EACCES",
  });
  expect(failures).toHaveLength(1);
});

it.each(["unchanged", "cancel", "revoke", "newer"] as const)(
  "A1188 pending entrance save handles %s while another Cloud turn runs",
  async (mode) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const gate = () => {
      let release = () => {};
      const promise = new Promise<void>((r) => {
        release = r;
      });
      return { promise, release };
    };
    const lock = gate(),
      locked = gate(),
      afterReply = gate(),
      next = gate(),
      nextEntered = gate();
    let replied = false,
      requests = 0;
    const f = await installationFixture(undefined, {
      emergency: async (_v, saved, _q, res) => {
        const number = ++requests;
        if (mode === "newer" && number === 2) {
          nextEntered.release();
          await next.promise;
        }
        const r = (saved.view as { registration: { installationId: string; venueId: string } })
          .registration;
        const value = emergencyReply(r.installationId, r.venueId, new Date().toISOString());
        if (mode === "newer" && number === 2)
          Object.assign(value.emergency, { open: false, closedReason: "setting_off" });
        replied = true;
        res.end(JSON.stringify(value));
      },
    });
    const tasks: Promise<unknown>[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    onTestFinished(async () => {
      lock.release();
      next.release();
      clearTimeout(timer);
      await Promise.allSettled(tasks);
      await f.close();
    });
    await f.client.refresh();
    if (mode === "unchanged") {
      await f.client.emergency("https://staff.test");
      vi.setSystemTime(Date.now() + 60000);
      replied = false;
    }
    const client = createCloudConnection({
      ...f.options,
      readVenueId: async () => {
        const id = await f.options.readVenueId();
        if (replied) afterReply.release();
        return id;
      },
    });
    await client.status();
    const authorize = async () => {
      locked.release();
      await lock.promise;
    };
    const turn =
      mode === "revoke" ? f.client.revoke(authorize) : f.client.setRemoteAccess(false, authorize);
    tasks.push(turn);
    await locked.promise;
    const controller = new AbortController(),
      read = client.emergency("https://staff.test", controller.signal);
    tasks.push(read);
    const outcome = read.then(
      () => "resolved",
      (error: { code: string }) => error.code,
    );
    await afterReply.promise;
    if (mode === "newer") {
      vi.setSystemTime(Date.now() + 60000);
      const newer = client.emergency("https://staff.test");
      tasks.push(newer);
      await nextEntered.promise;
    }
    if (mode === "cancel" || mode === "unchanged") {
      if (mode === "cancel") controller.abort();
      const deadline = new Promise<string>((r) => {
        timer = setTimeout(() => r("still waiting"), 500);
      });
      expect(await Promise.race([outcome, deadline])).toBe(
        mode === "cancel" ? "cloud.unavailable" : "resolved",
      );
    }
    lock.release();
    await turn;
    if (mode === "revoke" || mode === "newer") {
      expect(await outcome).toBe(mode === "revoke" ? "cloud.not_configured" : "resolved");
      expect(
        JSON.parse(await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8"))
          .emergencyHints,
      ).toBeUndefined();
    }
    next.release();
    await Promise.allSettled(tasks);
  },
);
