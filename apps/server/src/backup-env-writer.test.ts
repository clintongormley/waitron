import { mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertStorableKey } from "./backup-api.js";
import {
  assertStorableRecord,
  checkBackupSettings,
  replaceBackupSettings,
  writeRecoveryKey,
} from "./backup-env-writer.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { syncsAndRenames as recordSyncsAndRenames } from "./testing/durable-writes.js";

vi.mock("node:fs/promises", { spy: true });

const syncsAndRenames = (run: () => Promise<unknown>) =>
  recordSyncsAndRenames(
    { mkdir: vi.mocked(fs.mkdir), open: vi.mocked(fs.open), rename: vi.mocked(fs.rename) },
    run,
  );

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
      WAITRON_BACKUP_TEST_FOLDER: "/srv/backups",
      WAITRON_BACKUP_RECOVERY_KEY: "abcDEF-_1234567890",
      WAITRON_BACKUP_TEST_INTERVAL: "3600000",
    };
    expect(() => assertStorableRecord(clean)).not.toThrow();
    // A newline in ANY value injects a second KEY=value line on the round-trip.
    expect(() =>
      assertStorableRecord({ ...clean, WAITRON_BACKUP_TEST_FOLDER: "/srv\nEVIL=1" }),
    ).toThrow(/destinations_invalid/);
    // A bare carriage return / control char is refused too.
    expect(() => assertStorableRecord({ ...clean, WAITRON_BACKUP_TEST_FOLDER: "/srv\rx" })).toThrow(
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
    expect(refusal({ WAITRON_BACKUP_TEST_FOLDER: "/srv/backups " })).toMatchObject({
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
  it("syncs backup.env before renaming it into place, and the folder after", async () => {
    const dir = tempDir();
    const path = join(dir, "backup.env");
    const events = await syncsAndRenames(() =>
      writeRecoveryKey(dir, { recoveryKey: "abcDEF-_1234567890", keyRotatedAt: undefined }),
    );
    expect(events).toEqual([`sync ${path}.tmp`, `rename ${path}.tmp ${path}`, `sync ${dir}`]);
  });

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
        WAITRON_BACKUP_TEST_FOLDER: "/srv/backups",
        WAITRON_BACKUP_RECOVERY_KEY: "old-key-0123456789",
        WAITRON_BACKUP_TEST_INTERVAL: "3600000",
        WAITRON_BACKUP_TEST_COUNT: "7",
        WAITRON_BACKUP_TEST_AGE: "30",
      }),
    );
    await writeRecoveryKey(dir, {
      recoveryKey: "new-key-0123456789",
      keyRotatedAt: "2026-09-23T00:00:00.000Z",
    });
    expect(parseEnvFile(await readFile(join(dir, "backup.env"), "utf8"))).toEqual({
      WAITRON_BACKUP_TEST_FOLDER: "/srv/backups",
      WAITRON_BACKUP_RECOVERY_KEY: "new-key-0123456789",
      WAITRON_BACKUP_TEST_INTERVAL: "3600000",
      WAITRON_BACKUP_TEST_COUNT: "7",
      WAITRON_BACKUP_TEST_AGE: "30",
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

const SECRET = "secret-recovery-key-0123456789";

const REFUSED: ReadonlyArray<[string, unknown, string]> = [
  ["a name outside WAITRON_BACKUP_", { WAITRON_BACKUP_RECOVERY_KEY: SECRET, PATH: "/bin" }, "name"],
  ["a lower-case name", { waitron_backup_dir: SECRET }, "name"],
  ["a value that is not text", { WAITRON_BACKUP_TEST_COUNT: 7 }, "value"],
  ["a value holding a tab", { WAITRON_BACKUP_RECOVERY_KEY: `${SECRET}\tx` }, "control_char"],
  ["a value holding a newline", { WAITRON_BACKUP_RECOVERY_KEY: `${SECRET}\nX=1` }, "control_char"],
  [
    "a value the file would not round-trip",
    { WAITRON_BACKUP_TEST_FOLDER: `${SECRET} ` },
    "round_trip",
  ],
  ["an array", [SECRET], "shape"],
];

describe("replaceBackupSettings", () => {
  it("replaces the settings whole and owner-only", async () => {
    const dir = tempDir();
    await writeFile(
      join(dir, "backup.env"),
      "WAITRON_BACKUP_TEST_FOLDER=/srv/old\nWAITRON_BACKUP_TEST_COUNT=7\n",
    );
    await replaceBackupSettings(dir, {
      WAITRON_BACKUP_RECOVERY_KEY: SECRET,
      WAITRON_BACKUP_TEST_FOLDER: "/srv/new",
    });
    expect(parseEnvFile(await readFile(join(dir, "backup.env"), "utf8"))).toEqual({
      WAITRON_BACKUP_RECOVERY_KEY: SECRET,
      WAITRON_BACKUP_TEST_FOLDER: "/srv/new",
    });
    expect((await stat(join(dir, "backup.env"))).mode & 0o777).toBe(0o600);
  });

  it("syncs backup.env before renaming it into place, and the folder after", async () => {
    const dir = tempDir();
    const path = join(dir, "backup.env");
    const events = await syncsAndRenames(() =>
      replaceBackupSettings(dir, { WAITRON_BACKUP_TEST_FOLDER: "/srv/new" }),
    );
    expect(events).toEqual([`sync ${path}.tmp`, `rename ${path}.tmp ${path}`, `sync ${dir}`]);
  });

  it("null removes the file, and removing a missing file is not an error", async () => {
    const dir = tempDir();
    await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_TEST_FOLDER=/srv\n");
    await replaceBackupSettings(dir, null);
    await expect(stat(join(dir, "backup.env"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(replaceBackupSettings(dir, null)).resolves.toBeUndefined();
  });

  it.each(REFUSED)(
    "refuses %s, writing nothing and naming no value",
    async (_label, record, reason) => {
      const dir = tempDir();
      await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_TEST_FOLDER=/srv/kept\n");
      const refusal = await replaceBackupSettings(dir, record as Record<string, string>).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal).toMatchObject({ code: "spare.settings_invalid", params: { reason } });
      expect(Object.keys((refusal as { params: object }).params)).toEqual(["reason"]);
      expect(JSON.stringify(refusal)).not.toContain("secret-recovery");
      expect(String((refusal as Error).message)).not.toContain("secret-recovery");
      expect(await readFile(join(dir, "backup.env"), "utf8")).toBe(
        "WAITRON_BACKUP_TEST_FOLDER=/srv/kept\n",
      );
    },
  );

  it.each(REFUSED)("the check refuses %s exactly as the writer does", (_label, record, reason) => {
    expect(checkBackupSettings(record)).toEqual({ ok: false, reason });
  });

  it("the check refuses null and text, which are no settings record", () => {
    expect(checkBackupSettings(null)).toEqual({ ok: false, reason: "shape" });
    expect(checkBackupSettings(SECRET)).toEqual({ ok: false, reason: "shape" });
  });

  it("control: the check passes a clean record through", () => {
    const record = { WAITRON_BACKUP_RECOVERY_KEY: SECRET, WAITRON_BACKUP_TEST_FOLDER: "/srv" };
    expect(checkBackupSettings(record)).toEqual({ ok: true, settings: record });
  });
});
