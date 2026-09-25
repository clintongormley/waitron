import { mkdtempSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { openVenueDatabase, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { encodeRecoveryKit, type ObjectStore, type RecoveryKit } from "@waitron/stream";
import { describe, expect, it, vi } from "vitest";
import { encryptArtifact } from "./artifact-cipher.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import type { RestoreDeps, ValidatedArtifact } from "./restore.js";
import { runRestore } from "./restore-command.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import type { restoreFromStream, RestoredVenue } from "./restore-stream.js";

const RECOVERY_KEY = "s3cr3t-recovery-key-value";

const COLD_RESTORE_NOTICE =
  "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten (promotion runbook §5d)";

function makeArtifact(dir: string): Promise<string> {
  const artifactPath = join(dir, "backup.wrb");
  return writeFile(artifactPath, "not a real artifact, never decrypted in this suite").then(
    () => artifactPath,
  );
}

describe("waitron-restore restore", () => {
  it("returns 2 and prints usage on an unknown subcommand", async () => {
    const out: string[] = [];
    const code = await runRestore({
      argv: ["frobnicate", "x"],
      env: {},
      out: (line) => out.push(line),
    });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("returns 2 and prints usage when the artifact path is missing", async () => {
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore"],
      env: {},
      out: (line) => out.push(line),
    });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("returns 1 and names the variable when the recovery key is missing", async () => {
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", "/does/not/matter"],
      env: {},
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_BACKUP_RECOVERY_KEY/)]);
  });

  it("takes the default venue directory when WAITRON_VENUE_DIR is EMPTY, never the working directory", async () => {
    // The fail-closed rule the retired `WAITRON_RESTORE_DATABASE_URL` carried, in the shape a
    // DIRECTORY needs it. An empty string is a valid-looking value, not an absent one, and
    // `resolve("")` is wherever the operator happened to be standing when they ran the CLI — so an
    // empty value must take `<stateDir>/venue` (CLAUDE.md §3's "empty value is a valid value").
    const dir = mkdtempSync(join(tmpdir(), "restore-command-empty-venue-"));
    const artifactPath = await makeArtifact(dir);
    const stateDir = join(dir, "state");
    let received: RestoreDeps | undefined;
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: "",
      },
      out: () => {},
      restore: async (args) => {
        received = args;
      },
    });
    expect(code).toBe(0);
    expect(received?.venueDir).toBe(join(resolve(stateDir), "venue"));
    expect(received?.venueDir).not.toBe(resolve(""));
  });

  it("resolves an OVERRIDDEN venue directory to an absolute path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-venue-override-"));
    const artifactPath = await makeArtifact(dir);
    let received: RestoreDeps | undefined;
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_VENUE_DIR: join(dir, "elsewhere"),
      },
      out: () => {},
      restore: async (args) => {
        received = args;
      },
    });
    expect(code).toBe(0);
    expect(received?.venueDir).toBe(resolve(join(dir, "elsewhere")));
  });

  it("returns 1 and names the path when the artifact file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-missing-"));
    const artifactPath = join(dir, "does-not-exist.wrb");
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringContaining(artifactPath)]);
  });

  it("reads the artifact, resolves default dirs/environment/modules, calls the injected orchestrator, and returns 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-happy-"));
    const artifactPath = await makeArtifact(dir);
    let received: RestoreDeps | undefined;
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
      restore: async (args) => {
        received = args;
        // Exercise the `log` seam too: `restoreFromArtifact` reports progress through it
        // (`restore.db.placed`, `restore.secrets.done`, ...), and this confirms those structured
        // lines actually reach the operator via `out`, formatted, with no secret riding along.
        args.log("info", "restore.db.placed", { bytes: 123 });
      },
    });
    expect(code).toBe(0);
    expect(received).toBeDefined();
    expect(received?.recoveryKey).toBe(RECOVERY_KEY);
    expect(received?.venueDir).toBe(join(DEFAULT_STATE_ROOT, "venue"));
    expect(received?.stateDir).toBe(DEFAULT_STATE_ROOT);
    expect(received?.stagingDir).toBe(join(DEFAULT_STATE_ROOT, "restore-staging"));
    expect(received?.migrationsRoot).toBe(DEFAULT_MIGRATIONS_ROOT);
    expect(received?.modules).toBe(ALL_MODULES);
    expect(received?.environment).toBe("preproduction");
    expect(Buffer.from(received!.artifact).toString("utf8")).toBe(
      "not a real artifact, never decrypted in this suite",
    );
    expect(out).toEqual([
      COLD_RESTORE_NOTICE,
      expect.stringContaining("restore.db.placed"),
      `restored ${artifactPath}`,
    ]);
    // The recovery key never reaches the operator-facing output.
    expect(out.join("\n")).not.toContain(RECOVERY_KEY);
  });

  it("uses the real restoreFromArtifact when no orchestrator is injected", async () => {
    // No `deps.restore` here — exercises the DEFAULT wiring (`restoreFromArtifact` itself), all
    // the way through decrypt+unpack+the compatibility gate, WITHOUT ever placing a venue file:
    // the gate throws first (the target is `production` here, `WAITRON_ENV=production`, and this
    // artifact's manifest says `preproduction`), so no database file is written or touched. `WAITRON_MIGRATIONS_DIR` mirrors `boot.test.ts`'s own from-source fixture — the
    // gate reads each module's EXPECTED version off real, shipped migration folders
    // (`expectedSchemaVersion`), and `boot.ts`'s own default migrations root (`<src>/drizzle`)
    // only exists beside a built bundle, not run from source (see `DEFAULT_MIGRATIONS_ROOT`'s own
    // doc comment on `boot.ts`).
    const dir = mkdtempSync(join(tmpdir(), "restore-command-real-orchestrator-"));
    const migrationsRoot = await mkdtemp(join(tmpdir(), "restore-command-migrations-"));
    const fromSource = migrationOptionsFor(manifestSets(), null);
    for (const [index, set] of manifestSets().entries()) {
      await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    const manifest: BackupManifest = {
      manifestVersion: 1,
      createdAt: "2026-09-05T00:00:00.000Z",
      environment: "preproduction",
      modules: {},
    };
    const entries: ArchiveEntry[] = [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      {
        name: "db.dump",
        bytes: Buffer.from("SQLite format 3\u0000 — never opened: the gate refuses first"),
      },
    ];
    const artifactPath = join(dir, "backup.wrb");
    await writeFile(artifactPath, encryptArtifact(packArchive(entries), RECOVERY_KEY));
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "production",
      },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      COLD_RESTORE_NOTICE,
      expect.stringContaining("restore.environment_mismatch"),
    ]);
  });

  it("resolves overridden state/migrations dirs and environment from env, like boot does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-overrides-"));
    const artifactPath = await makeArtifact(dir);
    const stateDir = join(dir, "state");
    let received: RestoreDeps | undefined;
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_MIGRATIONS_DIR: "/custom/migrations",
        WAITRON_ENV: "production",
      },
      out: () => {},
      restore: async (args) => {
        received = args;
      },
    });
    expect(code).toBe(0);
    expect(received?.stateDir).toBe(resolve(stateDir));
    expect(received?.venueDir).toBe(join(resolve(stateDir), "venue"));
    expect(received?.stagingDir).toBe(join(resolve(stateDir), "restore-staging"));
    expect(received?.migrationsRoot).toBe("/custom/migrations");
    expect(received?.environment).toBe("production");
  });

  it("returns 1 (never rejects raw) on an invalid WAITRON_ENV", async () => {
    // `deploymentEnvironment` throws `server.config_invalid` for a WAITRON_ENV that is not
    // production/preproduction/dev. runRestore must RETURN 1 with a coded message, not throw. The
    // assertion is `.resolves` — a raw throw here fails the test outright.
    const dir = mkdtempSync(join(tmpdir(), "restore-command-bad-env-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    await expect(
      runRestore({
        argv: ["restore", artifactPath],
        env: {
          WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
          WAITRON_ENV: "garbage",
        },
        out: (line) => out.push(line),
      }),
    ).resolves.toBe(1);
    expect(out).toEqual([expect.stringContaining("server.config_invalid")]);
  });

  it("collapses a decrypt-phase AppError into one non-leaking message and returns 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-badkey-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
      restore: async () => {
        throw new AppError("recovery.passphrase_invalid", {});
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      COLD_RESTORE_NOTICE,
      "restore failed: wrong recovery key or corrupt artifact",
    ]);
  });

  it("reports a gate/guard AppError by code and returns 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-gate-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
      restore: async () => {
        throw new AppError("restore.environment_mismatch", {
          backup: "production",
          target: "preproduction",
        });
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      COLD_RESTORE_NOTICE,
      expect.stringContaining("restore.environment_mismatch"),
    ]);
  });

  it("names another process holding the venue folder as the reason, and returns 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-in-use-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: { WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY },
      out: (line) => out.push(line),
      restore: async () => {
        throw new AppError("provisioning.database_in_use", { database: "/var/lib/waitron/venue" });
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      COLD_RESTORE_NOTICE,
      "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)",
    ]);
  });

  it("reports an AppError outside restore/recovery/backup namespaces generically, never rethrown", async () => {
    // An AppError from some OTHER domain (here: a config error) must not propagate raw either.
    const dir = mkdtempSync(join(tmpdir(), "restore-command-other-apperror-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
      restore: async () => {
        throw new AppError("server.config_invalid", {
          variable: "x",
          reason: "not_a_deployment_environment",
        });
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual([COLD_RESTORE_NOTICE, "restore failed"]);
  });

  it("never echoes a raw error's .message, whatever the thrower put in it", async () => {
    // `runRestore`'s independent second layer: a raw error out of the orchestrator's chain is
    // reported as the fixed string `restore failed`, never by its message. The message below is a
    // secret-carrying one on purpose — nothing in the chain composes it, which is the point: this
    // function cannot know what a thrower wrote, so it prints none of it. A box operator's only
    // window is this terminal, and what reaches it is curated text chosen by code.
    const dir = mkdtempSync(join(tmpdir(), "restore-command-no-message-leak-"));
    const artifactPath = await makeArtifact(dir);
    const secretish = "S3CR3T-ADMIN-PASSWORD";
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
      restore: async () => {
        throw new Error(`EACCES: permission denied, open '/var/lib/waitron/${secretish}'`);
      },
    });
    expect(code).toBe(1);
    expect(out.join("\n")).not.toContain(secretish);
    expect(out).toEqual([COLD_RESTORE_NOTICE, "restore failed"]);
  });

  it("reports restore.hook_failed with the module and the inner code, never a message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-hook-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_ENV: "preproduction",
      },
      out: (line) => out.push(line),
      restore: async () => {
        throw new AppError("restore.hook_failed", {
          module: "fiscal-verifactu",
          code: "series.code_too_long",
        });
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      expect.stringMatching(/^cold restore: use only when no peer/),
      "restore failed: restore.hook_failed (module fiscal-verifactu: series.code_too_long)",
    ]);
  });
});

const KIT: RecoveryKit = {
  version: 1,
  venueId: "c0000000-0000-4000-8000-000000000002",
  bucket: {
    endpoint: "https://s3.example.net",
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "waitron/",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "not-a-real-secret-0123456789",
  },
  recoveryKey: "recovery-key-one-strong",
  pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
};

/** Where the kit's encoded body starts, after its fixed prefix. */
const KIT_TOKEN_START = "WAITRON-RECOVERY-KIT-1:".length;

const BUCKET_NOTICE =
  "cold restore from the bucket: use only when the old server is gone — two servers selling from one database cannot be reconciled";

type StreamDeps = Parameters<typeof restoreFromStream>[0];
type RestoreStreamFake = (deps: StreamDeps) => Promise<void>;
const VENUE: RestoredVenue = { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" };

async function kitFile(text = `Waitron recovery kit\n\n${encodeRecoveryKit(KIT)}\n`) {
  const dir = await mkdtemp(join(tmpdir(), "waitron-cli-kit-"));
  await writeFile(join(dir, "kit.txt"), text);
  return { dir, kitPath: join(dir, "kit.txt") };
}

/** Runs `restore --from-bucket` with a fake restore that throws `error`, and returns what it printed. */
async function refusedWith(error: unknown): Promise<{ code: number; out: string[] }> {
  const { dir, kitPath } = await kitFile();
  const out: string[] = [];
  const code = await runRestore({
    argv: ["restore", "--from-bucket", kitPath, "--confirm-venue", VENUE.taxId],
    env: { WAITRON_ENV: "preproduction", WAITRON_STATE_DIR: dir },
    out: (line) => out.push(line),
    restoreStream: async () => {
      throw error;
    },
  });
  return { code, out };
}

describe("waitron-restore restore --from-bucket", () => {
  it("reads the kit file, needs no recovery key in the environment, and runs the bucket restore", async () => {
    const { dir, kitPath } = await kitFile();
    const out: string[] = [];
    let received: StreamDeps | undefined;
    const code = await runRestore({
      argv: ["restore", "--from-bucket", kitPath, "--confirm-venue", VENUE.taxId],
      env: {
        WAITRON_ENV: "preproduction",
        WAITRON_STATE_DIR: dir,
        WAITRON_LITESTREAM_BIN: "/opt/litestream",
      },
      out: (line) => out.push(line),
      restoreStream: async (d) => {
        received = d;
        d.log("info", "restore.stream_prepared", { generation: "gen-3" });
      },
    });
    expect(code).toBe(0);
    expect(received).toMatchObject({
      kit: KIT,
      oldBoxGone: false,
      environment: "preproduction",
      stateDir: resolve(dir),
      venueDir: join(resolve(dir), "venue"),
      stagingDir: join(resolve(dir), "restore-staging"),
      migrationsRoot: DEFAULT_MIGRATIONS_ROOT,
      modules: ALL_MODULES,
      litestreamBin: "/opt/litestream",
    });
    expect(received!.now()).toBeInstanceOf(Date);
    expect(out).toEqual([
      BUCKET_NOTICE,
      expect.stringContaining("restore.stream_prepared"),
      `restored from the bucket named in ${kitPath}`,
    ]);
    expect(out.join("\n")).not.toContain(KIT.recoveryKey);
    expect(out.join("\n")).not.toContain(KIT.bucket.secretAccessKey);
  });

  // Reconciliation N26: the operator sees whose copy this is, and it goes ahead only when
  // --confirm-venue names that copy's tax id.
  it.each([
    [[], false],
    [["--confirm-venue", "B00000000"], false],
    [["--confirm-venue", "89890001k"], false],
    [["--confirm-venue", "89890001K"], true],
  ] as const)(
    "shows the restored venue and, with %j, confirms it: %s",
    async (flags, confirmed) => {
      const { kitPath } = await kitFile();
      const out: string[] = [];
      let answer: boolean | undefined;
      await runRestore({
        argv: ["restore", "--from-bucket", kitPath, ...flags],
        env: { WAITRON_ENV: "preproduction" },
        out: (line) => out.push(line),
        restoreStream: async (d) => {
          answer = d.confirmVenue(VENUE);
        },
      });
      expect(answer).toBe(confirmed);
      expect(out).toContain(
        "the copy in the bucket is: Waitron SL, tax id 89890001K, location Local",
      );
    },
  );

  it("never confirms a copy that names no tax id, even against an empty --confirm-venue", async () => {
    const { kitPath } = await kitFile();
    let answer: boolean | undefined;
    await runRestore({
      argv: ["restore", "--from-bucket", kitPath, "--confirm-venue", ""],
      env: { WAITRON_ENV: "preproduction" },
      out: () => {},
      restoreStream: async (d) => {
        answer = d.confirmVenue({ legalName: "", taxId: "", locationName: "" });
      },
    });
    expect(answer).toBe(false);
  });

  it("tells the operator how to confirm the venue", async () => {
    expect(await refusedWith(new AppError("restore.stream_venue_unconfirmed", VENUE))).toEqual({
      code: 1,
      out: [
        BUCKET_NOTICE,
        "restore failed: restore.stream_venue_unconfirmed — if Waitron SL (tax id 89890001K) is your business, re-run with --confirm-venue 89890001K",
      ],
    });
  });

  it("says a copy naming no business cannot be confirmed", async () => {
    const { out } = await refusedWith(
      new AppError("restore.stream_venue_unconfirmed", {
        legalName: "",
        taxId: "",
        locationName: "",
      }),
    );
    expect(out.at(-1)).toBe(
      "restore failed: restore.stream_venue_unconfirmed — the copy in the bucket names no business tax id, so it cannot be confirmed or restored",
    );
  });

  it("passes the operator's confirmation that the old box is gone", async () => {
    const { kitPath } = await kitFile();
    const restoreStream = vi.fn<RestoreStreamFake>(async () => {});
    await runRestore({
      argv: ["restore", "--from-bucket", kitPath, "--confirm-old-box-gone"],
      env: { WAITRON_ENV: "preproduction" },
      out: () => {},
      restoreStream,
    });
    expect(restoreStream).toHaveBeenCalledWith(expect.objectContaining({ oldBoxGone: true }));
  });

  it.each([
    [
      new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-23T11:58:00.000Z" }),
      "restore failed: restore.stream_source_live — the old server wrote to its bucket at 2026-09-23T11:58:00.000Z and may still be selling; if it is switched off for good, re-run with --confirm-old-box-gone",
    ],
    [
      new AppError("restore.stream_source_unchecked", { reason: "clock" }),
      "restore failed: restore.stream_source_unchecked — whether the old server is still writing to its bucket could not be checked; if it is switched off for good, re-run with --confirm-old-box-gone",
    ],
    [
      new AppError("restore.stream_disk_full", {}),
      "restore failed: restore.stream_disk_full — the disk filled while the copy was downloading; nothing on this server changed. Free some space and run it again",
    ],
    [
      new AppError("provisioning.database_in_use", { database: "/var/lib/waitron/venue" }),
      "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)",
    ],
    [
      new AppError("restore.stream_pointer_missing", {}),
      "restore failed: restore.stream_pointer_missing — the bucket holds no copy for the venue this kit names; check that the kit is this venue's",
    ],
    [
      new AppError("restore.stream_pointer_unverified", { reason: "signature" }),
      "restore failed: restore.stream_pointer_unverified — the copy in the bucket was not signed by the key in this kit, so it is not trusted; check that the kit is this venue's newest",
    ],
    [
      new AppError("restore.stream_pointer_unverified", { reason: "venue_mismatch" }),
      "restore failed: restore.stream_pointer_unverified — the bucket's record of its newest copy names a different venue from this kit",
    ],
    [
      new AppError("restore.stream_integrity_failed", {}),
      "restore failed: restore.stream_integrity_failed — the copy downloaded from the bucket is damaged",
    ],
    [
      new AppError("restore.stream_state_missing", { nodeId: "n1" }),
      "restore failed: restore.stream_state_missing — the copy in the bucket does not hold the old server's locked secrets, so it cannot be restored",
    ],
    [
      new AppError("recovery.passphrase_invalid", {}),
      "restore failed: the recovery key in this kit does not open the copy's locked secrets, or they are damaged",
    ],
    [
      new AppError("backup.artifact_invalid", { reason: "tag" }),
      "restore failed: the recovery key in this kit does not open the copy's locked secrets, or they are damaged",
    ],
    [
      new AppError("provisioning.database_ahead", { set: "core", unknownMigrations: ["0009"] }),
      "restore failed: provisioning.database_ahead — the copy in the bucket was made by newer Waitron software than this server has; update this server first",
    ],
    [
      new AppError("backup.stream_restore_failed", { exitCode: 1, diskFull: false }),
      "restore failed: backup.stream_restore_failed — the copy could not be downloaded from the bucket, for a reason on this server, on its network or at the bucket; check this server's network, the bucket, and that this server's disk and state folder can be written, then run it again",
    ],
    [
      new AppError("backup.stream_restore_failed", { exitCode: null, diskFull: false }),
      "restore failed: backup.stream_restore_failed — the copy could not be downloaded from the bucket, for a reason on this server, on its network or at the bucket; check this server's network, the bucket, and that this server's disk and state folder can be written, then run it again",
    ],
    [
      new AppError("backup.stream_request_failed", {
        operation: "get",
        key: "k",
        status: 403,
        name: "AccessDenied",
      }),
      "restore failed: backup.stream_request_failed — the bucket did not answer, or refused the kit's key; check this server's network and that the bucket and its key still exist",
    ],
    [
      new AppError("restore.hook_failed", { module: "fiscal-verifactu", code: "series.x" }),
      "restore failed: restore.hook_failed (module fiscal-verifactu: series.x)",
    ],
    [
      new AppError("restore.environment_mismatch", { backup: "production", target: "x" }),
      "restore failed: restore.environment_mismatch",
    ],
    [new AppError("server.config_invalid", { variable: "x", reason: "y" }), "restore failed"],
    [new Error("EACCES: open '/var/lib/waitron/S3CR3T'"), "restore failed"],
  ])("says what went wrong in words: %s", async (error, line) => {
    expect(await refusedWith(error)).toEqual({ code: 1, out: [BUCKET_NOTICE, line] });
  });

  it("reports a file with no kit in it by what is wrong, never its contents", async () => {
    const { kitPath } = await kitFile("not a kit, secret-0123456789");
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: { WAITRON_ENV: "preproduction" },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: backup.stream_kit_invalid — the file holds no recovery kit; give the recovery kit file saved for this venue",
    ]);
    expect(out.join("\n")).not.toContain("secret-0123456789");
  });

  // Review Focus 2: a pasted kit cut short is refused by name, and nothing is restored.
  it("refuses a kit cut short by name, and restores nothing", async () => {
    const whole = encodeRecoveryKit(KIT);
    const { dir, kitPath } = await kitFile(whole.slice(0, Math.floor(whole.length / 2)));
    const out: string[] = [];
    const restoreStream = vi.fn(async () => {});
    const code = await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: { WAITRON_ENV: "preproduction", WAITRON_STATE_DIR: dir },
      out: (line) => out.push(line),
      restoreStream,
    });
    expect(code).toBe(1);
    expect(out).toEqual([
      "restore failed: backup.stream_kit_invalid — the recovery kit in the file is incomplete or damaged, perhaps cut short when it was copied; use the whole kit file as it was saved",
    ]);
    expect(out.join("\n")).not.toContain(whole.slice(KIT_TOKEN_START, KIT_TOKEN_START + 24));
    expect(restoreStream).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual(["kit.txt"]);
  });

  it("names the kit path it cannot read", async () => {
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", "--from-bucket", "/does/not/exist/kit.txt"],
      env: {},
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual(["cannot read kit file: /does/not/exist/kit.txt"]);
  });

  it("reports an invalid WAITRON_ENV by code and runs no restore", async () => {
    const { kitPath } = await kitFile();
    const out: string[] = [];
    const restoreStream = vi.fn(async () => {});
    const code = await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: { WAITRON_ENV: "garbage" },
      out: (line) => out.push(line),
      restoreStream,
    });
    expect(code).toBe(1);
    expect(out).toEqual(["restore failed: server.config_invalid"]);
    expect(restoreStream).not.toHaveBeenCalled();
  });

  it.each([
    [["restore", "--from-bucket"]],
    [["restore", "--from-bucket", "--confirm-old-box-gone"]],
  ])("prints the one-line usage for %j", async (argv) => {
    const out: string[] = [];
    expect(await runRestore({ argv, env: {}, out: (l) => out.push(l) })).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("takes the bucket form when flags come before --from-bucket", async () => {
    const { kitPath } = await kitFile();
    const out: string[] = [];
    let received: StreamDeps | undefined;
    let answer: boolean | undefined;
    const code = await runRestore({
      argv: [
        "restore",
        "--confirm-venue",
        VENUE.taxId,
        "--confirm-old-box-gone",
        "--from-bucket",
        kitPath,
      ],
      env: { WAITRON_ENV: "preproduction" },
      out: (line) => out.push(line),
      restoreStream: async (d) => {
        received = d;
        answer = d.confirmVenue(VENUE);
      },
    });
    expect(code).toBe(0);
    expect(received).toMatchObject({ kit: KIT, oldBoxGone: true });
    expect(answer).toBe(true);
    expect(out.at(-1)).toBe(`restored from the bucket named in ${kitPath}`);
  });

  it("prints the one-line usage when --from-bucket comes last with no kit file", async () => {
    const out: string[] = [];
    const restoreStream = vi.fn<RestoreStreamFake>();
    const code = await runRestore({
      argv: ["restore", "--confirm-venue", VENUE.taxId, "--from-bucket"],
      env: { WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY },
      out: (l) => out.push(l),
      restoreStream,
    });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
    expect(restoreStream).not.toHaveBeenCalled();
  });

  it("uses the real bucket restore when none is injected", async () => {
    const { dir, kitPath } = await kitFile();
    const out: string[] = [];
    const empty: ObjectStore = {
      get: async () => null,
      put: async () => ({ etag: "e" }),
      list: async () => [],
      delete: async () => {},
      deleteMany: async () => {},
    };
    const opened: unknown[] = [];
    const code = await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: { WAITRON_ENV: "preproduction", WAITRON_STATE_DIR: dir },
      out: (line) => out.push(line),
      openStore: (bucket) => {
        opened.push(bucket);
        return empty;
      },
    });
    expect(code).toBe(1);
    expect(opened).toEqual([KIT.bucket]);
    expect(out.at(-1)).toMatch(/^restore failed: restore\.stream_pointer_missing — /);
  });

  it("gives up on a bucket call that never answers", async () => {
    const { kitPath } = await kitFile();
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: { WAITRON_ENV: "preproduction" },
      out: (line) => out.push(line),
      openStore: () => ({
        get: () => new Promise<never>(() => {}),
        put: () => new Promise<never>(() => {}),
        list: () => new Promise<never>(() => {}),
        delete: () => new Promise<never>(() => {}),
        deleteMany: () => new Promise<never>(() => {}),
      }),
      bucketTimeoutMs: 20,
      restoreStream: async (d) => {
        await d.openStore!(KIT.bucket).get("current.json");
      },
    });
    expect(code).toBe(1);
    expect(out.at(-1)).toMatch(/^restore failed: backup\.stream_request_failed — /);
  });
});

describe("waitron-restore restore --from-bucket, where things live", () => {
  it("resolves overridden venue and migrations folders as the archive path does", async () => {
    const { dir, kitPath } = await kitFile();
    let received: StreamDeps | undefined;
    await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: {
        WAITRON_ENV: "production",
        WAITRON_STATE_DIR: dir,
        WAITRON_VENUE_DIR: join(dir, "elsewhere"),
        WAITRON_MIGRATIONS_DIR: "/custom/migrations",
      },
      out: () => {},
      restoreStream: async (d) => {
        received = d;
      },
    });
    expect(received).toMatchObject({
      environment: "production",
      venueDir: join(resolve(dir), "elsewhere"),
      migrationsRoot: "/custom/migrations",
    });
  });

  it("opens the real bucket client when no opener is injected, without sending anything", async () => {
    const { kitPath } = await kitFile();
    let opened: ObjectStore | undefined;
    await runRestore({
      argv: ["restore", "--from-bucket", kitPath],
      env: { WAITRON_ENV: "preproduction" },
      out: () => {},
      restoreStream: async (d) => {
        opened = d.openStore!(KIT.bucket);
      },
    });
    expect(Object.keys(opened!).sort()).toEqual(["delete", "deleteMany", "get", "list", "put"]);
  });
});

describe("waitron-restore restore <artifact>, the old server's bucket", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    resetPerTest: false,
    timeoutMs: 120_000,
  });
  const VAULT_KEY = Buffer.alloc(32, 5).toString("base64");

  it("reads the bucket named in the archive's settings through the bounded opener", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-cli-archive-bucket-"));
    const file = join(await mkdtemp(join(tmpdir(), "waitron-cli-archive-db-")), "venue.db");
    await suite.db.archiveTo(file);
    const copy = await openVenueDatabase(dirname(file));
    try {
      const ring = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: VAULT_KEY,
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      await withTransaction(copy.venue, (tx) =>
        putCredential(tx, ring, {
          purpose: STREAM_PURPOSE,
          value: streamSettingsPayload({ venueId: KIT.venueId, bucket: KIT.bucket }),
        }),
      );
    } finally {
      await copy.close();
    }
    const validated = {
      manifest: { manifestVersion: 1, createdAt: "", environment: "preproduction", modules: {} },
      dumpEntry: { name: "db.dump", bytes: await readFile(file) },
      secretEntries: [
        {
          name: "secrets/secrets.env",
          bytes: Buffer.from(
            `WAITRON_CREDENTIALS_KEY=${VAULT_KEY}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
          ),
        },
      ],
    } as unknown as ValidatedArtifact;
    const opened: unknown[] = [];
    let check: RestoreDeps["checkSourceLive"];
    await runRestore({
      argv: ["restore", await makeArtifact(dir)],
      env: { WAITRON_STATE_DIR: dir, WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY },
      out: () => {},
      openStore: (bucket) => {
        opened.push(bucket);
        return {
          get: () => new Promise<never>(() => {}),
          put: () => new Promise<never>(() => {}),
          list: () => new Promise<never>(() => {}),
          delete: () => new Promise<never>(() => {}),
          deleteMany: () => new Promise<never>(() => {}),
        };
      },
      bucketTimeoutMs: 20,
      restore: async (d) => {
        check = d.checkSourceLive;
      },
    });
    await expect(check!(validated)).rejects.toMatchObject({
      code: "restore.stream_source_unchecked",
      params: { reason: "bucket" },
    });
    expect(opened).toEqual([KIT.bucket]);
  });
});

describe("waitron-restore restore <artifact> and the old server", () => {
  // Reconciliation N23: the archive path runs its own old-box check, and the flag reaches it.
  it.each([
    [[], false],
    [["--confirm-old-box-gone"], true],
  ] as const)(
    "hands an archive restore the old-box check (flags %j; settles at once: %s)",
    async (flags, settles) => {
      const dir = mkdtempSync(join(tmpdir(), "waitron-cli-archive-"));
      const artifactPath = await makeArtifact(dir);
      const unreadable = {
        manifest: { manifestVersion: 1, createdAt: "", environment: "preproduction", modules: {} },
        dumpEntry: { name: "db.dump", bytes: Buffer.from("not a database") },
        secretEntries: [
          { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_CREDENTIALS_KEY=x\n") },
        ],
      } as unknown as ValidatedArtifact;
      let check: RestoreDeps["checkSourceLive"];
      await runRestore({
        argv: ["restore", artifactPath, ...flags],
        env: { WAITRON_STATE_DIR: dir, WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY },
        out: () => {},
        restore: async (d) => {
          check = d.checkSourceLive;
        },
      });
      expect(check).toBeDefined();
      // With the flag the check returns at once; without it, it reads the archive's database.
      const outcome = await check!(unreadable).then(
        () => true,
        () => false,
      );
      expect(outcome).toBe(settles);
    },
  );

  it.each([
    [
      new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-23T11:58:00.000Z" }),
      "restore failed: restore.stream_source_live — the server this backup came from wrote to its bucket at 2026-09-23T11:58:00.000Z and may still be selling; if it is switched off for good, re-run with --confirm-old-box-gone",
    ],
    [
      new AppError("restore.stream_source_unchecked", { reason: "bucket" }),
      "restore failed: restore.stream_source_unchecked — whether the server this backup came from is still writing to its bucket could not be checked; if it is switched off for good, re-run with --confirm-old-box-gone",
    ],
  ])("explains a possibly live old server, and how to go ahead: %s", async (error, line) => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-cli-archive-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: { WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY },
      out: (l) => out.push(l),
      restore: async () => {
        throw error;
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual([COLD_RESTORE_NOTICE, line]);
  });
});

describe("waitron-restore restore, the arguments each form accepts", () => {
  const ARTIFACT = "<artifact>";
  const KIT_FILE = "<kit>";
  it.each([
    ["--confirm-venue with no value", ["--from-bucket", KIT_FILE, "--confirm-venue"]],
    [
      "--confirm-venue followed by another flag",
      ["--from-bucket", KIT_FILE, "--confirm-venue", "--confirm-old-box-gone"],
    ],
    ["--confirm-venue on the archive form", [ARTIFACT, "--confirm-venue", "89890001K"]],
    ["a misspelled flag on the archive form", [ARTIFACT, "--confirm-old-box-gon"]],
    ["a misspelled flag on the bucket form", ["--from-bucket", KIT_FILE, "--confrim-venue", "X"]],
    ["an artifact given with --from-bucket", [ARTIFACT, "--from-bucket", KIT_FILE]],
    ["an artifact after the kit file", ["--from-bucket", KIT_FILE, ARTIFACT]],
    ["a second artifact", [ARTIFACT, ARTIFACT]],
    ["--from-bucket given twice", ["--from-bucket", KIT_FILE, "--from-bucket", KIT_FILE]],
    [
      "--confirm-old-box-gone given twice",
      [ARTIFACT, "--confirm-old-box-gone", "--confirm-old-box-gone"],
    ],
  ])("prints the one-line usage and runs nothing for %s", async (_label, args) => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-cli-args-"));
    const artifactPath = await makeArtifact(dir);
    const { kitPath } = await kitFile();
    const argv = [
      "restore",
      ...args.map((a) => (a === ARTIFACT ? artifactPath : a === KIT_FILE ? kitPath : a)),
    ];
    const out: string[] = [];
    const restore = vi.fn(async () => {});
    const restoreStream = vi.fn<RestoreStreamFake>(async () => {});
    const code = await runRestore({
      argv,
      env: { WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY, WAITRON_STATE_DIR: dir },
      out: (line) => out.push(line),
      restore,
      restoreStream,
    });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/^usage: /)]);
    expect(restore).not.toHaveBeenCalled();
    expect(restoreStream).not.toHaveBeenCalled();
  });
});

describe("waitron-restore restore, when the restored database could not be put in place", () => {
  const PLACEMENT_FAILED: [AppError<"restore.placement_failed">, string][] = [
    [
      new AppError("restore.placement_failed", { kept: "previous" }),
      "restore failed: restore.placement_failed — the restored database could not be put in place; this server's previous database is unchanged",
    ],
    [
      new AppError("restore.placement_failed", {
        kept: "set_aside",
        folder: ".venue.db-replaced-Ab12Cd",
      }),
      "restore failed: restore.placement_failed — the restored database could not be put in place, and the previous database could not all be put back: what was not is in the folder .venue.db-replaced-Ab12Cd inside the venue folder; move everything in it back into the venue folder before starting the server",
    ],
  ];

  it.each(PLACEMENT_FAILED)(
    "says which database the archive path left: %s",
    async (error, line) => {
      const dir = await mkdtemp(join(tmpdir(), "restore-command-placement-"));
      try {
        const out: string[] = [];
        const code = await runRestore({
          argv: ["restore", await makeArtifact(dir)],
          env: { WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY, WAITRON_ENV: "preproduction" },
          out: (line) => out.push(line),
          restore: async () => {
            throw error;
          },
        });
        expect({ code, out }).toEqual({ code: 1, out: [COLD_RESTORE_NOTICE, line] });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.each(PLACEMENT_FAILED)("says which database the bucket path left: %s", async (error, line) => {
    expect(await refusedWith(error)).toEqual({ code: 1, out: [BUCKET_NOTICE, line] });
  });
});
