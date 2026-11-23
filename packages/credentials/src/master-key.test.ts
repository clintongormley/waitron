import { createHash, hkdfSync } from "node:crypto";
import { AppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import * as masterKeyModule from "./master-key.js";
import {
  authorityKey,
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyId,
  masterKeyMatches,
  masterKeyName,
  printMasterKey,
  readMasterKey,
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
  it("prints, checks and derives a fixed 16-byte key", () => {
    expect(printMasterKey(fixedKey)).toBe("222A 5AT7 UZRS FT4B J48X R4T7 TP8N");
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
});

describe("HKDF takes the decoded bytes, not the printed text", () => {
  it("derives from the 16 bytes a printed key reads back to", () => {
    const printed = printMasterKey(fixedKey);
    const fromBytes = Buffer.from(hkdfSync("sha256", fixedKey, salt, "authority", 32));
    for (const text of [printed, printed.replaceAll(" ", "")])
      expect(Buffer.from(hkdfSync("sha256", text, salt, "authority", 32)).equals(fromBytes)).toBe(
        false,
      );
    expect(authorityKey(readMasterKey(printed)).equals(fromBytes)).toBe(true);
  });
});

describe("making, printing and reading a master key", () => {
  it("makes 16 fresh random bytes each time", () => {
    const first = makeMasterKey();
    expect(first).toHaveLength(16);
    expect(first.equals(makeMasterKey())).toBe(false);
  });

  it("reads back the same 16 bytes, in any case and with spaces or dashes", () => {
    const printed = printMasterKey(fixedKey);
    expect(readMasterKey(printed)).toEqual(fixedKey);
    expect(Buffer.isBuffer(readMasterKey(printed))).toBe(true);
    expect(readMasterKey(printed.toLowerCase().replaceAll(" ", "-"))).toEqual(fixedKey);
  });

  it.each(["", "not a key", printMasterKey(fixedKey).slice(1)])(
    "refuses text that is not a printed master key %#",
    (text) => {
      const error = refusal(() => readMasterKey(text));
      expect(error.code).toBe("shared.invalid_key_code");
    },
  );

  it.each([Buffer.alloc(15), Buffer.alloc(17), Buffer.alloc(0)])(
    "refuses a master key that is not 16 bytes %#",
    (bytes) => {
      for (const use of [
        () => printMasterKey(bytes),
        () => authorityKey(bytes),
        () => masterKeyCheckValue(bytes),
        () => sealingPublicKey(bytes),
        () => masterKeyMatches(bytes, masterKeyCheckValue(fixedKey)),
      ])
        expect(refusal(use).code).toBe("shared.invalid_key_code");
    },
  );

  it("never hands out the sealing private key", () => {
    expect(Object.keys(masterKeyModule).sort()).toEqual([
      "authorityKey",
      "makeMasterKey",
      "masterKeyCheckValue",
      "masterKeyId",
      "masterKeyMatches",
      "masterKeyName",
      "printMasterKey",
      "readMasterKey",
      "sealingPublicKey",
    ]);
  });
});

describe("checking a typed master key", () => {
  const stored = masterKeyCheckValue(fixedKey);

  it("matches the key whose check value is stored", () => {
    expect(stored).toBe(createHash("sha256").update(authorityKey(fixedKey)).digest("hex"));
    expect(masterKeyMatches(readMasterKey(printMasterKey(fixedKey)), stored)).toBe(true);
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

describe("the master key's name", () => {
  it("is the day and the first 4 symbols of the master key id", () => {
    const publicKey = sealingPublicKey(makeMasterKey());
    const name = masterKeyName(publicKey, "2027-01-31");
    expect(name).toMatch(/^2027-01-31 · [2-9A-HJKMNP-Z]{4}$/);
    expect(masterKeyName(publicKey, "2027-02-01").slice(-4)).toBe(name.slice(-4));
  });

  it.each(["", "2026-1-23", "23-11-2026", "2026-11-23T00:00", "2026-13-01", "2026-11-32"])(
    "refuses day %j",
    (day) => {
      const error = refusal(() => masterKeyName(sealingPublicKey(fixedKey), day));
      expect(error.code).toBe("master_key.name_day_invalid");
      expect(error.params).toEqual({ value: day });
    },
  );
});
