import { mkdtempSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertStorableKey } from "./backup-api.js";
import { writeBackupEnv } from "./backup-env-writer.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";

describe("assertStorableKey", () => {
  it.each(["needs a space ", "has\nnewline", "tab\tthere", " leading"])("rejects %j", (k) => {
    expect(() => assertStorableKey(k)).toThrow(/recovery_key_unstorable/);
  });

  it("accepts a base64url key and round-trips", () => {
    const k = "abcDEF-_1234567890";
    expect(() => assertStorableKey(k)).not.toThrow();
    expect(
      parseEnvFile(formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: k })).WAITRON_BACKUP_RECOVERY_KEY,
    ).toBe(k);
  });
});

describe("writeBackupEnv", () => {
  it("writes only per-venue config (never the DB url) and round-trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "backup-env-"));
    await writeBackupEnv(dir, {
      destinationDir: "/srv/backups",
      recoveryKey: "abcDEF-_1234567890",
      schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
      retention: { count: 7, days: 30 },
      keyRotatedAt: "2026-09-09T00:00:00.000Z",
    });
    const parsed = parseEnvFile(await readFile(join(dir, "backup.env"), "utf8"));
    expect(parsed).toEqual({
      WAITRON_BACKUP_DIR: "/srv/backups",
      WAITRON_BACKUP_RECOVERY_KEY: "abcDEF-_1234567890",
      WAITRON_BACKUP_SCHEDULE_DAYS: "daily",
      WAITRON_BACKUP_AT: "03:30",
      WAITRON_BACKUP_RETAIN: "7",
      WAITRON_BACKUP_RETAIN_DAYS: "30",
      WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-09T00:00:00.000Z",
    });
    // NEVER the DB url — the box derives the read connection from its own owner connection.
    expect(parsed.WAITRON_BACKUP_DATABASE_URL).toBeUndefined();
    // Owner-only perms, like the other secret writers.
    expect((await stat(join(dir, "backup.env"))).mode & 0o777).toBe(0o600);
  });

  it("writes an interval schedule and omits the wall-clock keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "backup-env-"));
    await writeBackupEnv(dir, {
      destinationDir: "/srv/backups",
      recoveryKey: "abcDEF-_1234567890",
      schedule: { kind: "interval", ms: 3_600_000 },
      retention: { count: 3, days: 10 },
      keyRotatedAt: undefined,
    });
    const parsed = parseEnvFile(await readFile(join(dir, "backup.env"), "utf8"));
    expect(parsed.WAITRON_BACKUP_INTERVAL_MS).toBe("3600000");
    expect(parsed.WAITRON_BACKUP_SCHEDULE_DAYS).toBeUndefined();
    expect(parsed.WAITRON_BACKUP_AT).toBeUndefined();
    expect(parsed.WAITRON_BACKUP_KEY_ROTATED_AT).toBeUndefined();
  });
});
