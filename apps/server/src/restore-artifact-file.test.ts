import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  invoiceSeries,
  locations,
  nodes,
  tenants,
  withTransaction,
  openVenueDatabase,
} from "@waitron/db";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { buildManifest } from "./backup-manifest.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { validateArtifactFile, restoreFromArtifactFile, type RestoreFileDeps } from "./restore.js";
import { runOnce } from "./backup-sweep.js";
import { parseBackupArchiveKey } from "./backup-keys.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { stageRestoreRequest, runStagedRestore } from "./restore-request.js";
import { runRestore } from "./restore-command.js";
import { AppError } from "@waitron/shared";
const guard = vi.hoisted(() => ({ forbidden: new Set<string>() }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (path: Parameters<typeof actual.readFile>[0], ...args: unknown[]) => {
      if (guard.forbidden.has(String(path))) throw new Error("whole artifact read");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preserve fs overload forwarding
      return (actual.readFile as any)(path, ...args);
    },
  };
});
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120000,
});
const ids = {
  location: "b7000000-0000-4000-8000-000000000001",
  node: "b7000000-0000-4000-8000-000000000002",
  series: "b7000000-0000-4000-8000-000000000003",
};
beforeAll(async () => {
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "File roundtrip" });
    await tx.insert(locations).values({
      id: ids.location,
      name: "File location",
      invoiceLocales: ["es"],
      operationDescription: "Venta",
    });
    await tx.insert(nodes).values({ id: ids.node, locationId: ids.location, name: "File node" });
    await tx.insert(invoiceSeries).values({ id: ids.series, nodeId: ids.node, code: "FILE" });
    await tx.insert(invoiceSeries).values({ nodeId: ids.node, code: "FULL", purpose: "full" });
  });
});
const dirs: string[] = [];
afterEach(async () => {
  guard.forbidden.clear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artifact-path-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  const stagingDir = join(root, "staging");
  await mkdir(stagingDir);
  await mkdir(stateDir);
  return {
    root,
    stateDir,
    stagingDir,
    venueDir: join(root, "venue"),
    migrationsRoot: null,
    modules: ALL_MODULES,
    environment: "preproduction" as const,
    recoveryKey: "key",
    artifactPath: join(root, "input.enc"),
    log: vi.fn(),
  };
}
async function artifact(f: Awaited<ReturnType<typeof fixture>>) {
  const database = join(f.root, "source.db");
  await suite.db.archiveTo(database);
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date("2026-10-06T00:00:00Z"),
  });
  const entries = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { name: "db.dump", bytes: await readFile(database) },
    {
      name: "secrets/trading.env",
      bytes: Buffer.from(
        `WAITRON_TILL_NODE_ID=${ids.node}\nWAITRON_TILL_LOCATION_ID=${ids.location}\n`,
      ),
    },
    {
      name: "secrets/secrets.env",
      bytes: Buffer.from(
        "WAITRON_CREDENTIALS_KEY=" +
          Buffer.alloc(32, 5).toString("base64") +
          "\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
      ),
    },
  ];
  const bytes = encryptArtifact(packArchive(entries), f.recoveryKey);
  await writeFile(f.artifactPath, bytes);
  return bytes;
}
it("validates one protected database, owns cleanup and retains the encrypted source", async () => {
  const f = await fixture();
  const input = await artifact(f);
  guard.forbidden.add(f.artifactPath);
  const validated = await validateArtifactFile(f);
  expect((await stat(validated.databasePath)).mode & 0o777).toBe(0o600);
  expect((await stat(join(validated.databasePath, ".."))).mode & 0o777).toBe(0o700);
  expect(await readdir(join(validated.databasePath, ".."))).toEqual(["venue.db"]);
  const opened = await openVenueDatabase(join(validated.databasePath, ".."));
  try {
    expect((await opened.venue.select().from(tenants))[0].legalName).toBe("File roundtrip");
  } finally {
    await opened.close();
  }
  await validated.discard();
  await validated.discard();
  expect(await readdir(f.stagingDir)).toEqual([]);
  guard.forbidden.clear();
  expect(await readFile(f.artifactPath)).toEqual(input);
});
it("authenticates before parsing and leaves no plaintext on tag refusal", async () => {
  const f = await fixture();
  const bad = encryptArtifact(Buffer.from("not JSON or WBA"), "key");
  bad[33] ^= 1;
  await writeFile(f.artifactPath, bad);
  await expect(validateArtifactFile(f)).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
  expect(await readdir(f.stagingDir)).toEqual([]);
  expect(await readdir(f.stateDir)).toEqual([]);
});
it("cleans authenticated malformed and duplicate archives without placing anything", async () => {
  const f = await fixture();
  const input = await artifact(f);
  const { decryptArtifact } = await import("./artifact-cipher.js");
  const { unpackArchive } = await import("./backup-archive.js");
  const entries = unpackArchive(decryptArtifact(input, "key"));
  await writeFile(f.artifactPath, encryptArtifact(packArchive([...entries, entries[1]]), "key"));
  await expect(restoreFromArtifactFile(f)).rejects.toMatchObject({
    code: "restore.unsafe_entry_path",
  });
  expect(await readdir(f.stagingDir)).toEqual([]);
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(f.artifactPath, encryptArtifact(Buffer.from("bad framing"), "key"));
  await expect(validateArtifactFile(f)).rejects.toMatchObject({ code: "backup.archive_invalid" });
  expect(await readdir(f.stagingDir)).toEqual([]);
});
it("disposes validation on source refusal before changing identity or database", async () => {
  const f = await fixture();
  await artifact(f);
  await writeFile(join(f.stateDir, "trading.env"), "old identity");
  const error = new AppError("restore.stream_source_live", { lastChangeAt: "now" });
  await expect(
    restoreFromArtifactFile({
      ...f,
      checkSourceLive: async (validated) => {
        const opened = await openVenueDatabase(join(validated.databasePath, ".."));
        try {
          expect((await opened.venue.select().from(tenants))[0].legalName).toBe("File roundtrip");
        } finally {
          await opened.close();
        }
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toBe("old identity");
  expect(await readdir(f.stagingDir)).toEqual([]);
});
it("roundtrips real SQLite and state through scheduled capture, local file storage and default file restore", async () => {
  const f = await fixture();
  const captureState = join(f.root, "capture");
  await mkdir(join(captureState, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(captureState, rel), `${rel}-content`);
  await writeFile(
    join(captureState, "trading.env"),
    `WAITRON_TILL_NODE_ID=${ids.node}\nWAITRON_TILL_LOCATION_ID=${ids.location}\n`,
  );
  const backend = new LocalFsBackend("file", join(f.root, "store"));
  const stamp = new Date("2026-10-06T00:00:00Z");
  guard.forbidden.add(join(f.stagingDir, "waitron-20261006T000000Z.dump"));
  await runOnce({
    ...f,
    stateDir: captureState,
    db: suite.db,
    backends: [backend],
    resolvers: {},
    retain: 3,
    retainDays: 30,
    destinationTimeoutMs: 60_000,
    signal: new AbortController().signal,
    now: () => stamp,
    archive: (path) => suite.db.archiveTo(path),
  });
  const keys = (await readdir(join(f.root, "store"))).filter(
    (name) => parseBackupArchiveKey(name)?.timestamp.getTime() === stamp.getTime(),
  );
  expect(keys).toHaveLength(1);
  const key = keys[0];
  guard.forbidden.add(join(f.root, "store", key));
  await backend.getFile(key, f.artifactPath, {
    signal: new AbortController().signal,
  });
  guard.forbidden.add(f.artifactPath);
  await restoreFromArtifactFile(f);
  const opened = await openVenueDatabase(f.venueDir);
  try {
    expect((await opened.venue.select().from(tenants))[0].legalName).toBe("File roundtrip");
  } finally {
    await opened.close();
  }
  expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe("secrets.env-content");
  expect(await readFile(join(f.stateDir, "tls/ca.key"), "utf8")).toBe("tls/ca.key-content");
  expect(await readdir(f.stagingDir)).toEqual([]);
  expect((await stat(f.artifactPath)).size).toBeGreaterThan(49);
});
it("CLI forwards an archive path through real file validation and preserves refusal wording", async () => {
  const f = await fixture();
  await artifact(f);
  guard.forbidden.add(f.artifactPath);
  const out: string[] = [];
  const restore = async (args: RestoreFileDeps) =>
    restoreFromArtifactFile({ ...args, migrationsRoot: null });
  expect(
    await runRestore({
      argv: ["restore", f.artifactPath, "--confirm-old-box-gone"],
      env: {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_BACKUP_RECOVERY_KEY: "key",
      },
      out: (line) => out.push(line),
      restore,
    }),
  ).toBe(0);
  expect(out.at(-1)).toBe(`restored ${f.artifactPath}`);
  const failed: string[] = [];
  expect(
    await runRestore({
      argv: ["restore", f.artifactPath],
      env: { WAITRON_STATE_DIR: f.stateDir, WAITRON_BACKUP_RECOVERY_KEY: "wrong" },
      out: (line) => failed.push(line),
      restore,
    }),
  ).toBe(1);
  expect(failed.at(-1)).toContain("wrong recovery key or corrupt artifact");
});
it("default staged archive keeps its payload on a real busy lock, then restores from the file on retry", async () => {
  const f = await fixture();
  const input = await artifact(f);
  await stageRestoreRequest(f.stateDir, {
    artifact: input,
    recoveryKey: "key",
    environment: "preproduction",
  });
  const staged = join(f.stateDir, "restore-request.artifact");
  guard.forbidden.add(staged);
  const before = await stat(staged);
  await mkdir(f.venueDir);
  const held = new DatabaseSync(join(f.venueDir, "venue.lock"));
  held.exec("begin immediate");
  try {
    await expect(runStagedRestore(f)).rejects.toMatchObject({
      code: "provisioning.database_in_use",
    });
  } finally {
    held.close();
  }
  expect((await stat(staged)).ino).toBe(before.ino);
  expect((await stat(staged)).size).toBe(before.size);
  expect(JSON.parse(await readFile(join(f.stateDir, "restore-request.json"), "utf8")).version).toBe(
    1,
  );
  expect(await runStagedRestore(f)).toBe(true);
  expect(await runStagedRestore(f)).toBe(false);
  const opened = await openVenueDatabase(f.venueDir);
  try {
    expect((await opened.venue.select().from(tenants))[0].legalName).toBe("File roundtrip");
  } finally {
    await opened.close();
  }
  expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toContain(
    "WAITRON_CREDENTIALS_KEY=",
  );
});
