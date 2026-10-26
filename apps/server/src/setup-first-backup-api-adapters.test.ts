import { archiveHost, key, clock, node, suite } from "../test/hour-recovery-host.js";

import { createHash, randomBytes } from "node:crypto";

import { Socket } from "node:net";

import { TLSSocket } from "node:tls";

import { copyFile, lstat, readFile, readdir, writeFile } from "node:fs/promises";

import { join } from "node:path";

import { Hono } from "hono";

import { afterEach, expect, it, vi } from "vitest";

import { ALL_MODULES } from "@waitron/composition";

import {
  createFirstSetupBackupWorkspace,
  firstSetupFrozenDigest,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "@waitron/provisioning";

import { createFirstSetupModuleHost } from "./module-operation-host.js";

import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";

import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";

import { request as ownerRequest } from "../test/first-fiscal.js";

import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";

import { packArchive, unpackArchive } from "./backup-archive.js";

import "@waitron/shared";

import "@waitron/db";

import { generateNodeKeyPair } from "@waitron/membership";

import { encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";

import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";

import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";

const prefix = "/setup-api/first-setup/resolution/backup";

const sockets: TLSSocket[] = [];

const services: ReturnType<typeof createFirstSetupBackupRecovery>[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const socket of sockets.splice(0)) socket.destroy();
});

function tls(address = "192.0.2.7") {
  const socket = new TLSSocket(new Socket());
  Object.defineProperty(socket, "remoteAddress", { value: address });
  sockets.push(socket);
  return { incoming: { socket } };
}

async function fixture(readable = false) {
  const f = await archiveHost();
  const host = createFirstSetupModuleHost({
    ...f.roots,
    modules: ALL_MODULES,
    environment: { WAITRON_ENV: "preproduction" },
  });
  if (readable) {
    await host.owner.claimFirstSetup(
      { environment: "preproduction", request: ownerRequest },
      randomBytes(32).toString("base64url"),
    );
    const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey));
    entries.push({
      name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
      bytes: Buffer.from(
        JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
      ),
    });
    f.restore.artifact = encryptArtifact(packArchive(entries), f.restore.recoveryKey);
  } else
    await writeFile(join(f.roots.stateDir, "first-setup.json"), "uncheckable retained attempt");
  const workspace = createFirstSetupBackupWorkspace(f.roots);
  const options = {
    ...f.roots,
    host,
    workspace,
    modules: ALL_MODULES,
    environment: "preproduction" as const,
    sources: {
      ...f.restore,
      bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
    },
    log: () => {},
  };
  const service = createFirstSetupBackupRecovery(options);
  services.push(service);
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const payload = {
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
    source: { kind: "archive", recoveryKey: f.restore.recoveryKey, environment: "preproduction" },
    nodeRecoverySecret: key.secret,
    context: { oldBoxGone: true, soleRecovery: true },
  };
  const app = new Hono(),
    log = vi.fn(),
    restart = vi.fn();
  mountFirstSetupBackupApi(app, service, log, restart);
  const upload = (value: unknown = payload, artifact = true) => {
    const form = new FormData();
    form.set("request", JSON.stringify(value));
    if (artifact)
      form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "backup.wbk");
    return form;
  };
  const post = (path: string, value: unknown, env = tls(), headers = {}) =>
    app.request(
      `https://localhost${prefix}/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(value),
      },
      env,
    );
  return { ...f, host, workspace, service, options, app, log, restart, payload, upload, post };
}

it("authenticates a signed bucket generation through the repair API", async () => {
  const f = await fixture();
  const signer = generateNodeKeyPair(),
    store = createMemoryObjectStore({ now: () => new Date() });
  const generation = `gen-0-${node.nodeId}-20261016T124000Z`;
  const kit = {
    version: 1 as const,
    venueId: node.locationId,
    bucket: {
      region: "local",
      bucket: "copy",
      prefix: "",
      accessKeyId: "unused",
      secretAccessKey: "unused",
    },
    recoveryKey: "bucket-password",
    pointerSignerPublicKey: signer.publicKey,
  };
  await writePointer(
    store,
    kit.venueId,
    signPointer(
      {
        venueId: kit.venueId,
        nodeId: node.nodeId,
        generation,
        term: 0,
        writtenAt: new Date().toISOString(),
      },
      signer.privateKey,
    ),
    null,
  );
  const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey)).filter(
    (entry) => entry.name !== "db.dump",
  );
  await writeSealedStateRow(
    suite.db,
    node.nodeId,
    await sealNodeState(entries, kit.recoveryKey),
    new Date(),
  );
  await suite.db.archiveTo(f.database);
  const service = createFirstSetupBackupRecovery({
    ...f.options,
    sources: {
      ...f.options.sources,
      bucket: {
        ...f.options.sources.bucket,
        openStore: () => store,
        restoreGeneration: async ({ outPath }) => copyFile(f.database, outPath),
      },
    },
  });
  services.push(service);
  const app = new Hono();
  mountFirstSetupBackupApi(app, service, f.log);
  const response = await app.request(
    prefix + "/open",
    {
      method: "POST",
      body: f.upload(
        {
          ...f.payload,
          source: { kind: "bucket", kit: encodeRecoveryKit(kit), environment: "preproduction" },
        },
        false,
      ),
    },
    tls(),
  );
  expect(response.status).toBe(200);
  const session = await response.json();
  expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
  expect(session.preview.sourceId).toBe(`stream:${node.locationId}:${generation}`);
  expect(session.binding.sourceId).toMatch(/^stream-sha256:[a-f0-9]{64}$/);
  expect(JSON.stringify(session)).not.toContain(kit.recoveryKey);
  expect(await f.workspace.read()).toEqual([]);
});

it("uses checked Cloud approval and node proof through the repair adapters", async () => {
  const f = await fixture();
  const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
  const manifest = JSON.parse(
    Buffer.from(
      unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey)).find(
        (entry) => entry.name === "manifest.json",
      )!.bytes,
    ).toString(),
  ) as { modules: Record<string, number> };
  const point = {
    id: pointId,
    venueId: node.locationId,
    capturedAt: new Date().toISOString(),
    modules: manifest.modules,
    digest: createHash("sha256").update(f.restore.artifact).digest("hex"),
    size: f.restore.artifact.length,
    objectKey: `snapshots/${pointId}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const expiresAt = new Date(clock.wall() + 900_000).toISOString();
  let refused = false,
    expireStatusOnce = false;
  const service = createFirstSetupBackupRecovery({
    ...f.options,
    cloud: {
      origin: "https://cloud.example.test",
      environment: "preproduction",
      fetch: async (url, init) => {
        const action = new URL(String(url)).pathname.split("/").at(-1);
        if (refused) return new Response(null, { status: 403 });
        if (action === "status" && expireStatusOnce) {
          expireStatusOnce = false;
          return new Response(null, { status: 410 });
        }
        const body = JSON.parse(String(init?.body)) as { payload: string };
        const requestId = (
          JSON.parse(Buffer.from(body.payload, "base64url").toString()) as string[]
        )[2];
        if (action === "start" || action === "status")
          return Response.json({
            requestId,
            state: action === "start" ? "awaiting_owner" : "approved",
            expiresAt,
            operationId: action === "start" ? null : requestId,
          });
        return Response.json({
          point,
          operationExpiresAt: expiresAt,
          ...(action === "read"
            ? {
                location: {
                  endpoint: "https://store.example.test",
                  bucket: "copy",
                  region: "local",
                },
                credentials: {
                  accessKeyId: "unused",
                  secretAccessKey: "unused",
                  sessionToken: "unused",
                },
                recoveryKey: f.restore.recoveryKey,
                expiresAt,
              }
            : {}),
        });
      },
      download: async () => f.restore.artifact,
    },
  });
  services.push(service);
  const app = new Hono();
  mountFirstSetupBackupApi(app, service, f.log);
  const post = (path: string) =>
    app.request(
      prefix + path,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      tls(),
    );
  const start = await post("/cloud/start");
  expect(start.status).toBe(200);
  expect(await start.json()).toMatchObject({ state: "awaiting_owner" });
  const approval = await post("/cloud/status");
  expect(approval.status).toBe(200);
  expect(await approval.json()).toMatchObject({ state: "approved", point: { id: pointId } });
  const payload = { ...f.payload, source: { kind: "cloud", pointId } };
  const invalid = await app.request(
    prefix + "/open",
    { method: "POST", body: f.upload({ ...payload, nodeRecoverySecret: "wrong key" }, false) },
    tls(),
  );
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toEqual({
    error: { code: "promotion.break_glass_invalid", params: {} },
  });
  const opened = await app.request(
    prefix + "/open",
    { method: "POST", body: f.upload(payload, false) },
    tls(),
  );
  expect(opened.status).toBe(200);
  const session = await opened.json();
  expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
  await service.close(session.sessionId);
  expireStatusOnce = true;
  const again = await post("/cloud/start-again");
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ state: "awaiting_owner" });
  refused = true;
  const denied = await post("/cloud/status");
  expect(denied.status).toBe(500);
  expect(await denied.json()).toEqual({ error: { code: "server.internal" } });
  expect(await f.workspace.read()).toEqual([]);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.restore.recoveryKey);
});

it.each(["open", "commit", "start-again"] as const)(
  "a queued %s cannot replace an in-flight recovery commit",
  async (action) => {
    const f = await fixture(true);
    if (action === "start-again") {
      const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
      const { mountFirstSetupResolutionApi } = await import("./setup-first-fiscal-api.js");
      const actions = createFirstSetupResolutionActions({ ...f.roots, host: f.host });
      mountFirstSetupResolutionApi(f.app, f.host, f.log, {
        startAgain: actions.startAgainFirstSetup,
      });
    }
    const opened = await f.app.request(
      `https://localhost${prefix}/open`,
      { method: "POST", body: f.upload() },
      tls(),
    );
    expect(opened.status).toBe(200);
    const session = await opened.json();
    const selected = (await recoverySelectPastWaits(
      clock,
      { prepare: (proposal, client) => f.service.prepare(session.sessionId, proposal, client) },
      { onBox: false },
    )) as { status: string; input: unknown };
    expect(selected.status).toBe("selected");
    const before = (await f.workspace.read()).at(-1)!;
    const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
    let reached!: () => void;
    const started = new Promise<void>((done) => {
      reached = done;
    });
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const append = f.workspace.append;
    const appendSpy = vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
      if (record.phase === "placement-started") {
        reached();
        await gate;
      }
      return append(record);
    });
    let committed: Response | Promise<Response> | undefined;
    let raced: Response | Promise<Response> | undefined;
    let exclusionSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      committed = f.post("commit", { sessionId: session.sessionId, input: selected.input });
      await started;
      let entered!: () => void;
      const queued = new Promise<void>((done) => {
        entered = done;
      });
      const exclusion = f.host.resolution.withVenueExclusion;
      exclusionSpy = vi.spyOn(f.host.resolution, "withVenueExclusion").mockImplementation((run) => {
        entered();
        return exclusion(run);
      });
      if (action === "open")
        raced = f.app.request(
          `https://localhost${prefix}/open`,
          { method: "POST", body: f.upload() },
          tls(),
        );
      else if (action === "commit")
        raced = f.post("commit", { sessionId: session.sessionId, input: selected.input });
      else {
        raced = f.app.request(
          "https://localhost/setup-api/first-setup/resolution/start-again",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(f.payload.observation),
          },
          tls(),
        );
      }
      await queued;
      release();
      const first = await committed!;
      expect(first.status, await first.clone().text()).toBe(200);
      expect(await first.json()).toEqual({ restarting: true });
      const loser = await raced!;
      expect(loser.status).toBe(action === "commit" ? 403 : action === "open" ? 409 : 503);
      expect(await loser.json()).toMatchObject({
        error: {
          code:
            action === "commit"
              ? "setup.owner_required"
              : action === "open"
                ? "setup.attempt_conflict"
                : "setup.not_ready",
        },
      });
      const after = (await f.workspace.read()).at(-1)!;
      expect(after.phase).toBe("selected");
      expect(after.target).toEqual(before.target);
      expect(after.binding).toEqual(before.binding);
      expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
    } finally {
      release();
      await Promise.allSettled([committed, raced]);
      appendSpy.mockRestore();
      exclusionSpy?.mockRestore();
    }
  },
);

async function folderTree(dir: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const entry of (await readdir(dir, { recursive: true })).sort()) {
    if (/^venue\.(lock|holder)/.test(entry)) continue;
    const path = join(dir, entry);
    tree[entry] = (await lstat(path)).isDirectory()
      ? "/"
      : createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
  }
  return tree;
}

it.each([
  ["prepare", { action: "compare-clocks", browser: null }],
  ["commit", {}],
])(
  "a session opened before a Start again marker is refused at %s, and nothing is written",
  async (step, value) => {
    const f = await fixture(true);
    const opened = await f.app.request(
      `https://localhost${prefix}/open`,
      { method: "POST", body: f.upload() },
      tls(),
    );
    expect(opened.status).toBe(200);
    const session = await opened.json();
    const state = (await f.host.store.read())!;
    await writeStartAgainMarker(
      f.roots,
      await startAgainMarkerFor(f.roots, {
        attemptId: state.frozen.attemptId,
        frozenDigest: firstSetupFrozenDigest(state),
      }),
    );
    const journal = await f.workspace.read();
    const before = {
      venue: await folderTree(f.roots.venueDir),
      state: await folderTree(f.roots.stateDir),
    };
    const response = await f.post(step, {
      sessionId: session.sessionId,
      [step === "prepare" ? "proposal" : "input"]: value,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "setup.start_again_incomplete", params: {} },
    });
    expect(await f.workspace.read()).toEqual(journal);
    expect({
      venue: await folderTree(f.roots.venueDir),
      state: await folderTree(f.roots.stateDir),
    }).toEqual(before);
    expect(f.restart).not.toHaveBeenCalled();
  },
);

it.each(["renew", "cloud/renew", "cloud/release"])(
  "%s requires a real encrypted socket",
  async (path) => {
    const f = await fixture();
    const response = await f.app.request(`https://localhost${prefix}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
  },
);

it.each<[string, unknown]>([
  ["renew", { sessionId: "a", extra: true }],
  ["renew", {}],
  ["cloud/renew", { extra: true }],
  ["cloud/release", { extra: true }],
  ["cloud/renew", {}],
  ["cloud/release", {}],
  ["cloud/renew", { holder: "A", extra: true }],
  ["cloud/release", { holder: 1 }],
  ["cloud/renew", { holder: " " }],
  ["cloud/start", { holder: "A", extra: true }],
  ["cloud/status", { holder: "" }],
  ["cloud/start-again", { holder: 1 }],
])("%s refuses the body %j", async (path, body) => {
  const f = await fixture();
  const response = await f.post(path, body);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
});

it("reads activity with no sign-in, renews a live session, and refuses an unknown one", async () => {
  const f = await fixture();
  const read = async () => {
    const response = await f.app.request(`http://localhost${prefix}/activity`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return response.json();
  };
  expect(await read()).toEqual({ activity: null });
  const opened = await f.app.request(
    `https://localhost${prefix}/open`,
    { method: "POST", body: f.upload() },
    tls(),
  );
  const session = await opened.json();
  expect(await read()).toEqual({
    activity: { state: "running", startedAt: expect.any(String), lastActiveAt: expect.any(String) },
  });
  const renewed = await f.post("renew", { sessionId: session.sessionId });
  expect(renewed.status).toBe(200);
  expect(await renewed.json()).toEqual({ renewed: true });
  const unknown = await f.post("renew", { sessionId: "unknown session" });
  expect(unknown.status).toBe(403);
  expect(await unknown.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
});

it("refuses a Cloud renewal with no wait, and answers a release", async () => {
  const f = await fixture();
  expect((await f.post("cloud/start", { holder: "A" })).status).toBe(503);
  const renewed = await f.post("cloud/renew", { holder: "A" });
  expect(renewed.status).toBe(403);
  expect(await renewed.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
  const released = await f.post("cloud/release", { holder: "A" });
  expect(released.status).toBe(200);
  expect(await released.json()).toEqual({ released: true });
});

it("holds a Cloud wait per holder through the routes, and renews it while any holder does", async () => {
  const f = await fixture();
  const expiresAt = new Date(clock.wall() + 900_000).toISOString();
  let expired = false;
  const service = createFirstSetupBackupRecovery({
    ...f.options,
    cloud: {
      origin: "https://cloud.example.test",
      environment: "preproduction",
      fetch: async (url, init) => {
        if (new URL(String(url)).pathname.endsWith("/status") && expired)
          return new Response(null, { status: 410 });
        const body = JSON.parse(String(init?.body)) as { payload: string };
        const requestId = (
          JSON.parse(Buffer.from(body.payload, "base64url").toString()) as string[]
        )[2];
        return Response.json({ requestId, state: "awaiting_owner", expiresAt, operationId: null });
      },
      download: async () => f.restore.artifact,
    },
  });
  services.push(service);
  const app = new Hono();
  mountFirstSetupBackupApi(app, service, f.log);
  const post = (path: string, body: unknown) =>
    app.request(
      `${prefix}/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      tls(),
    );
  const activity = async () =>
    ((await (await app.request(`${prefix}/activity`)).json()) as { activity: unknown }).activity;
  expect((await post("cloud/start", { holder: "A" })).status).toBe(200);
  expect(await activity()).toMatchObject({ state: "running" });
  const renewed = await post("cloud/renew", { holder: "A" });
  expect(renewed.status).toBe(200);
  expect(await renewed.json()).toEqual({ renewed: true });
  expect((await post("cloud/status", { holder: "B" })).status).toBe(200);
  expired = true;
  expect((await post("cloud/start-again", { holder: "B" })).status).toBe(200);
  expect(await (await post("cloud/release", { holder: "A" })).json()).toEqual({ released: true });
  expect(await activity()).toMatchObject({ state: "running" });
  expect((await post("cloud/renew", { holder: "A" })).status).toBe(403);
  expect((await post("cloud/renew", { holder: "B" })).status).toBe(200);
  expect((await post("cloud/release", { holder: "B" })).status).toBe(200);
  expect(await activity()).toBeNull();
});
