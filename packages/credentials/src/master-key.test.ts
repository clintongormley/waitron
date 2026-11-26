import { createHash, hkdfSync } from "node:crypto";
import { AppError, decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import * as masterKeyModule from "./master-key.js";
import {
  authorityKey,
  authorityKeyMatches,
  backupKey,
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyId,
  masterKeyMatches,
  masterKeyName,
  masterKeyNameOf,
  sealingPublicKey,
} from "./master-key.js";

const fixedKey = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
const salt = Buffer.from("waitron.master-key.v1", "ascii");

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

// Computed once by a standalone `python3 -I` script (its own base-31 arithmetic, hashlib and an
// HMAC-written HKDF, the authority key and check value also matched by `openssl kdf` and
// `openssl dgst`) and `openssl pkey -pubout` for the public key; never with this module.
describe("the fixed vectors", () => {
  it("checks and derives a fixed 16-byte key", () => {
    expect(authorityKey(fixedKey).toString("hex")).toBe(
      "c31f1f410d875eb410aeb5848d18b7de40e24b308aa540c8f3252e9b5e0b7bce",
    );
    expect(masterKeyCheckValue(fixedKey)).toBe(
      "5e2bf9720f0c2061fde2bb17ba2dec8c6ff69dc6b921c10ab881c4cd79eb2294",
    );
    expect(sealingPublicKey(fixedKey).toString("hex")).toBe(
      "302a300506032b656e032100f786e9f43caab2e56280477c8130cd8f4371391a07a6ae6b019786bf5d499a50",
    );
    expect(masterKeyId(sealingPublicKey(fixedKey)).toString("hex")).toBe("88286ca83ba00be7");
    expect(masterKeyName(sealingPublicKey(fixedKey), "2026-11-23")).toBe("2026-11-23 · EG6B");
  });

  it("backupKey's fixed vectors", () => {
    expect(backupKey(fixedKey, 1).toString("hex")).toBe(
      "20c0935fd7e427b2ccdd2448279fad97e45ddfac8cd80b55722541f62617c756",
    );
    expect(backupKey(fixedKey, 3).toString("hex")).toBe(
      "8ebc546b2206fedf736ac430f271aebbec11c6dcecd9fdf001cb9f1c568c73ba",
    );
    expect(backupKey(fixedKey, 12).toString("hex")).toBe(
      "e3e5c18e311c1b8d794820aa88a654e6198cdc1339c2646093e1e7971b038415",
    );
  });
});

describe("backup key N", () => {
  it("N is written in decimal with no leading zeros", () => {
    const hkdf = (info: string) => Buffer.from(hkdfSync("sha256", fixedKey, salt, info, 32));
    expect(backupKey(fixedKey, 3).equals(hkdf("backup-key.3"))).toBe(true);
    expect(backupKey(fixedKey, 12).equals(hkdf("backup-key.012"))).toBe(false);
    expect(backupKey(fixedKey, 3).equals(backupKey(fixedKey, 4))).toBe(false);
    expect(backupKey(fixedKey, 0xffff_ffff).equals(hkdf("backup-key.4294967295"))).toBe(true);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0x1_0000_0000,
    Number.MAX_SAFE_INTEGER + 1,
  ])("refuses backup key number %s", (n) => {
    const error = refusal(() => backupKey(fixedKey, n));
    expect(error.code).toBe("master_key.derivation_input_invalid");
    expect(error.params).toEqual({ input: "backup_key_number" });
  });

  it("refuses a master key that is not 16 bytes", () => {
    expect(refusal(() => backupKey(Buffer.alloc(15), 1)).code).toBe("master_key.code_invalid");
  });
});

describe("HKDF takes the decoded bytes, not the printed text", () => {
  it("derives from the 16 bytes a printed key reads back to", () => {
    const printed = encodeMasterKeyCode(fixedKey);
    const fromBytes = Buffer.from(hkdfSync("sha256", fixedKey, salt, "authority", 32));
    for (const text of [printed, printed.replaceAll(" ", "")])
      expect(Buffer.from(hkdfSync("sha256", text, salt, "authority", 32)).equals(fromBytes)).toBe(
        false,
      );
    expect(authorityKey(decodeMasterKeyCode(printed)).equals(fromBytes)).toBe(true);
  });
});

describe("making a master key", () => {
  it("makes 16 fresh random bytes each time", () => {
    const first = makeMasterKey();
    expect(first).toHaveLength(16);
    expect(first.equals(makeMasterKey())).toBe(false);
  });

  it.each([Buffer.alloc(15), Buffer.alloc(17), Buffer.alloc(0)])(
    "refuses a master key that is not 16 bytes %#",
    (bytes) => {
      for (const use of [
        () => authorityKey(bytes),
        () => masterKeyCheckValue(bytes),
        () => sealingPublicKey(bytes),
        () => masterKeyMatches(bytes, masterKeyCheckValue(fixedKey)),
      ])
        expect(refusal(use).code).toBe("master_key.code_invalid");
    },
  );

  it("never hands out the sealing private key", () => {
    expect(Object.keys(masterKeyModule).sort()).toEqual([
      "LARGEST_BACKUP_KEY_NUMBER",
      "authorityKey",
      "authorityKeyMatches",
      "backupKey",
      "makeMasterKey",
      "masterKeyCheckValue",
      "masterKeyId",
      "masterKeyMatches",
      "masterKeyName",
      "masterKeyNameOf",
      "sealingPublicKey",
    ]);
  });
});

describe("checking a typed master key", () => {
  const stored = masterKeyCheckValue(fixedKey);

  it("matches the key whose check value is stored", () => {
    expect(stored).toBe(createHash("sha256").update(authorityKey(fixedKey)).digest("hex"));
    expect(masterKeyMatches(decodeMasterKeyCode(encodeMasterKeyCode(fixedKey)), stored)).toBe(true);
  });

  it.each([
    ["another key", masterKeyCheckValue(makeMasterKey())],
    ["upper-case hex", stored.toUpperCase()],
    ["a short value", stored.slice(2)],
    ["a long value", `${stored}00`],
    ["a non-hex value", `${stored.slice(1)}g`],
    ["empty text", ""],
  ])("does not match %s", (_label, checkValue) => {
    expect(masterKeyMatches(fixedKey, checkValue)).toBe(false);
  });
});

describe("checking a staged authority key", () => {
  const stored = masterKeyCheckValue(fixedKey);

  it("an authority key matches the check value of its master key, and another key's does not", () => {
    const authority = Buffer.from(
      "c31f1f410d875eb410aeb5848d18b7de40e24b308aa540c8f3252e9b5e0b7bce",
      "hex",
    );
    expect(authorityKeyMatches(authority, stored)).toBe(true);
    expect(authorityKeyMatches(authority, masterKeyCheckValue(makeMasterKey()))).toBe(false);
    expect(authorityKeyMatches(authorityKey(makeMasterKey()), stored)).toBe(false);
  });

  it.each([
    ["upper-case hex", stored.toUpperCase()],
    ["a short value", stored.slice(2)],
    ["a long value", `${stored}0`],
    ["a non-hex value", `${stored.slice(1)}g`],
    ["empty text", ""],
  ])("does not match %s", (_label, checkValue) => {
    expect(authorityKeyMatches(authorityKey(fixedKey), checkValue)).toBe(false);
  });

  it.each([Buffer.alloc(31), Buffer.alloc(33), Buffer.alloc(0), fixedKey])(
    "does not match an authority key that is not 32 bytes %#",
    (authority) => {
      expect(authorityKeyMatches(authority, stored)).toBe(false);
    },
  );
});

describe("the master key's name", () => {
  it("is the day and the first 4 symbols of the master key id", () => {
    const publicKey = sealingPublicKey(makeMasterKey());
    const name = masterKeyName(publicKey, "2027-01-31");
    expect(name).toMatch(/^2027-01-31 · [2-9A-HJKMNP-Z]{4}$/);
    expect(masterKeyName(publicKey, "2027-02-01").slice(-4)).toBe(name.slice(-4));
  });

  it("is the same name when read from the master key id alone", () => {
    const publicKey = sealingPublicKey(makeMasterKey());
    expect(masterKeyNameOf(masterKeyId(publicKey), "2027-01-31")).toBe(
      masterKeyName(publicKey, "2027-01-31"),
    );
    expect(masterKeyNameOf(masterKeyId(sealingPublicKey(fixedKey)), "2026-11-23")).toBe(
      "2026-11-23 · EG6B",
    );
    expect(refusal(() => masterKeyNameOf(masterKeyId(publicKey), "2026-02-29")).code).toBe(
      "master_key.name_day_invalid",
    );
  });

  it("takes a leap day in a leap year", () => {
    expect(masterKeyName(sealingPublicKey(fixedKey), "2028-02-29")).toBe("2028-02-29 · EG6B");
  });

  it.each([
    "",
    "2026-1-23",
    "23-11-2026",
    "2026-11-23T00:00",
    "2026-13-01",
    "2026-11-32",
    "2026-02-29",
    "2026-04-31",
  ])("refuses day %j", (day) => {
    const error = refusal(() => masterKeyName(sealingPublicKey(fixedKey), day));
    expect(error.code).toBe("master_key.name_day_invalid");
    expect(error.params).toEqual({});
  });

  it.each(["2026-02-29", encodeMasterKeyCode(fixedKey)])(
    "does not carry the text it refused: %j",
    (day) => {
      const error = refusal(() => masterKeyName(sealingPublicKey(fixedKey), day));
      expect(JSON.stringify(error)).toContain("master_key.name_day_invalid");
      expect(JSON.stringify(error)).not.toContain(day);
    },
  );
});
