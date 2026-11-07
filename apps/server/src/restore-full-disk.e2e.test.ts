// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_RESTORE names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { existsSync, realpathSync } from "node:fs";
import nativeFs, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { encryptArtifact } from "./artifact-cipher.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { formatEnvFile } from "./env-file.js";
import { ALL_MODULES } from "./modules.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";
import { restoreFromArtifact } from "./restore.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";

const KIB = 1024;
const MIB = 1024 * KIB;
const KEY = "correct horse battery staple";
const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  environment: "preproduction",
  modules: {},
};
const identity = (nodeId: string) =>
  formatEnvFile({
    WAITRON_NODE_ID: nodeId,
    DATABASE_URL: "postgres://app@localhost/waitron",
    WAITRON_MIGRATIONS_DATABASE_URL: "postgres://owner@localhost/waitron",
    WAITRON_ENV: "preproduction",
  });
const ARCHIVE_IDENTITY = identity("c0000000-0000-4000-8000-000000000008");
const OLD_IDENTITY = identity("c0000000-0000-4000-8000-0000000000aa");
const OLD_SECRET = "WAITRON_VAULT_MASTER_KEY=0ldbeef\n";
const OLD_VENUE = Buffer.from("SQLite format 3\u0000 — the box's own, never opened by this suite");

function databaseBytes(fillerBytes: number): Buffer {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("create table filler (bytes blob)");
    if (fillerBytes > 0)
      db.prepare("insert into filler values (?)").run(Buffer.alloc(fillerBytes, 7));
    return Buffer.from(db.serialize());
  } finally {
    db.close();
  }
}

function artifact(databaseFiller: number, extraSecrets: ArchiveEntry[] = []): Uint8Array {
  const entries: ArchiveEntry[] = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(MANIFEST)) },
    { name: "db.dump", bytes: databaseBytes(databaseFiller) },
    { name: "node.dump", bytes: databaseBytes(0) },
    { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_VAULT_MASTER_KEY=deadbeef\n") },
    { name: "secrets/trading.env", bytes: Buffer.from(ARCHIVE_IDENTITY) },
    ...extraSecrets,
  ];
  return encryptArtifact(packArchive(entries), KEY);
}

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;
let stagingDir: string | undefined;

beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_RESTORE", 32);
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK) console.warn(`restore full-disk tests SKIPPED: ${opened.reason}`);
});
afterEach(async () => {
  disk?.unfill();
  if (stagingDir !== undefined) await rm(stagingDir, { recursive: true, force: true });
  stagingDir = undefined;
});
afterAll(() => disk?.close());

function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

interface Box {
  stateDir: string;
  venueDir: string;
}

/** The state and venue folders on the small disk; the staging folder, which validation fills with
 * the decrypted copy, on the normal one. */
async function oldBox(small: SmallDisk, name: string): Promise<Box> {
  const root = realpathSync(small.folder(name));
  const box = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(box.stateDir, { mode: 0o700 });
  await mkdir(box.venueDir, { mode: 0o700 });
  await writeFile(join(box.venueDir, "venue.db"), OLD_VENUE);
  await writeFile(join(box.stateDir, "trading.env"), OLD_IDENTITY);
  await writeFile(join(box.stateDir, "secrets.env"), OLD_SECRET);
  stagingDir = await mkdtemp(join(tmpdir(), "waitron-restore-full-disk-staging-"));
  return box;
}

async function restore(box: Box, bytes: Uint8Array): Promise<unknown> {
  try {
    await restoreFromArtifact({
      artifact: bytes,
      recoveryKey: KEY,
      venueDir: box.venueDir,
      stateDir: box.stateDir,
      stagingDir: stagingDir!,
      migrationsRoot: null,
      modules: ALL_MODULES,
      environment: "preproduction",
      migrate: vi.fn(async () => {
        throw new Error("the restore placed its database");
      }),
      log: () => {},
    });
  } catch (error) {
    return error;
  }
  throw new Error("the restore did not fail");
}

async function expectOldBox(box: Box): Promise<void> {
  expect(await readFile(join(box.venueDir, "venue.db"))).toEqual(OLD_VENUE);
  expect(await readFile(join(box.stateDir, "trading.env"), "utf8")).toBe(OLD_IDENTITY);
  expect(await readFile(join(box.stateDir, "secrets.env"), "utf8")).toBe(OLD_SECRET);
  expect(existsSync(join(box.stateDir, "trading.env.replaced"))).toBe(false);
  expect(existsSync(join(box.stateDir, REBUILD_MARKER))).toBe(false);
  const working = [
    ...(await readdir(box.stateDir, { recursive: true })),
    ...(await readdir(box.venueDir, { recursive: true })),
  ].filter((name) => /\.(incoming|restore-previous)(\.tmp)?$/.test(name));
  expect(working).toEqual([]);
}

it("a disk too full for the secrets refuses before anything is replaced", async (ctx) => {
  const small = needDisk(ctx);
  const box = await oldBox(small, "secrets");
  const bytes = artifact(0, [
    { name: "secrets/tls/server.crt", bytes: Buffer.alloc(2 * MIB, "c") },
  ]);
  small.fill(512 * KIB);
  expect(small.free()).toBeGreaterThan(64 * KIB);
  expect(small.free()).toBeLessThan(MIB);

  const openedPaths: string[] = [];
  const realOpen = nativeFs.open;
  const spy = vi.spyOn(nativeFs, "open").mockImplementation(async (...args) => {
    openedPaths.push(String(args[0]));
    return realOpen(...args);
  });
  syncBuiltinESMExports();
  let thrown: unknown;
  try {
    thrown = await restore(box, bytes);
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
  }

  expect(thrown).toMatchObject({ code: "ENOSPC", syscall: "write" });
  // The rebuild marker is written before the secrets are staged; had it taken the failure, no
  // staged file would have been opened.
  expect(openedPaths.at(-1)).toBe(join(box.stateDir, "tls", "server.crt.incoming.tmp"));
  await expectOldBox(box);
}, 120_000);

it("a disk with room for the secrets but not the database puts the identity back", async (ctx) => {
  const small = needDisk(ctx);
  const box = await oldBox(small, "database");
  const bytes = artifact(4 * MIB);
  small.fill(MIB);
  expect(small.free()).toBeLessThan(4 * MIB);

  const thrown = await restore(box, bytes);

  // Staging is on the other filesystem, so the database is copied, not renamed.
  expect(thrown).toMatchObject({
    code: "ENOSPC",
    syscall: "copyfile",
    dest: join(box.venueDir, "venue.db.incoming"),
  });
  await expectOldBox(box);
}, 120_000);
