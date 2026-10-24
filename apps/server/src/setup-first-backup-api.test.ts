import { archiveHost, key, root, clock } from "../test/hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";
import { request as ownerRequest } from "../test/first-fiscal.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { AppError } from "@waitron/shared";
import { invoiceSeries, openVenueDatabase } from "@waitron/db";

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
