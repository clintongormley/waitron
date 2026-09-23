import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
it("persists renewal intent, resumes a lost response after restart, and keeps credentials out of status", async () => {
  const f = await installationFixture();
  try {
    f.lose();
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"));
    expect(saved.lifecycle.pending.action).toBe("renew");
    const restarted = createCloudConnection(f.options),
      status = await restarted.refresh();
    expect(status.installation?.state).toBe("active");
    expect(f.requests[0]![4]).toBe(f.requests[1]![4]);
    for (const secret of [saved.privateKey, "signature", "adapter-only", "payload"])
      expect(JSON.stringify(status)).not.toContain(secret);
    expect((await restarted.status()).installation?.leaseExpiresAt).toBeTruthy();
    await restarted.refresh();
    expect(f.requests.at(-1)![2]).toBe("configuration");
  } finally {
    await f.close();
  }
});
it("refuses cross-installation replies and preserves the last configuration on outage", async () => {
  const f = await installationFixture();
  try {
    const first = await f.client.refresh();
    f.patch({ installationId: randomUUID() });
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await f.client.status()).installation?.state).toBe("unavailable");
    expect((await f.client.status()).installation?.services).toEqual(first.installation?.services);
    f.patch({});
    await f.client.refresh();
    f.offline();
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await f.client.status()).installation?.state).toBe("unavailable");
    f.online();
    await f.client.refresh();
    f.revoke();
    expect((await f.client.refresh()).installation?.state).toBe("revoked");
    const requests = f.requests.length;
    await createCloudConnection(f.options).refresh();
    expect(f.requests).toHaveLength(requests);
  } finally {
    await f.close();
  }
});
it("revocation requires live authorization, survives a lost reply, and is never silently reversed", async () => {
  const f = await installationFixture();
  try {
    await f.client.refresh();
    await expect(
      f.client.revoke(async () => {
        throw new Error("expired");
      }),
    ).rejects.toThrow("expired");
    expect(f.requests.some((v) => v[2] === "revoke")).toBe(false);
    f.lose();
    await expect(f.client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const restarted = createCloudConnection(f.options);
    expect((await restarted.refresh()).installation?.state).toBe("revoked");
    expect(f.requests.at(-1)![4]).toBe(f.requests.at(-2)![4]);
    expect((await restarted.start(true)).installation?.state).toBe("revoked");
  } finally {
    await f.close();
  }
});
it("rejects malformed cached lifecycle state and changed lease bindings without saving authority", async () => {
  const f = await installationFixture();
  try {
    await f.client.refresh();
    const path = join(f.stateDir, "cloud-connection.json"),
      text = await readFile(path, "utf8"),
      saved = JSON.parse(text);
    for (const change of [
      { lease: { payload: "bad", signature: "bad" } },
      { pending: { action: "renew", operationId: "bad", body: "{}", lease: "" } },
      { view: { ...saved.lifecycle.view, venueId: randomUUID() } },
    ]) {
      await writeFile(
        path,
        JSON.stringify({ ...saved, lifecycle: { ...saved.lifecycle, ...change } }),
      );
      await expect(f.client.status()).rejects.toMatchObject({ code: "cloud.state_invalid" });
    }
    await writeFile(path, text);
  } finally {
    await f.close();
  }
});
it("aborts an in-flight exchange while keeping its durable intent for retry", async () => {
  const f = await installationFixture();
  let release = () => {};
  try {
    let reached = () => {};
    const started = new Promise<void>((r) => {
      reached = r;
    });
    f.delay(async () => {
      reached();
      await new Promise<void>((r) => {
        release = r;
      });
    });
    const controller = new AbortController();
    const pending = expect(f.client.refresh(controller.signal)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    await started;
    controller.abort();
    await pending;
    release();
    expect(
      JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8")).lifecycle
        .pending,
    ).toBeTruthy();
  } finally {
    release();
    await f.close();
  }
});

it("matches the literal Cloud machine vector", async () => {
  const { machinePayload } = await import("./cloud-installation.js");
  const v = JSON.parse(
    await readFile(new URL("../test/cloud-installation-vector.json", import.meta.url), "utf8"),
  );
  const c = v.claims;
  expect(
    machinePayload(
      {
        origin: c.origin,
        view: { registration: { installationId: c.installationId } },
      } as Parameters<typeof machinePayload>[0],
      { action: c.action, operationId: c.operationId, lease: c.lease, body: c.body },
      c.issuedAt,
    ).toString("base64url"),
  ).toBe(v.proof.payload);
});

it("reports use the applied revision, recover expired authority and stop after a revoked renewal", async () => {
  const f = await installationFixture();
  try {
    const observation = {
      service: "remote_access" as const,
      health: "failed" as const,
      failure: "unavailable" as const,
    };
    await f.client.report([observation]);
    expect(f.requests.map((v) => v[2])).toEqual(["renew", "report"]);
    expect(JSON.parse(String(f.requests.at(-1)![7]))).toMatchObject({
      revision: 0,
      services: [observation],
    });
    f.fail("invalid_proof");
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.fail("");
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"));
    expect(saved.lifecycle.lease).toBeUndefined();
    expect(saved.lifecycle.pending).toBeUndefined();
    f.revoke();
    expect((await f.client.report([observation])).installation?.state).toBe("revoked");
    expect(f.requests.at(-1)![2]).toBe("renew");
  } finally {
    await f.close();
  }
});

it("queues stop access behind the worker and persists it ahead of an unavailable configuration", async () => {
  const f = await installationFixture();
  let release = () => {};
  try {
    let reached = () => {};
    const entered = new Promise<void>((r) => {
      reached = r;
    });
    f.delay(async () => {
      reached();
      await new Promise<void>((r) => {
        release = r;
      });
    });
    const refresh = f.client.refresh();
    await entered;
    let authorized = false;
    const stop = f.client.revoke(async () => {
      authorized = true;
    });
    const outcome = stop.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    expect(authorized).toBe(false);
    f.delay(async () => {});
    release();
    await refresh;
    const stopped = await outcome;
    expect(stopped).toHaveProperty("value.installation.state", "revoked");
    expect(authorized).toBe(true);
  } finally {
    release();
    await f.close();
  }
  const second = await installationFixture();
  try {
    await second.client.refresh();
    second.offline();
    await expect(second.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    await expect(second.client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const pending = JSON.parse(
      await readFile(join(second.stateDir, "cloud-connection.json"), "utf8"),
    ).lifecycle.pending;
    expect(pending.action).toBe("revoke");
    second.online();
    expect((await createCloudConnection(second.options).refresh()).installation?.state).toBe(
      "revoked",
    );
  } finally {
    await second.close();
  }
});
it("cached observations distinguish fresh healthy from stale health and clear stale failure details", async () => {
  const f = await installationFixture();
  try {
    await f.client.refresh();
    const path = join(f.stateDir, "cloud-connection.json"),
      saved = JSON.parse(await readFile(path, "utf8"));
    saved.lifecycle.view.services[0].health = "healthy";
    saved.lifecycle.view.services[0].observedAt = new Date(Date.now() - 10000).toISOString();
    saved.lifecycle.view.services[1].health = "failed";
    saved.lifecycle.view.services[1].failure = "storage";
    saved.lifecycle.view.services[1].observedAt = new Date(Date.now() - 300001).toISOString();
    await writeFile(path, JSON.stringify(saved));
    const view = (await f.client.status()).installation!;
    expect(view.services[0]!.health).toBe("healthy");
    expect(view.services[1]!.health).toBe("unknown");
    expect(view.services[1]!.failure).toBeNull();
  } finally {
    await f.close();
  }
});
