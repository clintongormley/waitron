import { useSetupArchiveUpload } from "./testing/setup-archive-upload.js";
import { Hono } from "hono";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { AppError, encodeMasterKeyCode } from "@waitron/shared";
import { decryptArtifactUnderBackupKey } from "./artifact-cipher.js";
import { backupArchiveKey } from "./backup-keys.js";
import { receiveRestoreArchive } from "./drive-backup-files.js";
import { mountSetup } from "./setup-api.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import { heldBackupKey, heldBackupKeyName } from "./testing/backup-key.js";
import { masterKeyArchiveBytes } from "./testing/master-key-archive.js";

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
const MASTER_KEY = makeMasterKey();
const MASTER_KEY_TEXT = encodeMasterKeyCode(MASTER_KEY);
const PLAINTEXT = Uint8Array.from([1, 2]);
// Backup key 2, so a route that took backup key 1 would not open it.
const ARCHIVE = masterKeyArchiveBytes(PLAINTEXT, MASTER_KEY, 2);
const OPENING_KEY = heldBackupKey(MASTER_KEY, 2).key;
function request(headers: Record<string, string> = {}, body: Uint8Array = ARCHIVE) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-master-key": MASTER_KEY_TEXT,
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
    recoveryKey: OPENING_KEY,
    environment: "preproduction",
  });
  expect(stage).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain(MASTER_KEY_TEXT);
  expect(JSON.stringify(log.mock.calls)).not.toContain(OPENING_KEY);
});
it("preview takes a drive file where it lies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "setup-preview-drive-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "drives");
  const staging = join(dir, "scratch");
  const name = backupArchiveKey(new Date("2026-06-01T10:00:00Z"), { nodeId: preview.nodeId });
  await mkdir(join(root, "sda1", "backups"), { recursive: true });
  await mkdir(staging);
  await writeFile(join(root, "sda1", "backups", name), ARCHIVE);
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(
    app,
    {
      environment: "preproduction",
      receiveArchive: receiveRestoreArchive(staging, root),
      previewRestore: read,
    },
    () => {},
  );
  const response = await app.request("/setup-api/restore/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: { drive: "sda1", path: `backups/${name}` },
      masterKey: MASTER_KEY_TEXT,
      environment: "preproduction",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(preview);
  expect(read).toHaveBeenCalledWith({
    kind: "archive-file",
    artifactPath: join(root, "sda1", "backups", name),
    recoveryKey: OPENING_KEY,
    environment: "preproduction",
  });
  expect(await readdir(staging)).toEqual([]);
});
it("Review backup opens a backup file with the master key", async () => {
  const app = new Hono();
  const opened: Buffer[] = [];
  const read = vi.fn(async (source: { recoveryKey: string }) => {
    opened.push(
      decryptArtifactUnderBackupKey(ARCHIVE, Buffer.from(source.recoveryKey, "base64url")),
    );
    return preview;
  });
  mountSetup(app, { environment: "preproduction", receiveArchive, previewRestore: read }, () => {});
  const response = await app.request("/setup-api/restore/preview", request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(preview);
  expect(opened).toEqual([Buffer.from(PLAINTEXT)]);
});
it("a wrong master key at Review is refused naming the backup's key", async () => {
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(app, { environment: "preproduction", receiveArchive, previewRestore: read }, () => {});
  const response = await app.request(
    "/setup-api/restore/preview",
    request({ "x-waitron-master-key": encodeMasterKeyCode(makeMasterKey()) }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "promotion.break_glass_invalid",
      params: {
        masterKeyId: masterKeyId(sealingPublicKey(MASTER_KEY)).toString("hex"),
        keyNumber: 2,
        keyName: heldBackupKeyName(MASTER_KEY),
      },
    },
  });
  expect(read).not.toHaveBeenCalled();
  expect((await app.request("/setup-api/restore/preview", request())).status).toBe(200);
});
it("a missing master key marks the field masterKey, and a backup key alone is not one", async () => {
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(app, { environment: "preproduction", receiveArchive, previewRestore: read }, () => {});
  const withoutMasterKey: Record<string, string> = { ...request().headers };
  delete withoutMasterKey["x-waitron-master-key"];
  for (const headers of [
    withoutMasterKey,
    { ...withoutMasterKey, "x-waitron-recovery-key": OPENING_KEY },
  ]) {
    const response = await app.request("/setup-api/restore/preview", {
      ...request(),
      headers,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "masterKey" } },
    });
  }
  expect(read).not.toHaveBeenCalled();
});
it("refuses a master key over 4,096 bytes as masterKey before opening any copy", async () => {
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(app, { environment: "preproduction", receiveArchive, previewRestore: read }, () => {});
  const response = await app.request(
    "/setup-api/restore/preview",
    request({ "x-waitron-master-key": "A".repeat(4097) }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "masterKey" } },
  });
  expect(read).not.toHaveBeenCalled();
});
it.each([
  [{ "content-type": "text/plain" }, new Uint8Array([1]), "artifact"],
  [{}, new Uint8Array(), "artifact"],
  [{ "x-waitron-master-key": "" }, new Uint8Array([1]), "masterKey"],
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
it.each<[string, (file: object) => Record<string, unknown>, string]>([
  ["no file", () => ({ masterKey: MASTER_KEY_TEXT, environment: "preproduction" }), "file"],
  [
    "a file outside the drive",
    (file) => ({
      file: { ...file, path: `../sdb1/${(file as { path: string }).path}` },
      masterKey: MASTER_KEY_TEXT,
      environment: "preproduction",
    }),
    "file",
  ],
  ["no master key", (file) => ({ file, environment: "preproduction" }), "masterKey"],
  [
    "an unknown environment",
    (file) => ({ file, masterKey: MASTER_KEY_TEXT, environment: "dev" }),
    "environment",
  ],
  [
    "a key the route does not take",
    (file) => ({ file, masterKey: MASTER_KEY_TEXT, environment: "preproduction", extra: "x" }),
    "body",
  ],
])("refuses a drive preview with %s before opening any copy", async (_label, body, field) => {
  const dir = await mkdtemp(join(tmpdir(), "setup-preview-drive-refused-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "drives");
  const staging = join(dir, "scratch");
  const name = backupArchiveKey(new Date("2026-06-01T10:00:00Z"), { nodeId: preview.nodeId });
  await mkdir(join(root, "sda1"), { recursive: true });
  await mkdir(staging);
  await writeFile(join(root, "sda1", name), ARCHIVE);
  const app = new Hono();
  const read = vi.fn(async () => preview);
  mountSetup(
    app,
    {
      environment: "preproduction",
      receiveArchive: receiveRestoreArchive(staging, root),
      previewRestore: read,
    },
    () => {},
  );
  const response = await app.request("/setup-api/restore/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body({ drive: "sda1", path: name })),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field } },
  });
  expect(read).not.toHaveBeenCalled();
  expect(await readdir(staging)).toEqual([]);
});
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
  const dir = await mkdtemp(join(tmpdir(), "setup-preview-received-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "artifact"), ARCHIVE);
  const received = {
    artifactPath: join(dir, "artifact"),
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
    recoveryKey: OPENING_KEY,
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
