import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { PgRestoreRunner } from "./pg-restore.js";
import type { Logger } from "./logger.js";
import {
  invokeRestoreHooks,
  restoreDatabase,
  restoreFromArtifact,
  restoreMedia,
  restoreSecrets,
} from "./restore.js";

const KEY = "correct horse battery staple";
const noopLog: Logger = () => {};

const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  environment: "preproduction",
  modules: {},
};

const DUMP = Buffer.from("PGDMP-fake-custom-format-dump");
const MEDIA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]); // jpeg-ish binary
const SECRET = "WAITRON_VAULT_MASTER_KEY=deadbeef\n";

function buildArtifact(
  entries: ArchiveEntry[],
  manifest: BackupManifest | "omit" = MANIFEST,
): Uint8Array {
  const all: ArchiveEntry[] = [];
  if (manifest !== "omit") {
    all.push({ name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) });
  }
  all.push(...entries);
  return encryptArtifact(packArchive(all), KEY);
}

const FULL_ENTRIES: ArchiveEntry[] = [
  { name: "db.dump", bytes: DUMP },
  { name: "media/abc123.jpg", bytes: MEDIA },
  { name: "secrets/secrets.env", bytes: Buffer.from(SECRET) },
];

// Shared per-test temp dirs for the two describe blocks below. `useTempDirs` is called inside each
// describe body, so the beforeEach/afterEach it registers bind to THAT suite; the blocks differ only
// in the mkdtemp prefix. Module-level so bare `mediaDir`/`stateDir`/`stagingDir` references in both
// blocks resolve here — the tempdir setup lives in one place, not two byte-identical copies.
let mediaDir: string;
let stateDir: string;
let stagingDir: string;

function useTempDirs(prefix: string): void {
  beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), `${prefix}media-`));
    stateDir = await mkdtemp(join(tmpdir(), `${prefix}state-`));
    stagingDir = await mkdtemp(join(tmpdir(), `${prefix}staging-`));
  });
  afterEach(async () => {
    for (const dir of [mediaDir, stateDir, stagingDir]) {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

describe("restoreFromArtifact", () => {
  useTempDirs("waitron-restore-");
  let restored: { databaseUrl: string; inFile: string; bytes: Uint8Array } | undefined;
  let runRestore: PgRestoreRunner;

  beforeEach(() => {
    restored = undefined;
    runRestore = vi.fn(async ({ databaseUrl, inFile }) => {
      // Read the staged file AT restore time — the orchestrator cleans staging afterwards.
      restored = { databaseUrl, inFile, bytes: await readFile(inFile) };
    });
  });

  function deps(overrides: Partial<Parameters<typeof restoreFromArtifact>[0]> = {}) {
    return {
      artifact: buildArtifact(FULL_ENTRIES),
      recoveryKey: KEY,
      databaseUrl: "postgres://admin@localhost/fresh",
      mediaDir,
      stateDir,
      stagingDir,
      migrationsRoot: null as string | null,
      modules: ALL_MODULES,
      environment: "preproduction" as const,
      runRestore,
      log: noopLog,
      ...overrides,
    };
  }

  it("restores db dump, media and secrets, then cleans staging", async () => {
    await restoreFromArtifact(deps());

    // DB dump reached the runner, byte-for-byte, under the target connection.
    expect(runRestore).toHaveBeenCalledTimes(1);
    expect(restored?.databaseUrl).toBe("postgres://admin@localhost/fresh");
    expect(restored?.bytes).toEqual(DUMP);

    // Media landed in mediaDir (prefix stripped), byte-for-byte.
    expect(await readFile(join(mediaDir, "abc123.jpg"))).toEqual(MEDIA);

    // Secret landed in stateDir (prefix stripped).
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);

    // Staging cleaned in finally.
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates its own destination roots (staging/media/state) when they do not yet exist", async () => {
    // A fresh/returning box may not carry `<stateDir>/restore-staging`, its media store, or its
    // state dir. Restore must create each before the guard `realpath`s it — otherwise the guard
    // ENOENTs, and via `runRejoin` that happens AFTER the irreversible wipe (wiped-but-not-restored).
    // Point all three roots at not-yet-existing subpaths and assert the restore SUCCEEDS. Proven by
    // deletion: remove the three `mkdir`s in restore.ts and this fails with ENOENT from `realpath`.
    const newStaging = join(stagingDir, "restore-staging");
    const newMedia = join(mediaDir, "media-store");
    const newState = join(stateDir, "state-store");
    await restoreFromArtifact(
      deps({ stagingDir: newStaging, mediaDir: newMedia, stateDir: newState }),
    );

    expect(runRestore).toHaveBeenCalledTimes(1); // db restored — staging dir was created
    expect(await readFile(join(newMedia, "abc123.jpg"))).toEqual(MEDIA); // media dir was created
    expect(await readFile(join(newState, "secrets.env"), "utf8")).toBe(SECRET); // state dir was created
    await expect(stat(join(newStaging, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" }); // cleaned
  });

  it("skips secrets when skipSecrets is true (keeps own identity), still restores db+media", async () => {
    await restoreFromArtifact(deps({ skipSecrets: true }));
    // db restored (pg_restore fake called) and media restored …
    expect(runRestore).toHaveBeenCalledTimes(1);
    expect(await readFile(join(mediaDir, "abc123.jpg"))).toEqual(MEDIA);
    // … but the secret was NOT written — the node keeps its own identity
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
    // staging still cleaned
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans staging even when pg_restore throws", async () => {
    const boom: PgRestoreRunner = vi.fn(async () => {
      throw new Error("pg_restore failed");
    });
    await expect(restoreFromArtifact(deps({ runRestore: boom }))).rejects.toThrow(
      "pg_restore failed",
    );
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an incompatible manifest BEFORE any restore or write", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, environment: "production" });
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.environment_mismatch",
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a schema-too-new manifest via the gate (versions read from code)", async () => {
    // core's real applied version in the archive is impossibly high, so the gate — fed the target's
    // own `expectedSchemaVersion(core.migrations, null)` computed from the module list — refuses.
    const artifact = buildArtifact(FULL_ENTRIES, { ...MANIFEST, modules: { core: 99999 } });
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.schema_too_new",
    });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("refuses a traversal entry name BEFORE any restore or write", async () => {
    const evil: ArchiveEntry[] = [
      { name: "db.dump", bytes: DUMP },
      { name: "media/../../evil.jpg", bytes: MEDIA },
    ];
    await expect(
      restoreFromArtifact(deps({ artifact: buildArtifact(evil) })),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("throws archive_incomplete when manifest.json is absent", async () => {
    const artifact = buildArtifact(FULL_ENTRIES, "omit");
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "manifest.json" },
    });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("throws archive_incomplete when db.dump is absent", async () => {
    const artifact = buildArtifact([{ name: "media/abc123.jpg", bytes: MEDIA }]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "db.dump" },
    });
    expect(runRestore).not.toHaveBeenCalled();
  });

  it("rejects an unrecognised top-level entry (fail-visible) BEFORE any restore or write", async () => {
    // A future second non-DB source id would pack `<source>/...` blobs the orchestrator does not
    // route. Today it must fail LOUD rather than silently drop the entry (CLAUDE.md §5) — proven
    // here with a `documents/x` entry alongside a valid `db.dump`.
    const artifact = buildArtifact([
      { name: "db.dump", bytes: DUMP },
      { name: "documents/x", bytes: Buffer.from("orphan") },
    ]);
    await expect(restoreFromArtifact(deps({ artifact }))).rejects.toMatchObject({
      code: "restore.unexpected_entry",
      params: { name: "documents/x" },
    });
    expect(runRestore).not.toHaveBeenCalled();
    await expect(stat(join(mediaDir, "abc123.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("restore steps (R3 composition)", () => {
  useTempDirs("waitron-step-");

  it("restoreDatabase stages the dump and feeds it to the runner", async () => {
    let seen: Uint8Array | undefined;
    const runRestore: PgRestoreRunner = async ({ inFile }) => {
      seen = await readFile(inFile);
    };
    const staged = await restoreDatabase({
      dumpBytes: DUMP,
      stagingDir,
      databaseUrl: "postgres://x",
      runRestore,
      log: noopLog,
    });
    expect(seen).toEqual(DUMP);
    expect(staged).toBe(join(stagingDir, "db.dump"));
  });

  it("restoreDatabase rejects a runner but leaves the staged file for the caller to clean", async () => {
    const runRestore: PgRestoreRunner = async () => {
      throw new Error("nope");
    };
    await expect(
      restoreDatabase({
        dumpBytes: DUMP,
        stagingDir,
        databaseUrl: "postgres://x",
        runRestore,
        log: noopLog,
      }),
    ).rejects.toThrow("nope");
  });

  it("restoreMedia strips the prefix and writes each blob; guards traversal", async () => {
    await restoreMedia({
      entries: [{ name: "media/deadbeef.png", bytes: MEDIA }],
      mediaDir,
      log: noopLog,
    });
    expect(await readFile(join(mediaDir, "deadbeef.png"))).toEqual(MEDIA);

    await expect(
      restoreMedia({
        entries: [{ name: "media/../escape.png", bytes: MEDIA }],
        mediaDir,
        log: noopLog,
      }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
  });

  it("restoreMedia catches a symlinked-parent escape", async () => {
    // A pre-existing mediaDir/sub -> /outside symlink: a lexically-fine name still escapes.
    const outside = await mkdtemp(join(tmpdir(), "waitron-outside-"));
    await symlink(outside, join(mediaDir, "sub"));
    await expect(
      restoreMedia({
        entries: [{ name: "media/sub/x.png", bytes: MEDIA }],
        mediaDir,
        log: noopLog,
      }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    await rm(outside, { recursive: true, force: true });
  });

  it("restoreSecrets strips the prefix and writes via unpackBundleToDir", async () => {
    await restoreSecrets({
      entries: [
        { name: "secrets/secrets.env", bytes: Buffer.from(SECRET) },
        { name: "secrets/tls/ca.crt", bytes: Buffer.from("CERT") },
      ],
      stateDir,
      log: noopLog,
    });
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(SECRET);
    expect(await readFile(join(stateDir, "tls", "ca.crt"), "utf8")).toBe("CERT");
  });
});

describe("invokeRestoreHooks", () => {
  it("calls each module's backup.restore hook (v1: none in ALL_MODULES)", async () => {
    const hook = vi.fn();
    const withHook = { name: "x", backup: { restore: hook } } as unknown as WaitronModule;
    const withoutHook = { name: "y", backup: {} } as unknown as WaitronModule;
    const bare = { name: "z" } as unknown as WaitronModule;

    await invokeRestoreHooks({
      modules: [withHook, withoutHook, bare],
      mediaDir: "/m",
      stateDir: "/s",
      log: () => {},
    });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({
      mediaDir: "/m",
      stateDir: "/s",
      log: expect.any(Function),
    });
  });

  it("is a no-op for an empty module list", async () => {
    await expect(
      invokeRestoreHooks({ modules: [], mediaDir: "/m", stateDir: "/s", log: () => {} }),
    ).resolves.toBeUndefined();
  });
});
