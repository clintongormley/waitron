import { createHash, hkdfSync } from "node:crypto";
import { AppError, encodeMasterKeyCode } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import {
  authorityKey,
  backupKey,
  diskKey,
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyId,
  masterKeyMatches,
  printMasterKey,
  readMasterKey,
  sealingPublicKey,
  sealingPublicKeyFrom,
} from "./master-key.js";

const fixedKey = Buffer.from("000102030405060708090a0b0c0d0e0f1011121314151617", "hex");
const boxId = "0f8e2c1a-7b3d-4e5f-9a6b-1c2d3e4f5a6b";

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

// Computed once with `openssl kdf … HKDF` (OpenSSL 4.1.0) and, for the public key, its id and the
// check value, `openssl pkey -pubout` and `openssl dgst -sha256`; never with this module.
describe("the fixed vectors", () => {
  it("derives every label's output for a fixed 24-byte key", () => {
    expect(authorityKey(fixedKey).toString("hex")).toBe(
      "31c2c3af135ed3ccaf664e1919edd7639d23340d11d1abe9d04e79a5489357b7",
    );
    expect(masterKeyCheckValue(fixedKey)).toBe(
      "9ce880047d3d67effb83eb55e4ecac796e145f5a09161346afae185c7654bc09",
    );
    expect(sealingPublicKey(fixedKey).toString("hex")).toBe(
      "302a300506032b656e032100cb0140735f03748f6738381a581d6063eef97f373c942afaf6682af6eeba5b40",
    );
    expect(masterKeyId(sealingPublicKey(fixedKey)).toString("hex")).toBe("d17cc7fecde6434d");
    expect(backupKey(fixedKey, 1).toString("hex")).toBe(
      "09221c3444c2ac41a9d976674e57089ba6e50539291b20beecceb14adedbfa0c",
    );
    expect(backupKey(fixedKey, 12).toString("hex")).toBe(
      "5ca59bc4c7022b122933064d93c0aa80c95153354ab482d139af17b76e237248",
    );
    expect(diskKey(fixedKey, boxId).toString("hex")).toBe(
      "71f776b30e3198973ab1a8e808c770ce1aaaedcbeb7cbd42709e710e8b255496",
    );
  });

  it("names the disk key by the box id's lower-case text", () => {
    expect(diskKey(fixedKey, boxId.toUpperCase()).equals(diskKey(fixedKey, boxId))).toBe(true);
  });
});

describe("HKDF takes the decoded bytes, not the printed text", () => {
  it("derives from the 24 bytes a printed key reads back to", () => {
    const printed = printMasterKey(fixedKey);
    const salt = Buffer.from("waitron.master-key.v1", "ascii");
    const fromBytes = Buffer.from(hkdfSync("sha256", fixedKey, salt, "authority", 32));
    const fromText = Buffer.from(hkdfSync("sha256", printed, salt, "authority", 32));
    const fromCode = Buffer.from(
      hkdfSync("sha256", printed.replaceAll(" ", ""), salt, "authority", 32),
    );
    expect(fromText.equals(fromBytes)).toBe(false);
    expect(fromCode.equals(fromBytes)).toBe(false);
    expect(authorityKey(readMasterKey(printed)).equals(fromBytes)).toBe(true);
  });
});

describe("making, printing and reading a master key", () => {
  it("makes 24 fresh random bytes each time", () => {
    const first = makeMasterKey();
    expect(first).toHaveLength(24);
    expect(first.equals(makeMasterKey())).toBe(false);
  });

  it("prints with the 41-symbol code and reads back the same 24 bytes, in any case and spacing", () => {
    const printed = printMasterKey(fixedKey);
    expect(printed).toBe(encodeMasterKeyCode(fixedKey.toString("base64url")));
    expect(readMasterKey(printed).equals(fixedKey)).toBe(true);
    expect(readMasterKey(` ${printed.toLowerCase().replaceAll(" ", "")} `).equals(fixedKey)).toBe(
      true,
    );
  });

  it.each(["", "not a key", printMasterKey(fixedKey).slice(1)])(
    "refuses text that is not a printed master key %#",
    (text) => {
      const error = refusal(() => readMasterKey(text));
      expect(error.code).toBe("master_key.invalid");
      expect(error.params).toEqual({ reason: "printed_form" });
    },
  );

  it.each([Buffer.alloc(23), Buffer.alloc(25), Buffer.alloc(0)])(
    "refuses a master key that is not 24 bytes %#",
    (bytes) => {
      for (const use of [
        () => printMasterKey(bytes),
        () => authorityKey(bytes),
        () => sealingPublicKey(bytes),
        () => backupKey(bytes, 1),
        () => diskKey(bytes, boxId),
        () => masterKeyMatches(bytes, masterKeyCheckValue(fixedKey)),
      ]) {
        const error = refusal(use);
        expect(error.code).toBe("master_key.invalid");
        expect(error.params).toEqual({ reason: "length" });
      }
    },
  );
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

describe("derivation inputs", () => {
  it("writes N in decimal with no leading zeros", () => {
    const salt = Buffer.from("waitron.master-key.v1", "ascii");
    expect(
      backupKey(fixedKey, 3).equals(
        Buffer.from(hkdfSync("sha256", fixedKey, salt, "backup-key.3", 32)),
      ),
    ).toBe(true);
    expect(backupKey(fixedKey, 3).equals(backupKey(fixedKey, 4))).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "refuses backup key number %s",
    (n) => {
      const error = refusal(() => backupKey(fixedKey, n));
      expect(error.code).toBe("master_key.derivation_input_invalid");
      expect(error.params).toEqual({ input: "backup_key_number" });
    },
  );

  it("takes the largest safe integer as a backup key number", () => {
    expect(backupKey(fixedKey, Number.MAX_SAFE_INTEGER)).toHaveLength(32);
  });

  it.each(["", "box-1", `${boxId}0`, ` ${boxId}`])("refuses box id %j", (id) => {
    const error = refusal(() => diskKey(fixedKey, id));
    expect(error.code).toBe("master_key.derivation_input_invalid");
    expect(error.params).toEqual({ input: "box_id" });
  });
});

describe("a stored sealing public key", () => {
  it("reads back the key it was stored as", () => {
    const stored = Buffer.from(sealingPublicKey(fixedKey));
    expect(sealingPublicKeyFrom(stored).equals(sealingPublicKey(fixedKey))).toBe(true);
  });

  it.each([
    ["empty bytes", Buffer.alloc(0)],
    ["a truncated key", sealingPublicKey(fixedKey).subarray(0, 43)],
    ["a key with a byte after it", Buffer.concat([sealingPublicKey(fixedKey), Buffer.from([0])])],
    ["an Ed25519 key", Buffer.from("302a300506032b6570032100" + "11".repeat(32), "hex")],
    ["the master key itself", fixedKey],
  ])("refuses %s", (_label, bytes) => {
    const error = refusal(() => sealingPublicKeyFrom(bytes));
    expect(error.code).toBe("master_key.invalid");
    expect(error.params).toEqual({ reason: "public_key" });
  });
});
