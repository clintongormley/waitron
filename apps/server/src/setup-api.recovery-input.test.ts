import { Hono } from "hono";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";
import type { CloudRecoveryView } from "./cloud-recovery.js";

const pointId = "9f41b8b8-b14e-472a-8eb4-f9259b80f0d1";
const operation = {
  binding: {
    module: "test-regime",
    action: "restore",
    eventId: "paper-event-42",
    sourceId: "selected-copy-digest",
    targetNodeId: "d0000000-0000-4000-8000-000000000001",
  },
  input: { outsideAllocation: "opaque-signed-envelope" },
};
const credentials = { recoveryOperation: operation, nodeRecoverySecret: "node-paper-key" };

function setup(operations?: SetupDeps["operations"]) {
  const stageRestore = vi.fn(async () => {});
  const stageBucketRestore = vi.fn(async () => {});
  const requestRestart = vi.fn();
  const log = vi.fn();
  const app = new Hono();
  const view: CloudRecoveryView = {
    requestId: "cloud-request",
    code: "12345678",
    openCloudUrl: "https://cloud.example.test/recover",
    expiresAt: "2026-10-14T19:00:00.000Z",
    state: "approved",
  };
  const cloudRecovery: NonNullable<SetupDeps["cloudRecovery"]> = {
    start: async () => view,
    status: async () => view,
    startAgain: async () => view,
    markRestored: async () => {},
    reportRestored: async () => {},
    binding: async () => ({ requestId: "cloud-request", pointId }),
    restore: async (stage) => {
      await stage({
        artifact: new Uint8Array([7, 8]),
        recoveryKey: "archive-cloud-key",
        environment: "preproduction",
      });
    },
  };
  mountSetup(
    app,
    {
      environment: "preproduction",
      stageRestore,
      stageBucketRestore,
      requestRestart,
      cloudRecovery,
      operations,
    },
    log,
  );
  return { app, stageRestore, stageBucketRestore, requestRestart, log };
}

function request(kind: string, supplied: Record<string, unknown> = credentials) {
  if (kind === "archive") {
    const body = new FormData();
    body.set("artifact", new Blob([new Uint8Array([1, 2, 3])]), "copy.waitron");
    body.set("recoveryKey", "archive-key");
    body.set("environment", "preproduction");
    body.set("oldBoxGone", "1");
    for (const [key, value] of Object.entries(supplied))
      body.set(key, key === "recoveryOperation" ? JSON.stringify(value) : String(value));
    return { path: "/setup-api/restore", init: { method: "POST", body } };
  }
  return {
    path: kind === "bucket" ? "/setup-api/restore-bucket" : "/setup-api/cloud-recovery/restore",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(kind === "bucket"
          ? { kit: "bucket-kit", environment: "preproduction", venueConfirmed: "89890001K" }
          : { pointId }),
        oldBoxGone: true,
        ...supplied,
      }),
    },
  };
}

it.each(["archive", "bucket", "cloud"])(
  "forwards %s recovery input and a separate key without returning or logging either key",
  async (kind) => {
    const { app, stageRestore, stageBucketRestore, log } = setup();
    const req = request(kind);
    const response = await app.request(req.path, req.init);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ restoreStaged: true, restarting: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (kind === "bucket") {
      expect(stageBucketRestore).toHaveBeenCalledWith({
        kit: "bucket-kit",
        environment: "preproduction",
        oldBoxGone: true,
        venueConfirmed: "89890001K",
        ...credentials,
      });
    } else {
      expect(stageRestore).toHaveBeenCalledWith(
        {
          artifact: kind === "archive" ? new Uint8Array([1, 2, 3]) : new Uint8Array([7, 8]),
          recoveryKey: kind === "archive" ? "archive-key" : "archive-cloud-key",
          environment: "preproduction",
          ...credentials,
        },
        { oldBoxGone: true },
      );
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("node-paper-key");
    expect(JSON.stringify(log.mock.calls)).not.toContain("archive-key");
  },
);

it.each(["archive", "bucket", "cloud"])(
  "a completed %s request cannot replay with changed recovery scope or a different node key",
  async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), "w41s6-request-binding-"));
    try {
      const operations = createSetupOperationStore(dir);
      const original = setup(operations);
      const first = request(kind);
      expect((await original.app.request(first.path, first.init)).status).toBe(202);
      const restarted = setup(operations);
      for (const changed of [
        { ...credentials, nodeRecoverySecret: "other-node-key" },
        {
          ...credentials,
          recoveryOperation: { ...operation, input: { outsideAllocation: "changed" } },
        },
        {
          ...credentials,
          recoveryOperation: {
            ...operation,
            binding: { ...operation.binding, eventId: "other-event" },
          },
        },
      ]) {
        const next = request(kind, changed);
        const response = await restarted.app.request(next.path, next.init);
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: { code: "setup.operation_conflict", params: {} },
        });
      }
      expect(restarted.stageRestore).not.toHaveBeenCalled();
      expect(restarted.stageBucketRestore).not.toHaveBeenCalled();
      const replay = request(kind);
      expect((await restarted.app.request(replay.path, replay.init)).status).toBe(202);
      const persisted = await readFile(join(dir, "setup-operation.json"), "utf8");
      expect(persisted).not.toContain("node-paper-key");
      expect(persisted).not.toContain("archive-key");
      expect(persisted).not.toContain("outsideAllocation");
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it("refuses malformed multipart data with a field refusal and keeps the next request usable", async () => {
  const { app, stageRestore } = setup();
  const response = await app.request("/setup-api/restore", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=missing" },
    body: "invalid-multipart",
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "artifact" } },
  });
  expect(stageRestore).not.toHaveBeenCalled();
  const valid = request("archive");
  expect((await app.request(valid.path, valid.init)).status).toBe(202);
});

it.each([
  ["artifact", (form: FormData) => form.set("artifact", "not-a-file")],
  ["recoveryOperation", (form: FormData) => form.set("recoveryOperation", "{broken-json")],
  ["recoveryOperation", (form: FormData) => form.set("recoveryOperation", "x".repeat(131073))],
  [
    "recoveryOperation",
    (form: FormData) => form.set("recoveryOperation", new Blob(["{}"]), "operation.json"),
  ],
  [
    "nodeRecoverySecret",
    (form: FormData) => form.set("nodeRecoverySecret", new Blob(["node-key"]), "secret.txt"),
  ],
  ["oldBoxGone", (form: FormData) => form.set("oldBoxGone", "yes")],
  [
    "recoveryOperation",
    (form: FormData) => form.append("recoveryOperation", JSON.stringify(operation)),
  ],
] as const)(
  "refuses an invalid multipart %s without staging or logging the credential",
  async (field, mutate) => {
    const { app, stageRestore, log } = setup();
    const req = request("archive");
    mutate(req.init.body as FormData);
    const response = await app.request(req.path, req.init);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field } },
    });
    expect(stageRestore).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("node-paper-key");
  },
);

it.each(["archive", "bucket", "cloud"])(
  "refuses malformed or unpaired %s recovery credentials and releases the request gate",
  async (kind) => {
    const { app, stageRestore, stageBucketRestore } = setup();
    const bad = [
      { recoveryOperation: null, nodeRecoverySecret: "node-paper-key" },
      { recoveryOperation: operation },
      { nodeRecoverySecret: "node-paper-key" },
      { recoveryOperation: operation, nodeRecoverySecret: " " },
      { recoveryOperation: operation, nodeRecoverySecret: "x".repeat(4097) },
      {
        recoveryOperation: { ...operation, binding: { ...operation.binding, action: "promote" } },
        nodeRecoverySecret: "node-paper-key",
      },
      {
        recoveryOperation: { ...operation, input: { oversized: "é".repeat(70000) } },
        nodeRecoverySecret: "node-paper-key",
      },
    ];
    for (const supplied of bad) {
      const req = request(kind, supplied);
      const response = await app.request(req.path, req.init);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "setup.request_invalid" } });
      expect(stageRestore).not.toHaveBeenCalled();
      expect(stageBucketRestore).not.toHaveBeenCalled();
    }
    const req = request(kind);
    expect((await app.request(req.path, req.init)).status).toBe(202);
  },
);

function contextRequest(kind: string, context: unknown) {
  const req = request(kind);
  if (req.init.body instanceof FormData)
    req.init.body.set("recoveryContext", JSON.stringify(context));
  else
    req.init.body = JSON.stringify({
      ...JSON.parse(String(req.init.body)),
      recoveryContext: context,
    });
  return req;
}

it.each(["archive", "bucket", "cloud"])(
  "%s recovery validates context before staging and permits a corrected request",
  async (kind) => {
    const { app, stageRestore, stageBucketRestore } = setup();
    for (const context of [
      null,
      [],
      {},
      { selectedSourceId: "selected-copy-digest", oldBoxGone: true, soleRecovery: "true" },
      { selectedSourceId: "selected-copy-digest", oldBoxGone: null, soleRecovery: true },
      { selectedSourceId: "x".repeat(257), oldBoxGone: true, soleRecovery: true },
    ]) {
      const req = contextRequest(kind, context);
      const response = await app.request(req.path, req.init);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "setup.request_invalid", params: { field: "recoveryContext" } },
      });
    }
    expect(stageRestore).not.toHaveBeenCalled();
    expect(stageBucketRestore).not.toHaveBeenCalled();
    const corrected = contextRequest(kind, {
      selectedSourceId: "selected-copy-digest",
      oldBoxGone: false,
      soleRecovery: false,
    });
    expect((await app.request(corrected.path, corrected.init)).status).toBe(202);
    expect((kind === "bucket" ? stageBucketRestore : stageRestore).mock.calls).toHaveLength(1);
  },
);

it.each(["archive", "bucket", "cloud"])(
  "a completed %s request rejects changed isolation declarations on replay",
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "hour-recovery-http-binding-"));
    try {
      const operations = createSetupOperationStore(directory);
      const context = {
        selectedSourceId: "selected-copy-digest",
        oldBoxGone: true,
        soleRecovery: true,
      };
      const first = setup(operations);
      const original = contextRequest(kind, context);
      expect((await first.app.request(original.path, original.init)).status).toBe(202);
      const next = setup(operations);
      for (const altered of [
        { ...context, oldBoxGone: false },
        { ...context, soleRecovery: false },
        { ...context, selectedSourceId: "different-point" },
      ]) {
        const req = contextRequest(kind, altered);
        const response = await next.app.request(req.path, req.init);
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: { code: "setup.operation_conflict", params: {} },
        });
      }
      expect(next.stageRestore).not.toHaveBeenCalled();
      expect(next.stageBucketRestore).not.toHaveBeenCalled();
      const replay = contextRequest(kind, context);
      expect((await next.app.request(replay.path, replay.init)).status).toBe(202);
      expect(await readFile(join(directory, "setup-operation.json"), "utf8")).not.toContain(
        "node-paper-key",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
