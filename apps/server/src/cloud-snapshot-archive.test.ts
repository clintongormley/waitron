import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive } from "./backup-archive.js";
import { createCloudSnapshotArchive } from "./cloud-snapshot-archive.js";
const db = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it("builds an encrypted real SQLite archive with module versions and no Cloud credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-archive-"));
  dirs.push(root);
  for (const path of RECOVERY_FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path + " contents");
  }
  await writeFile(join(root, "cloud-connection.json"), "private installation key");
  await mkdir(join(root, "cloud-tls"));
  await writeFile(join(root, "cloud-tls/staff.key"), "private staff key");
  const at = new Date("2026-09-24T12:00:00Z");
  const result = await createCloudSnapshotArchive(
    { db: db.db, modules: ALL_MODULES, environment: "preproduction", stateDir: root },
    "recovery key",
    at,
    new AbortController().signal,
  );
  const entries = new Map(
    unpackArchive(decryptArtifact(result.bytes, "recovery key")).map((e) => [
      e.name,
      Buffer.from(e.bytes),
    ]),
  );
  expect(entries.get("db.dump")!.subarray(0, 16).toString()).toBe("SQLite format 3\0");
  expect(JSON.parse(entries.get("manifest.json")!.toString())).toMatchObject({
    createdAt: at.toISOString(),
    modules: result.modules,
    environment: "preproduction",
  });
  expect(result.modules.core).toBeGreaterThan(0);
  expect(entries.get("secrets/secrets.env")!.toString()).toBe("secrets.env contents");
  expect(
    [...entries.keys()].some((k) => k.includes("cloud-connection") || k.includes("cloud-tls")),
  ).toBe(false);
  expect(await readdir(join(root, "cloud-snapshots"))).toEqual([]);
  const c = new AbortController();
  c.abort();
  await expect(
    createCloudSnapshotArchive(
      { db: db.db, modules: ALL_MODULES, environment: "preproduction", stateDir: root },
      "key",
      at,
      c.signal,
    ),
  ).rejects.toThrow();
});

it("refuses an oversized SQLite copy and removes its plaintext staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-oversize-"));
  dirs.push(root);
  for (const path of RECOVERY_FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "state");
  }
  const { open } = await import("node:fs/promises");
  const archive = vi.spyOn(db.db, "archiveTo").mockImplementationOnce(async (path) => {
    const file = await open(path, "w");
    try {
      await file.truncate(513 * 1024 * 1024);
    } finally {
      await file.close();
    }
  });
  try {
    await expect(
      createCloudSnapshotArchive(
        { db: db.db, modules: ALL_MODULES, environment: "preproduction", stateDir: root },
        "key",
        new Date(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await readdir(join(root, "cloud-snapshots"))).toEqual([]);
  } finally {
    archive.mockRestore();
  }
});
