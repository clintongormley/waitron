import { createPublicKey, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createCloudConnection } from "./cloud-client.js";
import { createCloudReplacement } from "./cloud-replacement.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";

const origin = "https://cloud.example";
const localVenueId = randomUUID(),
  nodeId = randomUUID(),
  pointId = randomUUID();
const registration = {
  venueId: randomUUID(),
  installationId: randomUUID(),
  organisationId: randomUUID(),
  legalBusinessId: randomUUID(),
};
const dirs: string[] = [];
const clouds: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(clouds.splice(0).map((cloud) => cloud?.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(
  phase: "staged" | "restored" | "reported" = "reported",
  cloud?: { stateDir: string; origin: string },
) {
  const cloudOrigin = cloud?.origin ?? origin;
  const stateDir = cloud?.stateDir ?? (await mkdtemp(join(tmpdir(), "waitron-replacement-")));
  if (!cloud) dirs.push(stateDir);
  const key = generateKeyPairSync("ed25519");
  const privateKey = key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
  const publicKey = key.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const requestId = randomUUID();
  const oldInstallationId = randomUUID();
  await writeFile(
    join(stateDir, "cloud-recovery.json"),
    JSON.stringify({
      version: 1,
      origin: cloudOrigin,
      environment: "preproduction",
      requestId,
      publicKey,
      privateKey,
      code: "12345678",
      pointId,
      phase,
    }),
    { mode: 0o600 },
  );
  const requests: { action: string; body: Record<string, string>; payload: unknown[] }[] = [];
  let mode: "awaiting_owner" | "complete" | "lost" | "wrong" | "refused" = "awaiting_owner";
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const action = new URL(url).pathname.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    const payload = JSON.parse(Buffer.from(body.payload, "base64url").toString()) as unknown[];
    requests.push({ action, body, payload });
    if (mode === "lost") throw Error("lost reply");
    if (mode === "refused")
      return Response.json({ error: "replacement_unavailable" }, { status: 409 });
    if (action === "info")
      return Response.json({
        point: {
          id: pointId,
          venueId: registration.venueId,
          kind: "snapshot",
          objectKey: `snapshots/${pointId}`,
          digest: "a".repeat(64),
          size: 1,
          capturedAt: new Date().toISOString(),
          modules: {},
          verification: "verified",
          deleting: false,
          deletedAt: null,
        },
      });
    if (action === "restored") return Response.json({ status: "restored" });
    return Response.json({
      requestId,
      pointId,
      venueId: registration.venueId,
      oldInstallationId,
      localVenueId: mode === "wrong" ? randomUUID() : localVenueId,
      nodeId,
      environment: "test",
      publicKey: payload[7],
      peerPublicKey: payload[8],
      state: mode === "complete" ? "complete" : "awaiting_owner",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      organisationName: "Test Org",
      legalBusinessName: "Test Business",
      registration: mode === "complete" ? registration : null,
    });
  });
  const options = {
    stateDir,
    origin: cloudOrigin,
    localVenueId,
    nodeId,
    fetch: fetchImpl as typeof fetch,
  };
  const connection = createCloudConnection({
    stateDir,
    origin: cloudOrigin,
    localVenueId,
    environment: "test",
  });
  return {
    stateDir,
    origin: cloudOrigin,
    options,
    requests,
    connection,
    setMode: (value: typeof mode) => {
      mode = value;
    },
    privateKey,
    publicKey,
    requestId,
  };
}

it("persists new keys before sending dual signatures and reuses them after a lost reply", async () => {
  const f = await fixture();
  f.setMode("lost");
  await expect(
    createCloudReplacement({ ...f.options, connection: f.connection }).prepare(),
  ).rejects.toMatchObject({ code: "cloud.unavailable" });
  const saved = JSON.parse(await readFile(join(f.stateDir, "cloud-replacement.json"), "utf8"));
  expect((await stat(join(f.stateDir, "cloud-replacement.json"))).mode & 0o777).toBe(0o600);
  expect(saved.privateKey).toBeTruthy();
  expect(saved.peerPrivateKey).toBeTruthy();
  expect(saved.publicKey).not.toBe(f.publicKey);
  f.setMode("awaiting_owner");
  const view = await createCloudReplacement({ ...f.options, connection: f.connection }).prepare();
  expect(view.state).toBe("awaiting_owner");
  expect(JSON.stringify(view)).not.toContain(saved.privateKey);
  expect(view.requestId).toBe(f.requestId);
  const sent = f.requests.at(-1)!;
  expect(sent.payload).toEqual([
    "waitron-cloud-replacement-v1",
    origin,
    f.requestId,
    "prepare",
    localVenueId,
    nodeId,
    "test",
    saved.publicKey,
    saved.peerPublicKey,
    expect.any(Number),
  ]);
  const bytes = Buffer.from(sent.body.payload, "base64url");
  for (const [key, signature] of [
    [f.publicKey, sent.body.signature],
    [saved.publicKey, sent.body.keySignature],
  ])
    expect(
      verify(
        null,
        bytes,
        createPublicKey({ key: Buffer.from(key!, "base64url"), format: "der", type: "spki" }),
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
});

it("refuses a saved replacement file made group-readable after creation", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  const path = join(f.stateDir, "cloud-replacement.json");
  await chmod(path, 0o640);
  expect((await stat(path)).mode & 0o777).toBe(0o640);
  await expect(client.status()).rejects.toMatchObject({
    code: "cloud.replacement_state_invalid",
  });
});

it("reports a Cloud refusal separately from a transport outage", async () => {
  const f = await fixture();
  f.setMode("refused");
  await expect(
    createCloudReplacement({ ...f.options, connection: f.connection }).prepare(),
  ).rejects.toMatchObject({ code: "cloud.replacement_refused" });
});

it("reports a completed local restore to Cloud before replacement prepare", async () => {
  const f = await fixture("restored");
  const view = await createCloudReplacement({ ...f.options, connection: f.connection }).prepare();
  expect(view.state).toBe("awaiting_owner");
  expect(f.requests.map((request) => request.action)).toEqual(["info", "restored", "prepare"]);
  const state = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
  expect(state.phase).toBe("reported");
});

it("refuses an unrestored recovery and imports an exact completion idempotently", async () => {
  const f = await fixture("staged");
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await expect(client.prepare()).rejects.toMatchObject({ code: "cloud.replacement_not_restored" });
  expect(f.requests).toHaveLength(0);
  const recovery = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
  recovery.phase = "reported";
  await writeFile(join(f.stateDir, "cloud-recovery.json"), JSON.stringify(recovery), {
    mode: 0o600,
  });
  await client.prepare();
  f.setMode("wrong");
  await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
  expect((await f.connection.status()).state).toBe("not_connected");
  f.setMode("complete");
  expect((await client.check()).registration).toEqual(registration);
  expect((await f.connection.status()).registration).toEqual(registration);
  expect(
    (await createCloudReplacement({ ...f.options, connection: f.connection }).check()).registration,
  ).toEqual(registration);
});

it("does not propose replacement over an unrelated saved Cloud connection", async () => {
  const f = await fixture();
  const key = generateKeyPairSync("ed25519");
  await writeFile(
    join(f.stateDir, "cloud-connection.json"),
    JSON.stringify({
      version: 1,
      origin,
      localVenueId,
      environment: "test",
      requestId: randomUUID(),
      code: "12345678",
      privateKey: key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      publicKey: key.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    }),
    { mode: 0o600 },
  );
  const before = f.requests.length;
  await expect(
    createCloudReplacement({ ...f.options, connection: f.connection }).prepare(),
  ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
  expect(f.requests).toHaveLength(before);
});

it("restarts an interrupted registration import without changing the proposed keys", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  const before = await readFile(join(f.stateDir, "cloud-replacement.json"), "utf8");
  f.setMode("complete");
  const originalImport = f.connection.importReplacement.bind(f.connection);
  f.connection.importReplacement = vi.fn(async () => {
    throw Error("disk write interrupted");
  });
  await expect(client.check()).rejects.toThrow("disk write interrupted");
  expect((await f.connection.status()).state).toBe("not_connected");
  const saved = JSON.parse(await readFile(join(f.stateDir, "cloud-replacement.json"), "utf8"));
  expect(saved.privateKey).toBe(JSON.parse(before).privateKey);
  expect(saved.view.registration).toEqual(registration);
  f.connection.importReplacement = originalImport;
  await createCloudReplacement({ ...f.options, connection: f.connection }).resume();
  expect((await f.connection.status()).registration).toEqual(registration);
});

it("does not import a completed reply after local authority is lost during the wait", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  f.setMode("complete");
  await expect(
    client.check(async () => {
      throw Error("manager lost permission");
    }),
  ).rejects.toThrow("manager lost permission");
  expect((await f.connection.status()).state).toBe("not_connected");
  expect((await client.status())?.state).toBe("awaiting_owner");
  expect((await client.check()).registration).toEqual(registration);
});

it("retrieves owner confirmation after a lost status reply with the saved proposal", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  const before = JSON.parse(await readFile(join(f.stateDir, "cloud-replacement.json"), "utf8"));
  f.setMode("lost");
  await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
  f.setMode("complete");
  expect(
    (await createCloudReplacement({ ...f.options, connection: f.connection }).check()).registration,
  ).toEqual(registration);
  const after = JSON.parse(await readFile(join(f.stateDir, "cloud-replacement.json"), "utf8"));
  expect(after.privateKey).toBe(before.privateKey);
  expect(after.peerPrivateKey).toBe(before.peerPrivateKey);
});

it("offers only the original public approval code and Cloud link after restart", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  const approval = await createCloudReplacement({
    ...f.options,
    connection: f.connection,
  }).approval();
  expect(approval).toEqual({
    requestId: f.requestId,
    code: "12345678",
    openCloudUrl: `${origin}/recover#request=${f.requestId}`,
  });
  expect(JSON.stringify(approval)).not.toContain(f.privateKey);
});

it("imports a durable completion on boot after the recovery request file is removed", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  f.setMode("complete");
  const originalImport = f.connection.importReplacement.bind(f.connection);
  f.connection.importReplacement = vi.fn(async () => {
    throw Error("disk write interrupted");
  });
  await expect(client.check()).rejects.toThrow("disk write interrupted");
  await rm(join(f.stateDir, "cloud-recovery.json"));
  f.connection.importReplacement = originalImport;
  await createCloudReplacement({ ...f.options, connection: f.connection }).resume();
  expect((await f.connection.status()).registration).toEqual(registration);
});

async function connectedReplacement() {
  const cloud = await installationFixture();
  clouds.push(cloud);
  await rm(join(cloud.stateDir, "cloud-connection.json"));
  const f = await fixture("reported", { stateDir: cloud.stateDir, origin: cloud.options.origin });
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  await client.prepare();
  f.setMode("complete");
  await client.check();
  cloud.requests.length = 0;
  const restart = () => {
    const connection = createCloudConnection({
      stateDir: f.stateDir,
      origin: f.origin,
      localVenueId,
      environment: "test",
    });
    return { connection, replacement: createCloudReplacement({ ...f.options, connection }) };
  };
  const saved = async (name: "cloud-connection.json" | "cloud-replacement.json") =>
    JSON.parse(await readFile(join(f.stateDir, name), "utf8"));
  return { f, cloud, client, restart, saved, sent: () => cloud.requests.map((v) => v[2]) };
}

for (const heard of [false, true])
  it(`sends a stop again, never a renewal, after the connection file is deleted (Cloud ${heard ? "heard" : "had not heard"} the stop)`, async () => {
    const { f, cloud, client, restart, sent } = await connectedReplacement();
    if (!heard) cloud.offline();
    const stopping = f.connection.revoke(() => client.recordStop());
    if (heard) await stopping;
    else await expect(stopping).rejects.toMatchObject({ code: "cloud.unavailable" });
    await rm(join(f.stateDir, "cloud-connection.json"));
    const { connection, replacement } = restart();
    await replacement.resume();
    cloud.online();
    cloud.requests.length = 0;
    await connection.refresh();
    expect(sent()).toEqual(["revoke"]);
    expect((await connection.status()).installation?.state).toBe("revoked");
    expect((await connection.status()).registration).toEqual(registration);
  });

for (const waiting of [undefined, "renew"] as const)
  it(`sends the stop when the process died after recording it but before saving the stop request${waiting ? `, replacing a waiting ${waiting}` : ""}`, async () => {
    const { f, cloud, client, restart, saved, sent } = await connectedReplacement();
    if (waiting) {
      cloud.offline();
      await expect(f.connection.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
      cloud.online();
    }
    await expect(
      f.connection.revoke(async () => {
        await client.recordStop();
        throw Error("process died");
      }),
    ).rejects.toThrow("process died");
    expect((await saved("cloud-replacement.json")).stopped).toBe(true);
    expect((await saved("cloud-connection.json")).lifecycle?.pending?.action).toBe(waiting);
    const { connection, replacement } = restart();
    await replacement.resume();
    cloud.requests.length = 0;
    await connection.refresh();
    expect(sent()).toEqual(["revoke"]);
    expect((await connection.status()).installation?.state).toBe("revoked");
  });

it("keeps a stop request already waiting, with its operation id, when the replacement is re-imported", async () => {
  const { f, cloud, client, restart, saved } = await connectedReplacement();
  cloud.offline();
  await expect(f.connection.revoke(() => client.recordStop())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect((await saved("cloud-replacement.json")).stopped).toBe(true);
  const waiting = (await saved("cloud-connection.json")).lifecycle.pending;
  expect(waiting.action).toBe("revoke");
  const { connection, replacement } = restart();
  await replacement.resume();
  expect((await saved("cloud-connection.json")).lifecycle.pending).toEqual(waiting);
  cloud.online();
  cloud.requests.length = 0;
  await connection.refresh();
  expect(cloud.requests.map((v) => [v[2], v[4]])).toEqual([["revoke", waiting.operationId]]);
  expect((await connection.status()).installation?.state).toBe("revoked");
});

it("leaves a connection Cloud has already revoked unchanged when the replacement is re-imported", async () => {
  const { f, cloud, client, restart, saved } = await connectedReplacement();
  await f.connection.revoke(() => client.recordStop());
  expect((await saved("cloud-replacement.json")).stopped).toBe(true);
  const path = join(f.stateDir, "cloud-connection.json");
  const before = await readFile(path, "utf8");
  const { connection, replacement } = restart();
  await replacement.resume();
  expect(await readFile(path, "utf8")).toBe(before);
  cloud.requests.length = 0;
  await connection.refresh();
  expect(cloud.requests).toEqual([]);
  expect((await connection.status()).installation?.state).toBe("revoked");
});

it("carries the stop when Check reconnection re-imports after the connection file is deleted", async () => {
  const { f, cloud, client, restart, sent } = await connectedReplacement();
  cloud.offline();
  await expect(f.connection.revoke(() => client.recordStop())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  await rm(join(f.stateDir, "cloud-connection.json"));
  const { connection, replacement } = restart();
  expect((await replacement.check()).registration).toEqual(registration);
  cloud.online();
  cloud.requests.length = 0;
  await connection.refresh();
  expect(sent()).toEqual(["revoke"]);
  expect((await connection.status()).installation?.state).toBe("revoked");
});

it("resumes a replacement that was never stopped after the connection file is deleted", async () => {
  const { f, restart, sent } = await connectedReplacement();
  await rm(join(f.stateDir, "cloud-connection.json"));
  const { connection, replacement } = restart();
  await replacement.resume();
  expect((await connection.status()).registration).toEqual(registration);
  await connection.refresh();
  expect(sent()).toEqual(["renew"]);
  expect((await connection.status()).installation?.state).toBe("active");
});

it("refuses Stop access with cloud.busy while a Check reconnection is in flight, and a retry afterwards stops", async () => {
  const { f, client, saved, sent } = await connectedReplacement();
  let release = () => {};
  let entered = () => {};
  const paused = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const checking = client.check(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await paused;
  try {
    await expect(f.connection.revoke(() => client.recordStop())).rejects.toMatchObject({
      code: "cloud.busy",
    });
    expect((await saved("cloud-connection.json")).lifecycle?.pending).toBeUndefined();
    expect((await saved("cloud-replacement.json")).stopped).toBeUndefined();
    expect(sent()).toEqual([]);
  } finally {
    release();
    await checking.catch(() => {});
  }
  expect((await checking).state).toBe("complete");
  await f.connection.revoke(() => client.recordStop());
  expect(sent()).toEqual(["revoke"]);
  expect((await saved("cloud-replacement.json")).stopped).toBe(true);
  expect((await f.connection.status()).installation?.state).toBe("revoked");
});

it("records a stop only for the Cloud connection this replacement imported", async () => {
  const f = await fixture();
  const client = createCloudReplacement({ ...f.options, connection: f.connection });
  const path = join(f.stateDir, "cloud-replacement.json");
  await client.recordStop();
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  await client.prepare();
  await client.recordStop();
  expect(JSON.parse(await readFile(path, "utf8")).stopped).toBeUndefined();
  f.setMode("complete");
  await client.check();
  const key = generateKeyPairSync("ed25519");
  await writeFile(
    join(f.stateDir, "cloud-connection.json"),
    JSON.stringify({
      version: 1,
      origin,
      localVenueId,
      environment: "test",
      requestId: randomUUID(),
      code: "12345678",
      privateKey: key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      publicKey: key.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    }),
    { mode: 0o600 },
  );
  await client.recordStop();
  expect(JSON.parse(await readFile(path, "utf8")).stopped).toBeUndefined();
});

it("saves a recorded stop and refuses a saved stop that is not true", async () => {
  const { f, client } = await connectedReplacement();
  const path = join(f.stateDir, "cloud-replacement.json");
  await client.recordStop();
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.stopped).toBe(true);
  await writeFile(path, JSON.stringify({ ...saved, stopped: false }), { mode: 0o600 });
  await expect(client.status()).rejects.toMatchObject({
    code: "cloud.replacement_state_invalid",
  });
});

it("does not let a corrupt replacement file block Stop access, while start-up and Check reconnection refuse the unreadable file too", async () => {
  const { f, client, sent } = await connectedReplacement();
  const path = join(f.stateDir, "cloud-replacement.json");
  await chmod(path, 0o640);
  await f.connection.revoke(() => client.recordStop());
  expect(sent()).toEqual(["revoke"]);
  expect((await f.connection.status()).installation?.state).toBe("revoked");
  await expect(client.resume()).rejects.toMatchObject({ code: "cloud.replacement_state_invalid" });
  await expect(client.check()).rejects.toMatchObject({ code: "cloud.replacement_state_invalid" });
});
