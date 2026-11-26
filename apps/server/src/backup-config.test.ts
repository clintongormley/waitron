import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { ArchiveSettings } from "./archive-settings.js";
import { attachRecordMeta } from "./backup-settings-evidence.js";
import {
  loadBackupKey,
  loadBackupSettings,
  loadRecoveryKey,
  resolveBackupConfig,
} from "./backup-config.js";

describe("loadRecoveryKey", () => {
  it("is undefined when the key is unset or empty", () => {
    expect(loadRecoveryKey({})).toBeUndefined();
    expect(loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: "" })).toBeUndefined();
  });

  it("returns the key with no archive destination configured", () => {
    expect(loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" })).toBe("twelve-chars!");
  });

  it("refuses a key under the floor even with no destination", () => {
    expect(() => loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: "short" })).toThrow(
      new AppError("backup.recovery_key_too_short", { min: 12 }),
    );
  });
});

/** 32 bytes as base64url: the only spelling the opener takes. */
const HELD_KEY_TEXT = Buffer.alloc(32, 9).toString("base64url");

describe("loadBackupKey", () => {
  const HELD = {
    WAITRON_BACKUP_RECOVERY_KEY: HELD_KEY_TEXT,
    WAITRON_BACKUP_KEY_NUMBER: "2",
    WAITRON_BACKUP_MASTER_KEY_ID: "0123456789abcdef",
  };

  it("returns the key, its number and its master key id together", () => {
    expect(loadBackupKey(HELD)).toEqual({
      key: HELD_KEY_TEXT,
      keyNumber: 2,
      masterKeyId: "0123456789abcdef",
    });
  });

  it.each([
    ["no key", { WAITRON_BACKUP_RECOVERY_KEY: undefined }],
    ["no number", { WAITRON_BACKUP_KEY_NUMBER: undefined }],
    ["an empty number", { WAITRON_BACKUP_KEY_NUMBER: "" }],
    ["number 0", { WAITRON_BACKUP_KEY_NUMBER: "0" }],
    ["a fractional number", { WAITRON_BACKUP_KEY_NUMBER: "1.5" }],
    ["a padded number", { WAITRON_BACKUP_KEY_NUMBER: "01" }],
    ["a number past four bytes", { WAITRON_BACKUP_KEY_NUMBER: "4294967296" }],
    ["no master key id", { WAITRON_BACKUP_MASTER_KEY_ID: undefined }],
    ["an upper-case id", { WAITRON_BACKUP_MASTER_KEY_ID: "0123456789ABCDEF" }],
    ["a short id", { WAITRON_BACKUP_MASTER_KEY_ID: "0123456789abcde" }],
    ["a key with a trailing =", { WAITRON_BACKUP_RECOVERY_KEY: `${HELD_KEY_TEXT}=` }],
    [
      "a key of 31 bytes",
      { WAITRON_BACKUP_RECOVERY_KEY: Buffer.alloc(31, 9).toString("base64url") },
    ],
    ["a key that is not base64url", { WAITRON_BACKUP_RECOVERY_KEY: "held-recovery-key-0123" }],
  ])("is undefined with %s", (_, change) => {
    expect(loadBackupKey({ ...HELD, ...change })).toBeUndefined();
  });

  it("control: the largest number a version 2 frame names is read", () => {
    expect(loadBackupKey({ ...HELD, WAITRON_BACKUP_KEY_NUMBER: "4294967295" })?.keyNumber).toBe(
      4294967295,
    );
  });

  const SEALED: ArchiveSettings = {
    revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
    enabled: true,
    cloud: false,
    destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
    schedule: { kind: "interval", ms: 3_600_000 },
    retention: { count: 5, days: 12 },
    destinationTimeoutMs: 120_000,
  };

  it("the backup settings carry the number and id they read", () => {
    expect(resolveBackupConfig({ env: HELD, sealed: SEALED })).toMatchObject({
      recoveryKey: HELD_KEY_TEXT,
      keyNumber: 2,
      masterKeyId: "0123456789abcdef",
    });
  });

  it.each([
    ["no number", { WAITRON_BACKUP_KEY_NUMBER: undefined }],
    ["no master key id", { WAITRON_BACKUP_MASTER_KEY_ID: undefined }],
    ["a malformed number", { WAITRON_BACKUP_KEY_NUMBER: "01" }],
    ["a key with a trailing =", { WAITRON_BACKUP_RECOVERY_KEY: `${HELD_KEY_TEXT}=` }],
  ])("an enabled record with %s is refused", (_, change) => {
    expect(() => resolveBackupConfig({ env: { ...HELD, ...change }, sealed: SEALED })).toThrow(
      new AppError("backup.recovery_key_missing", {}),
    );
  });

  it("a switched-off record without N or the id still reports the key it holds", () => {
    const cfg = resolveBackupConfig({
      env: { WAITRON_BACKUP_RECOVERY_KEY: HELD_KEY_TEXT },
      sealed: { ...SEALED, enabled: false },
    });
    expect(cfg).toMatchObject({ enabled: false, recoveryKey: HELD_KEY_TEXT });
    expect(cfg?.keyNumber).toBeUndefined();
    expect(cfg?.masterKeyId).toBeUndefined();
  });
});

describe("resolveBackupConfig", () => {
  const KEY = HELD_KEY_TEXT;
  const N_AND_ID = {
    WAITRON_BACKUP_KEY_NUMBER: "1",
    WAITRON_BACKUP_MASTER_KEY_ID: "0123456789abcdef",
  };
  const sealed: ArchiveSettings = {
    revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
    enabled: true,
    cloud: false,
    destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
    schedule: { kind: "wall-clock", days: [1, 3], at: { hour: 4, minute: 15 } },
    retention: { count: 5, days: 12 },
    destinationTimeoutMs: 120_000,
  };

  it("a destination in the environment is not a backup", () => {
    expect(
      resolveBackupConfig({
        env: { WAITRON_BACKUP_DIR: "/x", WAITRON_BACKUP_RECOVERY_KEY: KEY },
        sealed: null,
      }),
    ).toBeUndefined();
  });

  it("a switched-off record needs no key", () => {
    expect(
      resolveBackupConfig({
        env: {},
        sealed: { ...sealed, enabled: false },
      }),
    ).toMatchObject({ enabled: false, recoveryKey: undefined });
  });

  it("stale after two days regardless of the retired environment setting", () => {
    const cfg = resolveBackupConfig({
      env: { WAITRON_BACKUP_RECOVERY_KEY: KEY, ...N_AND_ID, WAITRON_BACKUP_STALE_AFTER_MS: "1" },
      sealed,
    });
    expect(cfg?.staleAfterMs).toBe(172_800_000);
  });

  it("builds the config from an enabled sealed record", () => {
    const cfg = resolveBackupConfig({
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: KEY,
        ...N_AND_ID,
        WAITRON_BACKUP_KEY_ROTATED_AT: "2026-10-01T00:00:00.000Z",
      },
      sealed,
    });
    expect(cfg).toEqual({
      revision: sealed.revision,
      enabled: true,
      destinations: sealed.destinations,
      recoveryKey: KEY,
      schedule: sealed.schedule,
      retain: 5,
      retainDays: 12,
      staleAfterMs: 2 * 24 * 60 * 60 * 1000,
      destinationTimeoutMs: 120_000,
      keyRotatedAt: "2026-10-01T00:00:00.000Z",
      keyNumber: 1,
      masterKeyId: "0123456789abcdef",
    });
  });

  it("carries a stored switch-off", () => {
    const cfg = resolveBackupConfig({
      env: { WAITRON_BACKUP_RECOVERY_KEY: KEY },
      sealed: { ...sealed, enabled: false },
    });
    expect(cfg).toMatchObject({ enabled: false, revision: sealed.revision });
  });

  it("refuses an enabled record when no recovery key is held", () => {
    expect(() => resolveBackupConfig({ env: {}, sealed })).toThrow(
      new AppError("backup.recovery_key_missing", {}),
    );
  });
});

describe("resolveBackupConfig with a held key under the length floor", () => {
  it("reports a switched-off record without throwing", () => {
    const cfg = resolveBackupConfig({
      env: { WAITRON_BACKUP_RECOVERY_KEY: "short" },
      sealed: {
        revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
        enabled: false,
        cloud: false,
        destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
        schedule: { kind: "interval", ms: 86_400_000 },
        retention: { count: 7, days: 30 },
        destinationTimeoutMs: 900_000,
      },
    });
    expect(cfg).toMatchObject({ enabled: false, recoveryKey: undefined });
  });
});

describe("loadBackupSettings", () => {
  const sealed: ArchiveSettings = {
    revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
    enabled: true,
    cloud: false,
    destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
    schedule: { kind: "interval", ms: 86_400_000 },
    retention: { count: 7, days: 30 },
    destinationTimeoutMs: 900_000,
  };
  const unreadable = () =>
    Promise.reject(new AppError("credentials.decrypt_failed", { purpose: "backup.archive" }));

  it("leaves archives off with the code when the dashboard record will not decrypt", async () => {
    expect(
      await loadBackupSettings({
        env: { WAITRON_BACKUP_RECOVERY_KEY: HELD_KEY_TEXT },
        readSealed: unreadable,
      }),
    ).toEqual({ loadErrorCode: "credentials.decrypt_failed" });
  });

  it("leaves archives off with the code when an enabled dashboard record has no recovery key", async () => {
    expect(
      await loadBackupSettings({
        env: {},
        readSealed: async () => sealed,
      }),
    ).toEqual({ loadErrorCode: "backup.recovery_key_missing" });
  });

  it("names a failure that carries no code as unknown, never by its message", async () => {
    expect(
      await loadBackupSettings({
        env: {},
        readSealed: () => Promise.reject(new Error("secret-bearing message")),
      }),
    ).toEqual({ loadErrorCode: "unknown" });
  });

  const meta = { keyVersion: 1, writtenAt: "2026-10-29T10:00:00.000Z", digest: "0123456789abcdef" };
  const record = { digest: meta.digest, writtenAt: meta.writtenAt };
  const KEY = {
    WAITRON_BACKUP_RECOVERY_KEY: HELD_KEY_TEXT,
    WAITRON_BACKUP_KEY_NUMBER: "1",
    WAITRON_BACKUP_MASTER_KEY_ID: "0123456789abcdef",
  };

  it("keeps a failure's allowlisted detail beside its code", async () => {
    expect(
      await loadBackupSettings({
        env: KEY,
        readSealed: () =>
          Promise.reject(new AppError("backup.archive_settings_invalid", { reason: "retention" })),
      }),
    ).toEqual({
      loadErrorCode: "backup.archive_settings_invalid",
      loadErrorDetail: { reason: "retention" },
    });
  });

  it("names the record a failing read carried", async () => {
    expect(
      await loadBackupSettings({
        env: KEY,
        readSealedWithMeta: () => {
          const error = new AppError("credentials.key_version_unknown", {
            purpose: "backup.archive",
            keyVersion: 1,
          });
          attachRecordMeta(error, meta);
          return Promise.reject(error);
        },
      }),
    ).toEqual({
      loadErrorCode: "credentials.key_version_unknown",
      loadErrorDetail: { keyVersion: 1 },
      record,
    });
  });

  it("names no record when a failing read carried none", async () => {
    expect(
      await loadBackupSettings({
        env: KEY,
        readSealedWithMeta: unreadable,
      }),
    ).toEqual({ loadErrorCode: "credentials.decrypt_failed" });
  });

  it("names the record that read when the failure came after the read", async () => {
    const readSealedWithMeta = async () => ({ meta, settings: sealed });
    expect(
      await loadBackupSettings({
        env: {},
        readSealedWithMeta,
      }),
    ).toEqual({ loadErrorCode: "backup.recovery_key_missing", record });
    expect(
      await loadBackupSettings({
        env: { WAITRON_BACKUP_RECOVERY_KEY: "short" },
        readSealedWithMeta,
      }),
    ).toEqual({
      loadErrorCode: "backup.recovery_key_too_short",
      loadErrorDetail: { min: 12 },
      record,
    });
  });

  it("reads a record through its metadata as through the bare read", async () => {
    const bare = await loadBackupSettings({
      env: KEY,
      readSealed: async () => sealed,
    });
    expect(bare).toMatchObject({ revision: sealed.revision });
    expect(
      await loadBackupSettings({
        env: KEY,
        readSealedWithMeta: async () => ({ meta, settings: sealed }),
      }),
    ).toEqual(bare);
    expect(
      await loadBackupSettings({
        env: KEY,
        readSealedWithMeta: async () => ({ meta: null, settings: null }),
      }),
    ).toBeUndefined();
  });
});
