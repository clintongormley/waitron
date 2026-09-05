import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { loadBackupConfig } from "./backup-config.js";

describe("loadBackupConfig", () => {
  it("returns undefined when WAITRON_BACKUP_DIR is unset (backup off)", () => {
    expect(loadBackupConfig({})).toBeUndefined();
    expect(loadBackupConfig({ WAITRON_BACKUP_DIR: "" })).toBeUndefined();
  });
  it("requires a backup database url when the dir is set", () => {
    expect(() => loadBackupConfig({ WAITRON_BACKUP_DIR: "/b" })).toThrow(
      new AppError("server.config_invalid", {
        variable: "WAITRON_BACKUP_DATABASE_URL",
        reason: "required_with_backup_dir",
      }),
    );
  });
  it("builds a config with defaults", () => {
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/b",
      WAITRON_BACKUP_DATABASE_URL: "postgres://x",
      WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
    });
    expect(c).toMatchObject({
      databaseUrl: "postgres://x",
      recoveryKey: "twelve-chars!",
      retain: expect.any(Number),
      intervalMs: expect.any(Number),
      staleAfterMs: expect.any(Number),
    });
    expect(c!.destinations[0].dir).toMatch(/^\//); // resolved absolute
  });
  it("rejects a non-positive retain count", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/b",
        WAITRON_BACKUP_DATABASE_URL: "postgres://x",
        WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
        WAITRON_BACKUP_RETAIN: "0",
      }),
    ).toThrow(
      new AppError("server.config_invalid", {
        variable: "WAITRON_BACKUP_RETAIN",
        reason: "not_a_positive_integer",
      }),
    );
  });
});

const base = {
  WAITRON_BACKUP_DATABASE_URL: "postgres://x",
  WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
};

describe("loadBackupConfig destinations + recovery key", () => {
  it("is disabled when no destination is configured", () => {
    expect(loadBackupConfig({ ...base })).toBeUndefined();
  });

  it("turns WAITRON_BACKUP_DIR into a single local-fs destination 'primary'", () => {
    const cfg = loadBackupConfig({ ...base, WAITRON_BACKUP_DIR: "/mnt/backups" });
    expect(cfg?.destinations).toEqual([{ kind: "local-fs", id: "primary", dir: "/mnt/backups" }]);
  });

  it("appends WAITRON_BACKUP_DESTINATIONS entries after the primary", () => {
    const cfg = loadBackupConfig({
      ...base,
      WAITRON_BACKUP_DIR: "/mnt/a",
      WAITRON_BACKUP_DESTINATIONS: '[{"kind":"local-fs","id":"usb","dir":"/mnt/usb"}]',
    });
    expect(cfg?.destinations.map((d) => d.id)).toEqual(["primary", "usb"]);
  });

  it("requires the recovery key when a destination is set", () => {
    expect(() =>
      loadBackupConfig({ WAITRON_BACKUP_DIR: "/mnt/a", WAITRON_BACKUP_DATABASE_URL: "x" }),
    ).toThrow(new AppError("backup.recovery_key_missing", {}));
  });

  it("rejects a too-short recovery key", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/mnt/a",
        WAITRON_BACKUP_DATABASE_URL: "x",
        WAITRON_BACKUP_RECOVERY_KEY: "short",
      }),
    ).toThrow(new AppError("backup.recovery_key_too_short", { min: 12 }));
  });

  it("rejects malformed WAITRON_BACKUP_DESTINATIONS JSON", () => {
    expect(() => loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATIONS: "not json" })).toThrow(
      new AppError("backup.destinations_invalid", { reason: "not_json" }),
    );
  });

  it("rejects a WAITRON_BACKUP_DESTINATIONS value that is valid JSON but not an array", () => {
    expect(() =>
      loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATIONS: '{"kind":"local-fs"}' }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "not_array" }));
  });

  it("rejects a WAITRON_BACKUP_DESTINATIONS entry missing a required field", () => {
    expect(() =>
      loadBackupConfig({
        ...base,
        WAITRON_BACKUP_DESTINATIONS: '[{"kind":"local-fs","id":"usb"}]',
      }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "bad_entry" }));
  });

  it("rejects a WAITRON_BACKUP_DESTINATIONS entry with an empty dir (never resolve(''))", () => {
    expect(() =>
      loadBackupConfig({
        ...base,
        WAITRON_BACKUP_DESTINATIONS: '[{"kind":"local-fs","id":"usb","dir":""}]',
      }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "bad_entry" }));
  });

  it("rejects a WAITRON_BACKUP_DESTINATIONS entry with an empty id", () => {
    expect(() =>
      loadBackupConfig({
        ...base,
        WAITRON_BACKUP_DESTINATIONS: '[{"kind":"local-fs","id":"","dir":"/mnt/b"}]',
      }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "bad_entry" }));
  });
});
