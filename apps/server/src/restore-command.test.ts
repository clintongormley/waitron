import { mkdtempSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { encryptArtifact } from "./artifact-cipher.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { DEFAULT_MEDIA_ROOT, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import type { RestoreDeps } from "./restore.js";
import { runRestore } from "./restore-command.js";

const RECOVERY_KEY = "s3cr3t-recovery-key-value";
const DATABASE_URL = "postgres://admin:hunter2@localhost/restore_target";

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
      env: { WAITRON_RESTORE_DATABASE_URL: DATABASE_URL },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_BACKUP_RECOVERY_KEY/)]);
  });

  it("returns 1 and names the variable when the target connection is empty", async () => {
    // The empty string is a valid-looking value, not an absent one — `isUnset` must catch it
    // explicitly (CLAUDE.md §3: "an empty connection string is a valid connection string").
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", "/does/not/matter"],
      env: { WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY, WAITRON_RESTORE_DATABASE_URL: "" },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_RESTORE_DATABASE_URL/)]);
  });

  it("returns 1 and names the path when the artifact file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-missing-"));
    const artifactPath = join(dir, "does-not-exist.wrb");
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
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
        WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
      },
      out: (line) => out.push(line),
      restore: async (args) => {
        received = args;
        // Exercise the `log` seam too: `restoreFromArtifact` reports progress through it
        // (`restore.db.staged`, `restore.media.done`, ...), and this confirms those structured
        // lines actually reach the operator via `out`, formatted, with no secret riding along.
        args.log("info", "restore.db.staged", { bytes: 123 });
      },
    });
    expect(code).toBe(0);
    expect(received).toBeDefined();
    expect(received?.recoveryKey).toBe(RECOVERY_KEY);
    expect(received?.databaseUrl).toBe(DATABASE_URL);
    expect(received?.mediaDir).toBe(DEFAULT_MEDIA_ROOT);
    expect(received?.stateDir).toBe(DEFAULT_STATE_ROOT);
    expect(received?.stagingDir).toBe(join(DEFAULT_STATE_ROOT, "restore-staging"));
    expect(received?.migrationsRoot).toBe(DEFAULT_MIGRATIONS_ROOT);
    expect(received?.modules).toBe(ALL_MODULES);
    expect(received?.environment).toBe("preproduction");
    expect(Buffer.from(received!.artifact).toString("utf8")).toBe(
      "not a real artifact, never decrypted in this suite",
    );
    expect(out.some((line) => line.includes("restore.db.staged"))).toBe(true);
    // Neither secret ever reaches the operator-facing output.
    const printed = out.join("\n");
    expect(printed).not.toContain(RECOVERY_KEY);
    expect(printed).not.toContain(DATABASE_URL);
    expect(printed).not.toContain("hunter2");
  });

  it("uses the real restoreFromArtifact when no orchestrator is injected", async () => {
    // No `deps.restore` here — exercises the DEFAULT wiring (`restoreFromArtifact` itself), all
    // the way through decrypt+unpack+the compatibility gate, WITHOUT ever reaching `pg_restore`:
    // the gate throws first (the target is `production` here, `WAITRON_ENV=production`, and this
    // artifact's manifest says `preproduction`), so nothing is shelled out and no database is
    // touched. `WAITRON_MIGRATIONS_DIR` mirrors `boot.test.ts`'s own from-source fixture — the
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
      { name: "db.dump", bytes: Buffer.from("PGDMP-fake-custom-format-dump") },
    ];
    const artifactPath = join(dir, "backup.wrb");
    await writeFile(artifactPath, encryptArtifact(packArchive(entries), RECOVERY_KEY));
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "production",
      },
      out: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringContaining("restore.environment_mismatch")]);
  });

  it("resolves overridden media/state/migrations dirs and environment from env, like boot does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-overrides-"));
    const artifactPath = await makeArtifact(dir);
    const mediaDir = join(dir, "media");
    const stateDir = join(dir, "state");
    let received: RestoreDeps | undefined;
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
        WAITRON_MEDIA_DIR: mediaDir,
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
    expect(received?.mediaDir).toBe(resolve(mediaDir));
    expect(received?.stateDir).toBe(resolve(stateDir));
    expect(received?.stagingDir).toBe(join(resolve(stateDir), "restore-staging"));
    expect(received?.migrationsRoot).toBe("/custom/migrations");
    expect(received?.environment).toBe("production");
  });

  it("collapses a decrypt-phase AppError into one non-leaking message and returns 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-badkey-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
      },
      out: (line) => out.push(line),
      restore: async () => {
        throw new AppError("recovery.passphrase_invalid", {});
      },
    });
    expect(code).toBe(1);
    expect(out).toEqual(["restore failed: wrong recovery key or corrupt artifact"]);
  });

  it("reports a gate/guard AppError by code and returns 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-gate-"));
    const artifactPath = await makeArtifact(dir);
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath],
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
        WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
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
    expect(out).toEqual([expect.stringContaining("restore.environment_mismatch")]);
  });

  it("rethrows an AppError outside restore/recovery/backup namespaces rather than swallowing it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-command-rethrow-"));
    const artifactPath = await makeArtifact(dir);
    await expect(
      runRestore({
        argv: ["restore", artifactPath],
        env: {
          WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
          WAITRON_RESTORE_DATABASE_URL: DATABASE_URL,
        },
        out: () => {},
        restore: async () => {
          throw new AppError("server.config_invalid", {
            variable: "x",
            reason: "not_a_deployment_environment",
          });
        },
      }),
    ).rejects.toMatchObject({ code: "server.config_invalid" });
  });
});
