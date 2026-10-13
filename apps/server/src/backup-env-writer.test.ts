import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertStorableKey } from "./backup-api.js";
import { assertStorableRecord, writeRecoveryKey } from "./backup-env-writer.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "backup-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

describe("assertStorableRecord", () => {
  it("passes a clean record and rejects any value carrying a control char / newline", () => {
    const clean = {
      WAITRON_BACKUP_DIR: "/srv/backups",
      WAITRON_BACKUP_RECOVERY_KEY: "abcDEF-_1234567890",
      WAITRON_BACKUP_INTERVAL_MS: "3600000",
    };
    expect(() => assertStorableRecord(clean)).not.toThrow();
    // A newline in ANY value injects a second KEY=value line on the round-trip.
    expect(() => assertStorableRecord({ ...clean, WAITRON_BACKUP_DIR: "/srv\nEVIL=1" })).toThrow(
      /destinations_invalid/,
    );
    // A bare carriage return / control char is refused too.
    expect(() => assertStorableRecord({ ...clean, WAITRON_BACKUP_DIR: "/srv\rx" })).toThrow(
      /destinations_invalid/,
    );
  });
});

describe("assertStorableRecord — values the env file would read back differently", () => {
  function refusal(record: Record<string, string>): unknown {
    try {
      assertStorableRecord(record);
    } catch (error) {
      return error;
    }
    throw new Error("expected assertStorableRecord to refuse the record");
  }

  it("refuses a directory with a trailing space, which reading the file back would drop", () => {
    expect(refusal({ WAITRON_BACKUP_DIR: "/srv/backups " })).toMatchObject({
      code: "backup.destinations_invalid",
      params: { reason: "round_trip" },
    });
  });

  it("refuses a record whose key carries an equals sign, which would read back as another key", () => {
    expect(refusal({ "WAITRON_BACKUP=DIR": "/srv/backups" })).toMatchObject({
      code: "backup.destinations_invalid",
      params: { reason: "round_trip" },
    });
  });
});

describe("writeRecoveryKey", () => {
  it("creates backup.env holding only the key when there is none, 0600", async () => {
    const dir = tempDir();
    await writeRecoveryKey(dir, { recoveryKey: "abcDEF-_1234567890", keyRotatedAt: undefined });
    const path = join(dir, "backup.env");
    expect(parseEnvFile(await readFile(path, "utf8"))).toEqual({
      WAITRON_BACKUP_RECOVERY_KEY: "abcDEF-_1234567890",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("changes the key and the rotation stamp and keeps every other setting", async () => {
    const dir = tempDir();
    await writeFile(
      join(dir, "backup.env"),
      formatEnvFile({
        WAITRON_BACKUP_DIR: "/srv/backups",
        WAITRON_BACKUP_RECOVERY_KEY: "old-key-0123456789",
        WAITRON_BACKUP_INTERVAL_MS: "3600000",
        WAITRON_BACKUP_RETAIN: "7",
        WAITRON_BACKUP_RETAIN_DAYS: "30",
      }),
    );
    await writeRecoveryKey(dir, {
      recoveryKey: "new-key-0123456789",
      keyRotatedAt: "2026-09-23T00:00:00.000Z",
    });
    expect(parseEnvFile(await readFile(join(dir, "backup.env"), "utf8"))).toEqual({
      WAITRON_BACKUP_DIR: "/srv/backups",
      WAITRON_BACKUP_RECOVERY_KEY: "new-key-0123456789",
      WAITRON_BACKUP_INTERVAL_MS: "3600000",
      WAITRON_BACKUP_RETAIN: "7",
      WAITRON_BACKUP_RETAIN_DAYS: "30",
      WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-23T00:00:00.000Z",
    });
  });

  it("refuses a key that would not survive the file, writing nothing", async () => {
    const dir = tempDir();
    await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=kept-key-012345\n");
    await expect(
      writeRecoveryKey(dir, { recoveryKey: "has\nnewline-0123", keyRotatedAt: undefined }),
    ).rejects.toMatchObject({ code: "backup.destinations_invalid" });
    expect(await readFile(join(dir, "backup.env"), "utf8")).toBe(
      "WAITRON_BACKUP_RECOVERY_KEY=kept-key-012345\n",
    );
  });
});
