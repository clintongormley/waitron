import { backupKey, makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { describe, expect, it } from "vitest";
import { backupKeyFrameInput, backupKeyRecord } from "./backup-key-record.js";

describe("backupKeyRecord", () => {
  it("names backup key N of the master key by its number and the master key's id", () => {
    const masterKey = makeMasterKey();
    const publicKey = sealingPublicKey(masterKey);
    const record = backupKeyRecord(masterKey, 3, publicKey);
    expect(record).toEqual({
      key: backupKey(masterKey, 3).toString("base64url"),
      keyNumber: 3,
      masterKeyId: masterKeyId(publicKey).toString("hex"),
    });
    expect(Buffer.from(record.key, "base64url")).toHaveLength(32);
    expect(record.masterKeyId).toMatch(/^[0-9a-f]{16}$/);
    expect(backupKeyRecord(masterKey, 1, publicKey).key).not.toBe(record.key);
  });
});

describe("backupKeyFrameInput", () => {
  const record = backupKeyRecord(makeMasterKey(), 2, sealingPublicKey(makeMasterKey()));

  it("takes the key's 32 bytes, its number and the id's 8 bytes", () => {
    expect(backupKeyFrameInput(record)).toEqual({
      backupKey: Buffer.from(record.key, "base64url"),
      keyNumber: 2,
      masterKeyId: Buffer.from(record.masterKeyId, "hex"),
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
