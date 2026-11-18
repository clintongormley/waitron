import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { withTransaction } from "@waitron/db";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { BACKUP_STAGING_DIR } from "@waitron/store";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { decryptArtifact } from "./artifact-cipher.js";
import * as compression from "./backup-compression.js";
import { dumpFileName } from "./backup-keys.js";
import { createStagingTurn } from "./backup-staging-turn.js";
import { createSpaceFreer, type FreedSpace } from "./free-space-now.js";
import { unpackArchive } from "./backup-archive.js";
import { captureCloudArchive, runCloudArchive } from "./testing/cloud-archive.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { uploadCloudCaptureFile } from "./cloud-backup-upload.js";
const db = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it("keeps packing and uploads when Box status frees shared staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-archive-"));
  dirs.push(root);
  for (const path of RECOVERY_FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path + " contents");
  }
  await mkdir(join(root, "cloud"), { recursive: true });
  await writeFile(join(root, "cloud/connection.json"), "private installation key");
  await mkdir(join(root, "cloud-tls"));
  await writeFile(join(root, "cloud-tls/staff.key"), "private staff key");
  const at = new Date("2026-09-24T12:00:00Z");
  const staging = createStagingTurn();
  const stagingDir = join(root, BACKUP_STAGING_DIR);
  const leftover = join(stagingDir, dumpFileName(new Date("2026-09-23T12:00:00Z")));
  await mkdir(stagingDir, { recursive: true });
  await writeFile(leftover, "leftover");
  const free = createSpaceFreer({
    stateDir: root,
    logDir: join(root, "logs"),
    venueDir: root,
    now: () => at,
    staging,
    backupDirs: () => [],
    disk: { noted: () => false, full: async () => false },
    space: { record: () => {} },
    log: () => {},
  });
  let removed: FreedSpace | undefined;
  let copySizes: [number, number] | undefined;
  const compress = compression.compressArchive;
  const runFree = vi
    .spyOn(compression, "compressArchive")
    .mockImplementationOnce((source, signal) =>
      compress(
        (async function* () {
          for await (const bytes of source) {
            if (removed === undefined) {
              const scratch = join(root, "scratch");
              const folder = (await readdir(scratch)).find((name) =>
                name.startsWith("cloud-copy-"),
              )!;
              const copy = join(scratch, folder, dumpFileName(at));
              const before = (await stat(copy)).size;
              removed = await free("box-administrator");
              copySizes = [before, (await stat(copy)).size];
            }
            yield bytes;
          }
        })(),
        signal,
      ),
    );
  let ciphertext: Buffer | undefined;
  const result = await runCloudArchive(
    {
      db: db.db,
      node: db.node,
      modules: ALL_MODULES,
      environment: "preproduction",
      stateDir: root,
      stagingDir,
      stagingTurn: staging,
    },
    "recovery key",
    at,
    new AbortController().signal,
    async (_, file) => {
      expect(await readdir(join(root, "scratch"))).toEqual(["backup"]);
      ciphertext = await readFile(file);
    },
  ).finally(() => runFree.mockRestore());
  expect(removed).toMatchObject({ deleted: 1, freedBytes: 8, failed: 0, backupRunning: false });
  await expect(stat(leftover)).rejects.toMatchObject({ code: "ENOENT" });
  expect(copySizes?.[0]).toBeGreaterThan(0);
  expect(copySizes?.[1]).toBe(copySizes?.[0]);
  const entries = new Map(
    unpackArchive(gunzipSync(decryptArtifact(ciphertext!, "recovery key"))).map((e) => [
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
  expect(await readdir(join(root, "cloud/snapshots"))).toEqual(["state.json"]);
  expect(await readdir(join(root, "scratch"))).toEqual(["backup"]);
});

it("refuses an oversized SQLite copy and removes its private scratch copy", async () => {
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
      await file.truncate(4 * 1024 ** 3 + 1);
    } finally {
      await file.close();
    }
  });
  try {
    await expect(
      captureCloudArchive(
        {
          db: db.db,
          node: db.node,
          modules: ALL_MODULES,
          environment: "preproduction",
          stateDir: root,
          stagingDir: join(root, BACKUP_STAGING_DIR),
        },
        "key",
        new Date(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await readdir(join(root, "scratch"))).toEqual(["backup"]);
  } finally {
    archive.mockRestore();
  }
});

it("lets a node copy still writing into staging finish before it clears staging and rejects with the state read's own failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapshot-busy-copy-"));
  dirs.push(root);
  for (const path of RECOVERY_FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "state");
  }
  // A directory where a state file should be: reading it fails with EISDIR.
  await rm(join(root, "secrets.env"));
  await mkdir(join(root, "secrets.env"));
  let copyFinished = false;
  const copy = vi.spyOn(db.node, "archiveTo").mockImplementationOnce(async (path) => {
    for (let part = 0; part < 10; part += 1) {
      await writeFile(join(dirname(path), `part-${part}`), "x");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await writeFile(path, "NODE");
    copyFinished = true;
  });
  try {
    await expect(
      captureCloudArchive(
        {
          db: db.db,
          node: db.node,
          modules: ALL_MODULES,
          environment: "preproduction",
          stateDir: root,
          stagingDir: join(root, BACKUP_STAGING_DIR),
        },
        "key",
        new Date(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(copyFinished).toBe(true);
    expect(await readdir(join(root, "scratch"))).toEqual([]);
  } finally {
    copy.mockRestore();
  }
});

it.runIf(process.env.WAITRON_LARGE_CLOUD_BACKUP_TEST === "1")(
  "uploads and publishes ciphertext over 512 MiB from a real SQLite copy",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "snapshot-large-sqlite-"));
    dirs.push(root);
    for (const path of RECOVERY_FILES) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "state");
    }
    await withTransaction(db.db, async (tx) => {
      await tx.run(sql`create table large_capture_fixture (payload blob)`);
      for (let row = 0; row < 65; row++)
        await tx.run(
          sql`insert into large_capture_fixture values (randomblob(${8 * 1024 * 1024}))`,
        );
    });
    const fixtureRssKiB = process.resourceUsage().maxRSS;
    if (process.env.WAITRON_LARGE_CLOUD_BACKUP_BASELINE === "1") {
      console.log("SQLite fixture peak RSS (KiB)", fixtureRssKiB);
      return;
    }

    const tls = mintSelfSignedServerCert({
      hostnames: ["localhost"],
      ipAddresses: ["127.0.0.1"],
      now: new Date(),
    });
    let receipt: { size: number; digest: string } | undefined;
    const server = createServer(
      { key: tls.serverKeyPem, cert: tls.serverCertPem },
      async (request, response) => {
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          hash.update(chunk);
        }
        receipt = { size, digest: hash.digest("hex") };
        response.end();
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
    const stagingDir = join(root, BACKUP_STAGING_DIR);
    const copy = db.db.archiveTo.bind(db.db);
    const archive = vi.spyOn(db.db, "archiveTo").mockImplementationOnce(async (path) => {
      await copy(path);
      const bytes = (await stat(path)).size;
      expect(bytes).toBeGreaterThan(512 * 1024 ** 2);
      console.log("SQLite copy", { bytes, peakRssKiB: process.resourceUsage().maxRSS });
    });
    try {
      const captured = await runCloudArchive(
        {
          db: db.db,
          node: db.node,
          modules: ALL_MODULES,
          environment: "preproduction",
          stateDir: root,
          stagingDir,
        },
        "recovery key",
        new Date(),
        new AbortController().signal,
        async (grant, file, metadata) => {
          expect(await readdir(join(root, "scratch"))).toEqual(["backup"]);
          await uploadCloudCaptureFile(
            { ...grant, location: { ...grant.location, endpoint } },
            file,
            metadata,
            { ca: tls.caCertPem },
          );
        },
      );
      expect(captured.size).toBeGreaterThan(512 * 1024 ** 2);
      expect(receipt).toEqual({ size: captured.size, digest: captured.digest });
      expect(await readdir(join(root, "cloud/snapshots"))).toEqual(["state.json"]);
      console.log("Ciphertext received over HTTPS", receipt);
      console.log("Peak RSS (KiB)", {
        fixture: fixtureRssKiB,
        end: process.resourceUsage().maxRSS,
      });
    } finally {
      archive.mockRestore();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(await readdir(stagingDir)).toEqual([]);
      expect(await readdir(join(root, "scratch"))).toEqual(["backup"]);
    }
  },
  120_000,
);
