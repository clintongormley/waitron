import { useSetupArchiveUpload } from "./testing/setup-archive-upload.js";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { mountSetup } from "./setup-api.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";

const receiveArchive = useSetupArchiveUpload();
const preview: RecoveryBackupPreview = {
  sourceId: "selected-copy-id",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "preproduction",
  nodeId: "d0000000-0000-4000-8000-000000000001",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Selected venue", taxId: "89890001K" },
  venueName: "Selected venue",
};
function request(headers: Record<string, string> = {}, body: Uint8Array = new Uint8Array([1, 2])) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-recovery-key": "archive-key",
      "x-waitron-restore-environment": "preproduction",
      ...headers,
    },
    body: new Uint8Array(body),
  };
}
it("returns selected-copy metadata without staging or restarting and keeps it out of caches", async () => {
  const app = new Hono();
  const stage = vi.fn();
  const restart = vi.fn();
  const log = vi.fn();
  const read = vi.fn(async () => preview);
  mountSetup(
    app,
    {
      environment: "preproduction",
      receiveArchive,
      previewRestore: read,
      stageRestore: stage,
      requestRestart: restart,
    },
    log,
  );
  const response = await app.request("/setup-api/restore/preview", request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(preview);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(read).toHaveBeenCalledWith({
    kind: "archive-file",
    artifactPath: expect.stringContaining("upload-"),
    recoveryKey: "archive-key",
    environment: "preproduction",
  });
  expect(stage).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain("archive-key");
});
it.each([
  [{ "content-type": "application/json" }, new Uint8Array([1]), "artifact"],
  [{}, new Uint8Array(), "artifact"],
  [{ "x-waitron-recovery-key": "" }, new Uint8Array([1]), "recoveryKey"],
  [{ "x-waitron-restore-environment": "dev" }, new Uint8Array([1]), "environment"],
] as const)(
  "refuses invalid preview input before opening any copy (%j)",
  async (headers, body, field) => {
    const app = new Hono();
    const read = vi.fn(async () => preview);
    mountSetup(
      app,
      { environment: "preproduction", receiveArchive, previewRestore: read },
      () => {},
    );
    const response = await app.request("/setup-api/restore/preview", request(headers, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field } },
    });
    expect(read).not.toHaveBeenCalled();
  },
);
it.each([
  ["recovery.passphrase_invalid", 422],
  ["restore.environment_mismatch", 409],
  ["restore.schema_too_new", 409],
] as const)("preserves %s and releases the gate after a refusal", async (code, status) => {
  const app = new Hono();
  const read = vi.fn().mockRejectedValueOnce(new AppError(code, {})).mockResolvedValue(preview);
  mountSetup(app, { environment: "preproduction", receiveArchive, previewRestore: read }, () => {});
  const response = await app.request("/setup-api/restore/preview", request());
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, params: {} } });
  expect((await app.request("/setup-api/restore/preview", request())).status).toBe(200);
});
it("reports unavailable preview without opening a backup", async () => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, () => {});
  const response = await app.request("/setup-api/restore/preview", request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});
it("previews the received file and disposes it after validation", async () => {
  const app = new Hono();
  const dispose = vi.fn(async () => {});
  const received = {
    artifactPath: "/owned/upload/artifact",
    byteLength: 2,
    fields: new Map(),
    dispose,
  };
  const read = vi.fn(async () => preview);
  mountSetup(
    app,
    {
      environment: "preproduction",
      previewRestore: read,
      receiveArchive: async () => received,
    },
    () => {},
  );
  const response = await app.request("/setup-api/restore/preview", request());
  expect(response.status).toBe(200);
  expect(read).toHaveBeenCalledWith({
    kind: "archive-file",
    artifactPath: received.artifactPath,
    recoveryKey: "archive-key",
    environment: "preproduction",
  });
  expect(dispose).toHaveBeenCalledOnce();
});
it("refuses an upload declared above 4 GiB as capacity before validation", async () => {
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(app, { environment: "preproduction", receiveArchive, previewRestore: read }, () => {});
  const response = await app.request(
    "/setup-api/restore/preview",
    request({ "content-length": String(4 * 1024 ** 3 + 1) }),
  );
  expect(response.status).toBe(507);
  expect(await response.json()).toEqual({
    error: { code: "restore.archive_resource_limit", params: {} },
  });
  expect(read).not.toHaveBeenCalled();
});
it("reports a missing archive receiver as unavailable", async () => {
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(app, { environment: "preproduction", previewRestore: read }, () => {});
  const response = await app.request("/setup-api/restore/preview", request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  expect(read).not.toHaveBeenCalled();
});
