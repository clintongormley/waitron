import { backupKey, makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { describe, expect, it } from "vitest";
import {
  backupKeyFacts,
  backupKeyFrameInput,
  backupKeyRecord,
  heldBackupKeyNumber,
  masterKeyDayOf,
} from "./backup-key-record.js";
import { backupKeySettings, heldBackupKey } from "./testing/backup-key.js";

describe("backupKeyRecord", () => {
  it("names backup key N of the master key by its number and the master key's id and day", () => {
    const masterKey = makeMasterKey();
    const publicKey = sealingPublicKey(masterKey);
    const record = backupKeyRecord(masterKey, 3, publicKey, "2026-11-23");
    expect(record).toEqual({
      key: backupKey(masterKey, 3).toString("base64url"),
      keyNumber: 3,
      masterKeyId: masterKeyId(publicKey).toString("hex"),
      masterKeyDay: "2026-11-23",
    });
    expect(Buffer.from(record.key, "base64url")).toHaveLength(32);
    expect(record.masterKeyId).toMatch(/^[0-9a-f]{16}$/);
    expect(backupKeyRecord(masterKey, 1, publicKey, "2026-11-23").key).not.toBe(record.key);
  });
});

describe("masterKeyDayOf", () => {
  it("takes the day a master key's name begins with", () => {
    expect(masterKeyDayOf("2026-11-23 · ABCD")).toBe("2026-11-23");
  });

  it.each(["ABCD · 2026-11-23", "2026-02-30 · ABCD", ""])(
    "refuses %j, whose first ten characters are not a calendar date",
    (name) => {
      expect(() => masterKeyDayOf(name)).toThrow(
        expect.objectContaining({ code: "master_key.name_day_invalid" }),
      );
    },
  );
});

describe("backupKeyFrameInput", () => {
  const record = backupKeyRecord(
    makeMasterKey(),
    2,
    sealingPublicKey(makeMasterKey()),
    "2026-11-23",
  );

  it("takes the key's 32 bytes, its number, the id's 8 bytes and the master key's day", () => {
    expect(backupKeyFrameInput(record)).toEqual({
      backupKey: Buffer.from(record.key, "base64url"),
      keyNumber: 2,
      masterKeyId: Buffer.from(record.masterKeyId, "hex"),
      masterKeyDay: "2026-11-23",
    });
  });

  it.each([
    ["a trailing =", `${record.key}=`],
    ["31 bytes", Buffer.alloc(31, 9).toString("base64url")],
  ])("refuses key text with %s, which the opener would refuse", (_, key) => {
    expect(() => backupKeyFrameInput({ ...record, key })).toThrow(
      expect.objectContaining({
        code: "backup.archive_key_invalid",
        params: { input: "backup_key" },
      }),
    );
  });
});

describe("heldBackupKeyNumber", () => {
  const masterKey = makeMasterKey();
  const seven = backupKeySettings(heldBackupKey(masterKey, 7));
  const without = (name: string) =>
    Object.fromEntries(Object.entries(seven).filter(([key]) => key !== name));

  it("reads the held key's number with or without its master key's day and id", () => {
    expect(heldBackupKeyNumber(seven)).toBe(7);
    expect(heldBackupKeyNumber(without("WAITRON_BACKUP_MASTER_KEY_DAY"))).toBe(7);
    expect(heldBackupKeyNumber(without("WAITRON_BACKUP_MASTER_KEY_ID"))).toBe(7);
  });

  it("is 0 when no key is held, or one that cannot be a backup key, with no number", () => {
    expect(heldBackupKeyNumber({})).toBe(0);
    expect(heldBackupKeyNumber({ WAITRON_BACKUP_RECOVERY_KEY: "short" })).toBe(0);
    expect(heldBackupKeyNumber({ WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(64) })).toBe(0);
  });

  it.each([
    ["no number", undefined],
    ["the number 0", "0"],
    ["a number that is not one", "seven"],
  ])("cannot tell the number of a backup key held with %s", (_, number) => {
    const env = without("WAITRON_BACKUP_KEY_NUMBER");
    expect(
      heldBackupKeyNumber(
        number === undefined ? env : { ...env, WAITRON_BACKUP_KEY_NUMBER: number },
      ),
    ).toBeUndefined();
  });
});

describe("backupKeyFacts", () => {
  it("gives the held key's number when backup.env does not name its master key's day", () => {
    const masterKey = makeMasterKey();
    const settings = backupKeySettings(heldBackupKey(masterKey, 7));
    delete settings.WAITRON_BACKUP_MASTER_KEY_DAY;
    expect(backupKeyFacts(settings, sealingPublicKey(masterKey))).toMatchObject({
      number: 7,
      fromCurrentMasterKey: true,
    });
  });
});
