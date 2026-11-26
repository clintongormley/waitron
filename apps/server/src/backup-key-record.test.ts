import { backupKey, makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { describe, expect, it } from "vitest";
import { backupKeyRecord } from "./backup-key-record.js";

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
