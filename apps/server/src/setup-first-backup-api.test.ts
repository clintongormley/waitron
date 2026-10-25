import { archiveHost, key, root, clock, node, suite } from "../test/hour-recovery-host.js";
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
import { AppError } from "@waitron/shared";
import { invoiceSeries, openVenueDatabase } from "@waitron/db";
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

it("prepares through the remote browser clock and completes an interrupted target with fresh proof", async () => {
  const f = await fixture(true);
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const opened = await f.app.request(
    `https://localhost${prefix}/open`,
    { method: "POST", body: f.upload() },
    tls(),
  );
  expect(opened.status).toBe(200);
  const session = await opened.json();
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: async (proposal) => {
        const response = await f.post("prepare", { sessionId: session.sessionId, proposal });
        expect(response.status).toBe(200);
        return response.json();
      },
    },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  const before = (await f.workspace.read()).at(-1)!;
  const select = vi
    .spyOn(f.workspace, "select")
    .mockRejectedValueOnce(new AppError("setup.attempt_invalid", {}));
  const interrupted = await f.post("commit", {
    sessionId: session.sessionId,
    input: selected.input,
  });
  expect(interrupted.status).toBe(409);
  expect(await interrupted.json()).toMatchObject({ error: { code: "setup.attempt_invalid" } });
  expect(f.restart).not.toHaveBeenCalled();
  select.mockRestore();
  await f.service.dispose();
  const store = await openVenueDatabase(before.target.target.venueDir);
  let counters;
  try {
    await store.venue.update(invoiceSeries).set({ nextNumber: 147 });
    counters = await store.venue.select().from(invoiceSeries);
  } finally {
    await store.close();
  }
  const restarted = createFirstSetupBackupRecovery(f.options);
  services.push(restarted);
  const app = new Hono();
  mountFirstSetupBackupApi(app, restarted, f.log, f.restart);
  const resumePayload = {
    observation: f.payload.observation,
    recoveryId: session.recoveryId,
    nodeRecoverySecret: key.secret,
    context: f.payload.context,
  };
  const post = (path: string, body: unknown) =>
    app.request(
      prefix + "/" + path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      tls(),
    );
  const oldGrant = await post("commit", { sessionId: session.sessionId, input: selected.input });
  expect(oldGrant.status).toBe(403);
  const denied = await post("resume", { ...resumePayload, nodeRecoverySecret: "wrong key" });
  expect(denied.status).toBe(422);
  expect(await denied.json()).toMatchObject({ error: { code: "promotion.break_glass_invalid" } });
  const resumed = await post("resume", resumePayload);
  expect(resumed.status).toBe(200);
  const fresh = await resumed.json();
  expect(fresh.input).toEqual(selected.input);
  expect(fresh.binding).toEqual(session.binding);
  expect(fresh.sessionId).not.toBe(session.sessionId);
  const committed = await post("commit", { sessionId: fresh.sessionId, input: fresh.input });
  expect(committed.status).toBe(200);
  expect(await committed.json()).toEqual({ restarting: true });
  await vi.waitFor(() => expect(f.restart).toHaveBeenCalledOnce());
  expect((await f.workspace.read()).at(-1)).toMatchObject({
    phase: "selected",
    binding: session.binding,
    input: selected.input,
  });
  const final = await openVenueDatabase(before.target.target.venueDir);
  try {
    expect(await final.venue.select().from(invoiceSeries)).toEqual(counters);
  } finally {
    await final.close();
  }
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
});

it("returns only the authenticated backup preview and closes its memory-only grant", async () => {
  const f = await fixture();
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const opened = await f.app.request(
    `https://localhost${prefix}/open`,
    { method: "POST", body: f.upload() },
    tls(),
  );
  expect(opened.status).toBe(200);
  expect(opened.headers.get("cache-control")).toBe("no-store");
  const session = await opened.json();
  expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
  expect(session.sessionId).toEqual(expect.any(String));
  expect(JSON.stringify(session)).not.toContain(key.secret);
  expect(JSON.stringify(session)).not.toContain(root);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
  const closed = await f.post("close", { sessionId: session.sessionId });
  expect(closed.status).toBe(200);
  expect(await closed.json()).toEqual({ closed: true });
  const replay = await f.post("prepare", {
    sessionId: session.sessionId,
    proposal: { action: "clock-challenge" },
  });
  expect(replay.status).toBe(403);
  expect(await replay.json()).toMatchObject({ error: { code: "setup.owner_required" } });
  expect(await f.workspace.read()).toEqual([]);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(key.secret);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.restore.recoveryKey);
});

it.each([
  "open",
  "resume",
  "prepare",
  "commit",
  "close",
  "cloud/start",
  "cloud/status",
  "cloud/start-again",
])("%s requires a real encrypted socket before parsing any secret", async (path) => {
  const f = await fixture();
  const response = await f.app.request(`https://localhost${prefix}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    body: "invalid secret body",
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
  expect(await f.workspace.read()).toEqual([]);
});
it.each<Record<string, string>>([
  { Origin: "https://other.example" },
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Site": "same-site" },
])("rejects foreign origin/site %j before opening a private copy", async (headers) => {
  const f = await fixture();
  const response = await f.app.request(
    `https://localhost${prefix}/open`,
    { method: "POST", headers, body: f.upload() },
    tls(),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "setup.owner_required" } });
  expect(await f.workspace.read()).toEqual([]);
});
it("does not return the preview for a wrong node key", async () => {
  const f = await fixture();
  const response = await f.app.request(
    prefix + "/open",
    { method: "POST", body: f.upload({ ...f.payload, nodeRecoverySecret: "wrong key" }) },
    tls(),
  );
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: { code: "promotion.break_glass_invalid", params: {} },
  });
  expect(await f.workspace.read()).toEqual([]);
});
it("keeps a stale inspection out of backup proof", async () => {
  const f = await fixture();
  const response = await f.app.request(
    prefix + "/open",
    {
      method: "POST",
      body: f.upload({
        ...f.payload,
        observation: { ...f.payload.observation, inspectionId: "stale" },
      }),
    },
    tls(),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "setup.attempt_conflict" } });
});
it.each([
  "extra",
  "observation-extra",
  "context-extra",
  "source-extra",
  "missing-artifact",
  "duplicate-request",
  "duplicate-artifact",
  "unknown-part",
  "text-artifact",
  "oversize-request",
  "bad-json",
  "client-path",
  "bad-recovery-id",
])("rejects malformed multipart %s before granting proof", async (kind) => {
  const f = await fixture();
  const payload: Record<string, unknown> & {
    observation: Record<string, unknown>;
    context: Record<string, unknown>;
    source: Record<string, unknown>;
  } = structuredClone(f.payload);
  if (kind === "extra") payload.extra = true;
  if (kind === "observation-extra") payload.observation.originalsDigest = "client digest";
  if (kind === "context-extra") payload.context.selectedSourceId = "client authority";
  if (kind === "source-extra") payload.source.artifact = [1, 2];
  if (kind === "client-path") payload.source.artifactPath = "/private/backup";
  if (kind === "bad-recovery-id") payload.recoveryId = "../other";
  const form = f.upload(payload, kind !== "missing-artifact");
  if (kind === "duplicate-request") form.append("request", JSON.stringify(payload));
  if (kind === "duplicate-artifact") form.append("artifact", new Blob(["another"]));
  if (kind === "unknown-part") form.append("privatePath", "/private/backup");
  if (kind === "text-artifact") form.set("artifact", "file path");
  if (kind === "oversize-request") form.set("request", "x".repeat(131073));
  if (kind === "bad-json") form.set("request", "{");
  const response = await f.app.request(prefix + "/open", { method: "POST", body: form }, tls());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
  expect(await f.workspace.read()).toEqual([]);
});
it.each([
  "prepare",
  "commit",
  "close",
  "resume",
  "cloud/start",
  "cloud/status",
  "cloud/start-again",
])("%s refuses an extra field and a non-JSON request", async (path) => {
  const f = await fixture();
  for (const headers of [{}, { "Content-Type": "text/plain" }]) {
    const response = await f.post(path, { unexpected: "private" }, tls(), headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
  }
});
it("bounds JSON and advertised upload size without buffering the upload", async () => {
  const f = await fixture();
  for (const response of [
    await f.post("prepare", { sessionId: "x", proposal: "x".repeat(131072) }),
    await f.app.request(
      prefix + "/open",
      {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=x",
          "Content-Length": String(256 * 1024 * 1024 + 262145),
        },
        body: "--x",
      },
      tls(),
    ),
  ]) {
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
  }
});
it("keeps Cloud unavailable without provider configuration", async () => {
  const f = await fixture();
  const response = await f.post("cloud/start", {});
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});

type Payload = Awaited<ReturnType<typeof fixture>>["payload"];
it.each<[string, (payload: Payload) => unknown, boolean]>([
  ["null", () => null, true],
  ["array", () => [], true],
  ["number", () => 42, true],
  ["null-observation", (p) => ({ ...p, observation: null }), true],
  ["zero-revision", (p) => ({ ...p, observation: { ...p.observation, revision: 0 } }), true],
  [
    "fractional-generation",
    (p) => ({ ...p, observation: { ...p.observation, ownerGeneration: 1.5 } }),
    true,
  ],
  [
    "string-generation",
    (p) => ({ ...p, observation: { ...p.observation, ownerGeneration: "1" } }),
    true,
  ],
  ["string-confirmation", (p) => ({ ...p, context: { ...p.context, soleRecovery: "true" } }), true],
  ["blank-node-key", (p) => ({ ...p, nodeRecoverySecret: " " }), true],
  ["oversize-node-key", (p) => ({ ...p, nodeRecoverySecret: "x".repeat(4097) }), true],
  ["non-string-key", (p) => ({ ...p, nodeRecoverySecret: [] }), true],
  ["null-recovery-id", (p) => ({ ...p, recoveryId: null }), true],
  ["null-environment", (p) => ({ ...p, source: { ...p.source, environment: null } }), true],
  ["blank-archive-key", (p) => ({ ...p, source: { ...p.source, recoveryKey: " " } }), true],
  [
    "unknown-source",
    (p) => ({ ...p, source: { kind: "other", pointId: "047bacd4-df70-4881-a835-c6dd75ae7ecf" } }),
    false,
  ],
  [
    "bucket-artifact",
    (p) => ({ ...p, source: { kind: "bucket", kit: "kit", environment: "preproduction" } }),
    true,
  ],
  [
    "bucket-environment",
    (p) => ({ ...p, source: { kind: "bucket", kit: "kit", environment: [] } }),
    false,
  ],
  [
    "bucket-blank-kit",
    (p) => ({ ...p, source: { kind: "bucket", kit: " ", environment: "preproduction" } }),
    false,
  ],
  ["cloud-point", (p) => ({ ...p, source: { kind: "cloud", pointId: "not a UUID" } }), false],
])("rejects malformed proof %s without admitting a session", async (_kind, change, artifact) => {
  const f = await fixture();
  const response = await f.app.request(
    prefix + "/open",
    { method: "POST", body: f.upload(change(f.payload), artifact) },
    tls(),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
  expect(await f.workspace.read()).toEqual([]);
});

it("refuses malformed multipart bodies and stops an upload that outgrows its bound", async () => {
  const f = await fixture();
  for (const init of [
    { headers: { "Content-Type": "text/plain" }, body: "secret" },
    { headers: { "Content-Type": "multipart/form-data; boundary=x" }, body: "broken boundary" },
    { headers: { "Content-Type": "multipart/form-data; boundary=x" } },
  ]) {
    const response = await f.app.request(prefix + "/open", { method: "POST", ...init }, tls());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
  }
  let canceled = false;
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (++sent > 260) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      canceled = true;
    },
  });
  const request = new Request("https://localhost" + prefix + "/open", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=x" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  const response = await f.app.request(request, {}, tls());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "setup.request_invalid", params: { field: "artifact" } },
  });
  expect(canceled).toBe(true);
  expect(await f.workspace.read()).toEqual([]);
});

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
