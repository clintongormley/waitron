import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cloudFixture as fixture } from "../test/cloud-fixture.js";
import { createCloudConnection, loadCloudOrigin } from "./cloud-client.js";
it("requires a pinned secure Cloud origin except explicit loopback development", () => {
  expect(loadCloudOrigin({})).toBeUndefined();
  expect(loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: "" })).toBeUndefined();
  expect(loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: "https://cloud.waitron.test" })).toBe(
    "https://cloud.waitron.test",
  );
  expect(
    loadCloudOrigin({ WAITRON_ENV: "dev", WAITRON_CLOUD_ORIGIN: "http://127.0.0.1:8000" }),
  ).toBe("http://127.0.0.1:8000");
  for (const origin of [
    "http://cloud.example",
    "https://cloud.example/path",
    "https://user:secret@cloud.example",
    "https://cloud.example/",
    "https://cloud.example#fragment",
  ])
    expect(() => loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: origin })).toThrow();
  expect(() =>
    loadCloudOrigin({ WAITRON_ENV: "production", WAITRON_CLOUD_ORIGIN: "http://127.0.0.1:8000" }),
  ).toThrow();
});
it("persists before sending, resumes a failed start after restart and never exposes the private key", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    expect((await client.status()).state).toBe("not_connected");
    f.reject();
    await expect(client.start()).rejects.toMatchObject({ code: "cloud.unavailable" });
    const before = await readFile(join(f.stateDir, "cloud-connection.json"), "utf8");
    expect((await stat(join(f.stateDir, "cloud-connection.json"))).mode & 0o777).toBe(0o600);
    f.accept();
    const resumed = createCloudConnection(f.options);
    const status = await resumed.start();
    expect(f.requests[0]!.slice(3, 10)).toEqual(f.requests[1]!.slice(3, 10));
    expect(status.state).toBe("awaiting_cloud");
    expect(status.localVenueId).toBe(f.options.localVenueId);
    expect(status.environment).toBe("test");
    expect(JSON.stringify(status)).not.toContain(JSON.parse(before).privateKey);
    expect(status.openCloudUrl).toContain("/connect#request=");
    expect(status.openCloudUrl).not.toContain(status.code);
  } finally {
    await f.close();
  }
});
it("requires explicit bound local confirmation and checks authority again after the Cloud read", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    f.approve();
    const approved = await client.check();
    expect(approved.state).toBe("awaiting_local");
    expect(f.requests.some((v) => v[2] === "complete")).toBe(false);
    const choice = {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    };
    await expect(
      client.complete({ ...choice, legalBusinessId: randomUUID() }, async () => {}),
    ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    await expect(
      client.complete(choice, async () => {
        throw new Error("authority lost");
      }),
    ).rejects.toThrow("authority lost");
    expect(f.requests.some((v) => v[2] === "complete")).toBe(false);
    const complete = await client.complete(choice, async () => {});
    expect(complete.state).toBe("complete");
    expect(complete.registration?.installationId).toBe(f.installationId);
    const restarted = createCloudConnection(f.options);
    expect((await restarted.check()).registration).toEqual(complete.registration);
  } finally {
    await f.close();
  }
});
it("rejects changed binding, malformed state, and mismatched replies without overwriting the recorded state", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    const before = await readFile(join(f.stateDir, "cloud-connection.json"), "utf8");
    await expect(
      createCloudConnection({ ...f.options, localVenueId: randomUUID() }).status(),
    ).rejects.toMatchObject({ code: "cloud.state_invalid" });
    f.bad();
    await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8")).toBe(before);
    await writeFile(join(f.stateDir, "cloud-connection.json"), "broken");
    await expect(client.start()).rejects.toMatchObject({ code: "cloud.state_invalid" });
  } finally {
    await f.close();
  }
});

it("recovers a committed completion with a lost reply and refuses overlapping local operations", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    f.approve();
    const approved = await client.check();
    f.loseCompletion();
    const choice = {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    };
    await expect(client.complete(choice, async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    f.onStatus(() => {
      entered();
      return new Promise<void>((r) => {
        release = r;
      });
    });
    const restarted = createCloudConnection(f.options);
    const checking = restarted.check();
    await waiting;
    await expect(client.start()).rejects.toMatchObject({ code: "cloud.busy" });
    release();
    expect((await checking).registration?.installationId).toBe(f.installationId);
  } finally {
    await f.close();
  }
});
it("rejects oversized replies and redirects", async () => {
  for (const kind of ["oversized", "redirect"] as const) {
    const f = await fixture();
    try {
      const client = createCloudConnection(f.options);
      await client.start();
      f[kind]();
      await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(f.requests).toHaveLength(2);
    } finally {
      await f.close();
    }
  }
});
it("starts again only after Cloud refuses the old request, retaining the installation key", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    const first = await client.start();
    await expect(client.start(true)).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    f.unavailable();
    await expect(client.start(true)).rejects.toMatchObject({ code: "cloud.request_unavailable" });
    f.available();
    const next = await client.start();
    expect(next.requestId).not.toBe(first.requestId);
    expect(f.requests[0]![4]).toBe(f.requests.at(-1)![4]);
    expect(next.code).toMatch(/^\d{8}$/);
  } finally {
    await f.close();
  }
});
