import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { ArchiveSettings } from "./archive-settings.js";
import {
  BACKUP_ENV_KEYS,
  isBackupManagedByEnvironment,
  loadBackupConfig as loadWithVenue,
  loadBackupSettings,
  loadRecoveryKey,
  resolveBackupConfig,
} from "./backup-config.js";

const VENUE = "c0000000-0000-4000-8000-000000000002";
const loadBackupConfig = (env: Record<string, string | undefined>) => loadWithVenue(env, VENUE);

describe("loadBackupConfig", () => {
  it("returns undefined when WAITRON_BACKUP_DIR is unset (backup off)", () => {
    expect(loadBackupConfig({})).toBeUndefined();
    expect(loadBackupConfig({ WAITRON_BACKUP_DIR: "" })).toBeUndefined();
  });
  it("names no database connection, even when the retired variable is set", () => {
    // An absent KEY, not an undefined value: `toMatchObject` passes on a key it is never shown.
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/b",
      WAITRON_BACKUP_DATABASE_URL: "postgres://x",
      WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
    })!;
    expect(Object.keys(c)).not.toContain("databaseUrl");
    // Ignored, not refused.
    expect(c.destinations).toHaveLength(1);
  });
  it("builds a config with defaults", () => {
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/b",
      WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
    });
    expect(c).toMatchObject({
      recoveryKey: "twelve-chars!",
      retain: expect.any(Number),
      retainDays: expect.any(Number),
      staleAfterMs: expect.any(Number),
    });
    expect(c!.schedule).toEqual({ kind: "interval", ms: expect.any(Number) });
    expect((c!.destinations[0] as { dir: string }).dir).toMatch(/^\//); // resolved absolute
  });
  it("rejects a non-positive retain count", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/b",
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

describe("loadBackupConfig schedule + dual retention", () => {
  it("parses a wall-clock schedule (daily at HH:MM)", () => {
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/mnt/usb",
      WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
      WAITRON_BACKUP_SCHEDULE_DAYS: "daily",
      WAITRON_BACKUP_AT: "04:30",
    })!;
    expect(c.schedule).toEqual({ kind: "wall-clock", days: "daily", at: { hour: 4, minute: 30 } });
  });

  it("parses a weekday subset and 'auto' time", () => {
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/mnt/usb",
      WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
      WAITRON_BACKUP_SCHEDULE_DAYS: "1,3,5",
      WAITRON_BACKUP_AT: "auto",
    })!;
    expect(c.schedule).toEqual({ kind: "wall-clock", days: [1, 3, 5], at: "auto" });
  });

  it("applies dual-retention defaults (7 count, 30 days)", () => {
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/mnt/usb",
      WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
      WAITRON_BACKUP_SCHEDULE_DAYS: "daily",
      WAITRON_BACKUP_AT: "auto",
    })!;
    expect(c.retain).toBe(7);
    expect(c.retainDays).toBe(30);
  });

  it("uses the legacy interval mode when no wall-clock schedule is set", () => {
    const c = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/mnt/usb",
      WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
      WAITRON_BACKUP_INTERVAL_MS: "3600000",
    })!;
    expect(c.schedule).toEqual({ kind: "interval", ms: 3600000 });
  });

  it("rejects both an interval and a wall-clock schedule", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/mnt/usb",
        WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
        WAITRON_BACKUP_INTERVAL_MS: "3600000",
        WAITRON_BACKUP_AT: "04:00",
      }),
    ).toThrow(/schedule_invalid/);
  });

  it("rejects a blank/whitespace-only weekday token (Number('') is 0)", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/mnt/usb",
        WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
        WAITRON_BACKUP_SCHEDULE_DAYS: "1, ,3",
      }),
    ).toThrow(/schedule_invalid/);
  });

  it("rejects a malformed time", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/mnt/usb",
        WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
        WAITRON_BACKUP_SCHEDULE_DAYS: "daily",
        WAITRON_BACKUP_AT: "25:99",
      }),
    ).toThrow(/schedule_invalid/);
  });

  function scheduleRefusal(env: Record<string, string>): unknown {
    try {
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/mnt/usb",
        WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
        ...env,
      });
    } catch (error) {
      return error;
    }
    throw new Error("expected loadBackupConfig to refuse the schedule");
  }

  it.each(["7", "1.5", "-1", "mon"])("rejects the weekday %j as bad_day", (days) => {
    expect(scheduleRefusal({ WAITRON_BACKUP_SCHEDULE_DAYS: days })).toMatchObject({
      code: "backup.schedule_invalid",
      params: { reason: "bad_day" },
    });
  });

  it.each(["4am", "4:5", "04:00:00", "004:00"])(
    "rejects the time %j, which is not HH:MM, as bad_time",
    (at) => {
      expect(scheduleRefusal({ WAITRON_BACKUP_AT: at })).toMatchObject({
        code: "backup.schedule_invalid",
        params: { reason: "bad_time" },
      });
    },
  );

  it("carries an explicit keyRotatedAt through, undefined when unset", () => {
    const withRotation = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/mnt/usb",
      WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
      WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-09T00:00:00.000Z",
    })!;
    expect(withRotation.keyRotatedAt).toBe("2026-09-09T00:00:00.000Z");
    const withoutRotation = loadBackupConfig({
      WAITRON_BACKUP_DIR: "/mnt/usb",
      WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    })!;
    expect(withoutRotation.keyRotatedAt).toBeUndefined();
  });
});

const base = {
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
    expect(() => loadBackupConfig({ WAITRON_BACKUP_DIR: "/mnt/a" })).toThrow(
      new AppError("backup.recovery_key_missing", {}),
    );
  });

  it("rejects a too-short recovery key", () => {
    expect(() =>
      loadBackupConfig({
        WAITRON_BACKUP_DIR: "/mnt/a",
        WAITRON_BACKUP_RECOVERY_KEY: "short",
      }),
    ).toThrow(new AppError("backup.recovery_key_too_short", { min: 12 }));
  });

  // The last two pin that an empty id or dir fails closed: `resolve("")` is the working directory.
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

describe("loadRecoveryKey", () => {
  it("is undefined when the key is unset or empty", () => {
    expect(loadRecoveryKey({})).toBeUndefined();
    expect(loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: "" })).toBeUndefined();
  });

  it("returns the key with no archive destination configured", () => {
    expect(loadBackupConfig({ WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" })).toBeUndefined();
    expect(loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" })).toBe("twelve-chars!");
  });

  it("refuses a key under the floor even with no destination", () => {
    expect(() => loadRecoveryKey({ WAITRON_BACKUP_RECOVERY_KEY: "short" })).toThrow(
      new AppError("backup.recovery_key_too_short", { min: 12 }),
    );
  });
});

describe("loadBackupConfig destination time limit", () => {
  const base = { WAITRON_BACKUP_DIR: "/b", WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" };
  const refusal = (reason: string) =>
    new AppError("server.config_invalid", {
      variable: "WAITRON_BACKUP_DESTINATION_TIMEOUT_MS",
      reason,
    });

  it("defaults to 15 minutes, and reads an empty value as unset", () => {
    expect(loadBackupConfig(base)!.destinationTimeoutMs).toBe(900_000);
    expect(
      loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: "" })!
        .destinationTimeoutMs,
    ).toBe(900_000);
  });

  it("accepts whole milliseconds from 30 seconds to 24 hours", () => {
    for (const ms of [30_000, 120_000, 86_400_000]) {
      expect(
        loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: String(ms) })!
          .destinationTimeoutMs,
      ).toBe(ms);
    }
  });

  it("refuses a value outside the range", () => {
    for (const raw of ["29999", "86400001"]) {
      expect(() =>
        loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: raw }),
      ).toThrow(refusal("timeout_out_of_range"));
    }
  });

  it("refuses a value that is not a whole number", () => {
    for (const raw of ["60000.5", "abc", "-60000"]) {
      expect(() =>
        loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: raw }),
      ).toThrow(refusal("not_a_positive_integer"));
    }
  });
});

describe("loadBackupConfig bucket destinations", () => {
  const SECRET = "env-secret-access-key";
  const s3 = {
    kind: "s3",
    id: "offsite",
    endpoint: "https://s3.example.test",
    region: "eu-north-1",
    bucket: "owner-bucket",
    prefix: "waitron",
    accessKeyId: "AKIAENV",
    secretAccessKey: SECRET,
  };
  const withEntries = (entries: unknown[]) => ({
    ...base,
    WAITRON_BACKUP_DESTINATIONS: JSON.stringify(entries),
  });
  const refusalOf = (run: () => unknown): { code: string; params: unknown } => {
    try {
      run();
    } catch (e) {
      const err = e as AppError;
      return { code: err.code, params: err.params };
    }
    throw new Error("expected a refusal");
  };

  it("reads a bucket entry and stamps the venue id on it", () => {
    const cfg = loadWithVenue(withEntries([s3]), VENUE)!;
    expect(cfg.destinations).toEqual([
      {
        kind: "s3",
        id: "offsite",
        venueId: VENUE,
        bucket: {
          endpoint: "https://s3.example.test",
          region: "eu-north-1",
          bucket: "owner-bucket",
          prefix: "waitron",
          accessKeyId: "AKIAENV",
          secretAccessKey: SECRET,
        },
      },
    ]);
    expect(cfg).toMatchObject({ source: "environment", revision: undefined, enabled: true });
  });

  it("reads a bucket entry with no endpoint or prefix", () => {
    const bare = { ...s3 } as Partial<typeof s3>;
    delete bare.endpoint;
    delete bare.prefix;
    const cfg = loadWithVenue(withEntries([bare]), VENUE)!;
    expect(cfg.destinations[0]).toEqual({
      kind: "s3",
      id: "offsite",
      venueId: VENUE,
      bucket: {
        region: "eu-north-1",
        bucket: "owner-bucket",
        prefix: "",
        accessKeyId: "AKIAENV",
        secretAccessKey: SECRET,
      },
    });
  });

  it.each([
    ["a number for the bucket", { ...s3, bucket: 7 }],
    ["a null region", { ...s3, region: null }],
    ["an array for the access key id", { ...s3, accessKeyId: ["AKIAENV"] }],
    ["no secret", { ...s3, secretAccessKey: undefined }],
    ["an empty secret", { ...s3, secretAccessKey: "" }],
    ["an unknown field", { ...s3, sessionToken: "x" }],
    ["an unknown kind", { ...s3, kind: "gcs" }],
    ["a null entry", null],
    ["an array entry", [s3]],
    ["a bad endpoint", { ...s3, endpoint: "ftp://x" }],
    ["a prefix with a parent segment", { ...s3, prefix: "a/../b" }],
  ])("refuses %s with no value in the refusal", (_name, entry) => {
    const r = refusalOf(() => loadWithVenue(withEntries([entry]), VENUE));
    expect(r).toEqual({ code: "backup.destinations_invalid", params: { reason: "bad_entry" } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("refuses two entries naming the same bucket place, however the endpoint and prefix are spelled", () => {
    const again = {
      ...s3,
      id: "offsite-2",
      endpoint: "https://s3.example.test/",
      prefix: "/waitron/",
      accessKeyId: "AKIAOTHER",
    };
    expect(() => loadWithVenue(withEntries([s3, again]), VENUE)).toThrow(
      new AppError("backup.destinations_invalid", { reason: "duplicate_bucket" }),
    );
  });

  it("accepts two entries in different buckets", () => {
    const other = { ...s3, id: "offsite-2", bucket: "second-bucket" };
    expect(loadWithVenue(withEntries([s3, other]), VENUE)!.destinations).toHaveLength(2);
  });

  it("refuses a folder entry carrying a field a folder does not take", () => {
    expect(
      refusalOf(() =>
        loadWithVenue(
          withEntries([{ kind: "local-fs", id: "usb", dir: "/mnt/usb", bucket: "x" }]),
          VENUE,
        ),
      ),
    ).toEqual({ code: "backup.destinations_invalid", params: { reason: "bad_entry" } });
  });

  it("refuses an id shared by a folder and a bucket", () => {
    expect(() =>
      loadWithVenue(withEntries([{ kind: "local-fs", id: "offsite", dir: "/mnt/a" }, s3]), VENUE),
    ).toThrow(new AppError("backup.destinations_invalid", { reason: "duplicate_id" }));
  });
});

describe("isBackupManagedByEnvironment", () => {
  it("counts the destination time limit as an environment setting", () => {
    expect(BACKUP_ENV_KEYS).toContain("WAITRON_BACKUP_DESTINATION_TIMEOUT_MS");
    expect(isBackupManagedByEnvironment({ WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: "60000" })).toBe(
      true,
    );
  });

  it("is false with every backup variable unset or empty", () => {
    expect(isBackupManagedByEnvironment({})).toBe(false);
    expect(isBackupManagedByEnvironment({ WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: "" })).toBe(false);
  });
});

describe("resolveBackupConfig", () => {
  const KEY = "held-recovery-key-0123";
  const sealed: ArchiveSettings = {
    revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
    enabled: true,
    destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
    schedule: { kind: "wall-clock", days: [1, 3], at: { hour: 4, minute: 15 } },
    retention: { count: 5, days: 12 },
    destinationTimeoutMs: 120_000,
  };

  it("ignores a sealed record when the environment owns the settings", () => {
    const cfg = resolveBackupConfig({
      managedByEnvironment: true,
      env: { WAITRON_BACKUP_DIR: "/mnt/env", WAITRON_BACKUP_RECOVERY_KEY: KEY },
      sealed,
      venueId: VENUE,
    })!;
    expect(cfg.destinations).toEqual([{ kind: "local-fs", id: "primary", dir: "/mnt/env" }]);
    expect(cfg).toMatchObject({ source: "environment", revision: undefined, enabled: true });
  });

  it("is undefined with no sealed record, even when backup.env still names a folder", () => {
    expect(
      resolveBackupConfig({
        managedByEnvironment: false,
        env: { WAITRON_BACKUP_DIR: "/mnt/leftover", WAITRON_BACKUP_RECOVERY_KEY: KEY },
        sealed: null,
        venueId: VENUE,
      }),
    ).toBeUndefined();
  });

  it("builds the config from an enabled sealed record", () => {
    const cfg = resolveBackupConfig({
      managedByEnvironment: false,
      env: {
        WAITRON_BACKUP_RECOVERY_KEY: KEY,
        WAITRON_BACKUP_KEY_ROTATED_AT: "2026-10-01T00:00:00.000Z",
        // Not read on this path: the record carries its own time limit.
        WAITRON_BACKUP_DESTINATION_TIMEOUT_MS: "60000",
      },
      sealed,
      venueId: VENUE,
    });
    expect(cfg).toEqual({
      source: "dashboard",
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
    });
  });

  it("carries a stored switch-off", () => {
    const cfg = resolveBackupConfig({
      managedByEnvironment: false,
      env: { WAITRON_BACKUP_RECOVERY_KEY: KEY },
      sealed: { ...sealed, enabled: false },
      venueId: VENUE,
    });
    expect(cfg).toMatchObject({ enabled: false, source: "dashboard", revision: sealed.revision });
  });

  it("refuses an enabled record when no recovery key is held", () => {
    expect(() =>
      resolveBackupConfig({ managedByEnvironment: false, env: {}, sealed, venueId: VENUE }),
    ).toThrow(new AppError("backup.recovery_key_missing", {}));
  });

  it("reports a switched-off record with no held key, without throwing", () => {
    const cfg = resolveBackupConfig({
      managedByEnvironment: false,
      env: {},
      sealed: { ...sealed, enabled: false },
      venueId: VENUE,
    });
    expect(cfg).toMatchObject({ enabled: false, recoveryKey: undefined });
  });
});

describe("resolveBackupConfig with a held key under the length floor", () => {
  it("reports a switched-off record without throwing", () => {
    const cfg = resolveBackupConfig({
      managedByEnvironment: false,
      env: { WAITRON_BACKUP_RECOVERY_KEY: "short" },
      sealed: {
        revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
        enabled: false,
        destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
        schedule: { kind: "interval", ms: 86_400_000 },
        retention: { count: 7, days: 30 },
        destinationTimeoutMs: 900_000,
      },
      venueId: VENUE,
    });
    expect(cfg).toMatchObject({ enabled: false, recoveryKey: undefined });
  });
});

describe("loadBackupSettings", () => {
  const sealed: ArchiveSettings = {
    revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
    enabled: true,
    destinations: [{ kind: "local-fs", id: "primary", dir: "/mnt/sealed" }],
    schedule: { kind: "interval", ms: 86_400_000 },
    retention: { count: 7, days: 30 },
    destinationTimeoutMs: 900_000,
  };
  const unreadable = () =>
    Promise.reject(new AppError("credentials.decrypt_failed", { purpose: "backup.archive" }));

  it("still refuses an environment the box cannot use, and never reads the sealed record", async () => {
    let read = false;
    await expect(
      loadBackupSettings({
        managedByEnvironment: true,
        env: { WAITRON_BACKUP_DESTINATIONS: "not json" },
        readSealed: async () => {
          read = true;
          return sealed;
        },
        venueId: VENUE,
      }),
    ).rejects.toMatchObject({ code: "backup.destinations_invalid" });
    expect(read).toBe(false);
  });

  it("leaves archives off with the code when the dashboard record will not decrypt", async () => {
    expect(
      await loadBackupSettings({
        managedByEnvironment: false,
        env: { WAITRON_BACKUP_RECOVERY_KEY: "held-recovery-key-0123" },
        readSealed: unreadable,
        venueId: VENUE,
      }),
    ).toEqual({ loadErrorCode: "credentials.decrypt_failed" });
  });

  it("leaves archives off with the code when an enabled dashboard record has no recovery key", async () => {
    expect(
      await loadBackupSettings({
        managedByEnvironment: false,
        env: {},
        readSealed: async () => sealed,
        venueId: VENUE,
      }),
    ).toEqual({ loadErrorCode: "backup.recovery_key_missing" });
  });

  it("names a failure that carries no code as unknown, never by its message", async () => {
    expect(
      await loadBackupSettings({
        managedByEnvironment: false,
        env: {},
        readSealed: () => Promise.reject(new Error("secret-bearing message")),
        venueId: VENUE,
      }),
    ).toEqual({ loadErrorCode: "unknown" });
  });
});
