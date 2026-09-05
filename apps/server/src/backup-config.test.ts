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
        reason: "required_with_backup_destination",
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

  // Every WAITRON_BACKUP_DESTINATIONS rejection funnels through the same
  // `backup.destinations_invalid` throw with a machine-readable `reason`; the cases differ only in
  // the input JSON and the expected reason, so they share one table. `resolve("")` is cwd, so an
  // empty id/dir must fail closed BEFORE the resolve (CLAUDE.md §3), which the last two cases pin.
  it.each([
    ["not json", "not_json"],
    ['{"kind":"local-fs"}', "not_array"],
    ['[{"kind":"local-fs","id":"usb"}]', "bad_entry"],
    ['[{"kind":"local-fs","id":"usb","dir":""}]', "bad_entry"],
    ['[{"kind":"local-fs","id":"","dir":"/mnt/b"}]', "bad_entry"],
  ])("rejects WAITRON_BACKUP_DESTINATIONS %j with reason %s", (json, reason) => {
    expect(() => loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATIONS: json })).toThrow(
      new AppError("backup.destinations_invalid", { reason }),
    );
  });

  it("rejects two destinations sharing an id (duplicate_id)", () => {
    expect(() =>
      loadBackupConfig({
        ...base,
        WAITRON_BACKUP_DESTINATIONS:
          '[{"kind":"local-fs","id":"dup","dir":"/mnt/a"},{"kind":"local-fs","id":"dup","dir":"/mnt/b"}]',
      }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "duplicate_id" }));
  });

  it("rejects two destinations resolving to the same dir (duplicate_dir)", () => {
    expect(() =>
      loadBackupConfig({
        ...base,
        WAITRON_BACKUP_DESTINATIONS:
          '[{"kind":"local-fs","id":"one","dir":"/mnt/a"},{"kind":"local-fs","id":"two","dir":"/mnt/a/"}]',
      }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "duplicate_dir" }));
  });

  it("rejects WAITRON_BACKUP_DIR re-listed in WAITRON_BACKUP_DESTINATIONS (duplicate_dir)", () => {
    expect(() =>
      loadBackupConfig({
        ...base,
        WAITRON_BACKUP_DIR: "/mnt/a",
        WAITRON_BACKUP_DESTINATIONS: '[{"kind":"local-fs","id":"usb","dir":"/mnt/a"}]',
      }),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "duplicate_dir" }));
  });
});
