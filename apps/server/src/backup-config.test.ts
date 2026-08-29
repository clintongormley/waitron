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
    });
    expect(c).toMatchObject({
      databaseUrl: "postgres://x",
      retain: expect.any(Number),
      intervalMs: expect.any(Number),
      staleAfterMs: expect.any(Number),
    });
    expect(c!.dir).toMatch(/^\//); // resolved absolute
  });
  it("rejects a non-positive retain count", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/b",
        WAITRON_BACKUP_DATABASE_URL: "postgres://x",
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
