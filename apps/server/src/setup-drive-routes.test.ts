import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { Hono } from "hono";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import { createHostPlaces } from "./box-host-api.js";
import type { BoxHostRequests } from "./box-host-client.js";
import { mountSetup } from "./setup-api.js";

const sockets: TLSSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});
function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

const PATH = "/setup-api/recovery/drives";
const LIST = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
const DRIVES = [{ drive: "sda1", fileSystem: "exfat", readable: true }] as const;

async function fixture(
  storageList: BoxHostRequests["storageList"] = async () => ({ available: true, drives: DRIVES }),
) {
  const root = await mkdtemp(join(tmpdir(), "setup-drive-list-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const name = backupArchiveKey(new Date("2026-06-01T10:00:00Z"), {
    nodeId: "d0000000-0000-4000-8000-000000000001",
  });
  await mkdir(join(root, "sda1", "backups"), { recursive: true });
  await writeFile(join(root, "sda1", "backups", name), Uint8Array.from([1, 2, 3]));
  const host = { storageList: vi.fn(storageList) };
  const places = createHostPlaces();
  const app = new Hono();
  mountSetup(
    app,
    { environment: "preproduction", driveHost: { requests: host, places }, drivesRoot: root },
    () => {},
  );
  return { app, host, places, name, root };
}

it("the drive list needs the owner's transport and asks the host as the server", async () => {
  const { app, host, name } = await fixture();
  const plain = await app.request(PATH, LIST);
  expect(plain.status).toBe(403);
  expect(await plain.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
  const foreign = await app.request(
    PATH,
    { ...LIST, headers: { ...LIST.headers, origin: "https://attacker.test" } },
    tls(),
  );
  expect(foreign.status).toBe(403);
  expect(host.storageList).not.toHaveBeenCalled();

  const listed = await app.request(PATH, LIST, tls());
  expect(listed.status).toBe(200);
  expect(listed.headers.get("cache-control")).toBe("no-store");
  expect(await listed.json()).toEqual({
    drives: DRIVES,
    files: [
      {
        drive: "sda1",
        path: `backups/${name}`,
        size: 3,
        takenAt: "2026-06-01T10:00:00.000Z",
      },
    ],
  });
  expect(host.storageList).toHaveBeenCalledExactlyOnceWith({ source: "server" });
});

it.each([
  ["a body that is not JSON", { "content-type": "text/plain" }, "{}"],
  ["a JSON text sequence", { "content-type": "application/json-seq" }, "{}"],
  ["JSON lines", { "content-type": "application/jsonl" }, "{}"],
  ["a body with a key", { "content-type": "application/json" }, '{"drive":"sda1"}'],
  ["a body over its limit", { "content-type": "application/json" }, `"${"x".repeat(5000)}"`],
])("the drive list refuses %s before asking the host", async (_label, headers, body) => {
  const { app, host } = await fixture();
  const response = await app.request(PATH, { method: "POST", headers, body }, tls());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "body" } },
  });
  expect(host.storageList).not.toHaveBeenCalled();
});

it("the drive list answers box_host.busy while both host places are taken, and the host is never asked", async () => {
  const { app, host, places } = await fixture();
  places.taken = 2;
  const response = await app.request(PATH, LIST, tls());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: { code: "box_host.busy", params: {} } });
  expect(host.storageList).not.toHaveBeenCalled();
});

it("with no host it answers box_host.unavailable", async () => {
  const { app } = await fixture(async () => ({
    available: false,
    reason: "missing",
    detail: "ENOENT",
  }));
  const response = await app.request(PATH, LIST, tls());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "box_host.unavailable", params: { reason: "missing", detail: "ENOENT" } },
  });
});

it("the host's own busy answers box_host.busy", async () => {
  const { app } = await fixture(async () => ({
    available: false,
    reason: "refused",
    refusal: "busy",
  }));
  const response = await app.request(PATH, LIST, tls());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: { code: "box_host.busy", params: {} } });
});

it("a broken host call answers box_host.failed", async () => {
  const { app } = await fixture(async () => ({ available: false, reason: "timeout" }));
  const response = await app.request(PATH, LIST, tls());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: { code: "box_host.failed", params: { reason: "timeout" } },
  });
});

it("is unavailable when the box has no host requests", async () => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, () => {});
  const response = await app.request(PATH, LIST, tls());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});

it("the drive list answers while setup's one-at-a-time queue is held", async () => {
  const { root, host, places } = await fixture();
  const coordinator = createFirstSetupCoordinator();
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      driveHost: { requests: host, places },
      drivesRoot: root,
      firstSetup: { coordinator, assertOtherAllowed: async () => {} },
    },
    () => {},
  );
  let release!: () => void;
  const held = coordinator.run(() => new Promise<void>((resolve) => (release = resolve)));
  try {
    const answer = await Promise.race([
      Promise.resolve(app.request(PATH, LIST, tls())).then((response) => response.status),
      new Promise((resolve) => setTimeout(() => resolve("waited"), 2000)),
    ]);
    expect(answer).toBe(200);
    expect(host.storageList).toHaveBeenCalledOnce();
  } finally {
    release();
    await held;
  }
});
