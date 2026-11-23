import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { generateNodeKeyPair, verifyBytes } from "@waitron/membership";
import { describe, expect, it } from "vitest";
import {
  JOIN_APPROVED_LABEL,
  JOIN_BUNDLE_LABEL,
  JOIN_CANCEL_LABEL,
  JOIN_CODE_LABEL,
  JOIN_COMMITMENT_LABEL,
  JOIN_HELLO_LABEL,
  JOIN_POLL_LABEL,
  JOIN_PROTOCOL,
  JOIN_REVEAL_LABEL,
  commitmentFor,
  commitmentMatches,
  encodeFields,
  joinCode,
  joinMessageText,
  pollMessageFields,
  signJoinMessage,
  verifyJoinMessage,
  type JoinCodeInputs,
} from "./box-join-code.js";

function x25519PublicKey(): string {
  return generateKeyPairSync("x25519")
    .publicKey.export({ format: "der", type: "spki" })
    .toString("base64");
}

function baseInputs(): JoinCodeInputs {
  return {
    newNodeId: "5b0c3f4e-1d2a-4c7e-9f00-0a1b2c3d4e5f",
    newPublicKey: generateNodeKeyPair().publicKey,
    encryptionKey: x25519PublicKey(),
    contactUrl: "https://192.168.1.40:8443",
    storeUrl: "https://192.168.1.40:9000",
    addresses: ["192.168.1.40", "fd00::40"],
    mainNodeId: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
    mainPublicKey: generateNodeKeyPair().publicKey,
    newNonce: randomBytes(32),
    mainNonce: randomBytes(32),
    requestId: "c1d2e3f4-0000-4000-8000-000000000001",
  };
}

describe("labels", () => {
  it("keeps the exact text of every join label", () => {
    expect({
      JOIN_COMMITMENT_LABEL,
      JOIN_CODE_LABEL,
      JOIN_HELLO_LABEL,
      JOIN_REVEAL_LABEL,
      JOIN_POLL_LABEL,
      JOIN_CANCEL_LABEL,
      JOIN_APPROVED_LABEL,
      JOIN_BUNDLE_LABEL,
    }).toEqual({
      JOIN_COMMITMENT_LABEL: "waitron box join commitment v1",
      JOIN_CODE_LABEL: "waitron box join code v1",
      JOIN_HELLO_LABEL: "waitron box join hello v1",
      JOIN_REVEAL_LABEL: "waitron box join reveal v1",
      JOIN_POLL_LABEL: "waitron box join poll v1",
      JOIN_CANCEL_LABEL: "waitron box join cancel v1",
      JOIN_APPROVED_LABEL: "waitron box join approved v1",
      JOIN_BUNDLE_LABEL: "waitron box join bundle v1",
    });
  });
});

describe("encodeFields", () => {
  it("puts each field's length before it as four big-endian bytes", () => {
    const bytes = encodeFields(["ab", Buffer.from([0x41, 0xff, 0x42])]);
    expect([...bytes]).toEqual([0, 0, 0, 2, 0x61, 0x62, 0, 0, 0, 3, 0x41, 0xff, 0x42]);
  });

  it("encodes text as UTF-8", () => {
    expect([...encodeFields(["©"])]).toEqual([0, 0, 0, 2, 0xc2, 0xa9]);
  });

  it("tells apart fields that run together the same way", () => {
    expect(encodeFields(["ab", "c"]).equals(encodeFields(["a", "bc"]))).toBe(false);
  });
});

describe("the main box's commitment", () => {
  it("is SHA-256 over the length-prefixed label, request id and nonce", () => {
    const nonce = randomBytes(32);
    const expected = createHash("sha256")
      .update(encodeFields(["waitron box join commitment v1", "req-1", nonce]))
      .digest();
    expect(commitmentFor("req-1", nonce).equals(expected)).toBe(true);
  });

  it("accepts the nonce it was made from", () => {
    const nonce = randomBytes(32);
    expect(commitmentMatches(commitmentFor("req-1", nonce), "req-1", nonce)).toBe(true);
  });

  it("refuses a nonce that does not match", () => {
    const nonce = randomBytes(32);
    const other = Buffer.from(nonce);
    other[0] = other[0]! ^ 1;
    expect(commitmentMatches(commitmentFor("req-1", nonce), "req-1", other)).toBe(false);
  });

  it("refuses the right nonce under another request id", () => {
    const nonce = randomBytes(32);
    expect(commitmentMatches(commitmentFor("req-1", nonce), "req-2", nonce)).toBe(false);
  });

  it("refuses a commitment of the wrong length", () => {
    const nonce = randomBytes(32);
    expect(commitmentMatches(commitmentFor("req-1", nonce).subarray(0, 31), "req-1", nonce)).toBe(
      false,
    );
  });
});

describe("joinCode", () => {
  it("gives both sides the same code from the same inputs", () => {
    const inputs = baseInputs();
    const copy: JoinCodeInputs = {
      ...inputs,
      addresses: [...inputs.addresses],
      newNonce: Buffer.from(inputs.newNonce),
      mainNonce: Buffer.from(inputs.mainNonce),
    };
    expect(joinCode(inputs)).toBe(joinCode(copy));
  });

  it("does not depend on the order the addresses are listed in", () => {
    const inputs = baseInputs();
    expect(joinCode(inputs)).toBe(
      joinCode({ ...inputs, addresses: [...inputs.addresses].reverse() }),
    );
  });

  const changes: [
    keyof JoinCodeInputs,
    (i: JoinCodeInputs) => JoinCodeInputs[keyof JoinCodeInputs],
  ][] = [
    ["newNodeId", () => "5b0c3f4e-1d2a-4c7e-9f00-0a1b2c3d4e60"],
    ["newPublicKey", () => generateNodeKeyPair().publicKey],
    ["encryptionKey", () => x25519PublicKey()],
    ["contactUrl", () => "https://192.168.1.41:8443"],
    ["storeUrl", () => "https://192.168.1.41:9000"],
    ["addresses", (i) => [...i.addresses, "10.0.0.5"]],
    ["mainNodeId", () => "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6c"],
    ["mainPublicKey", () => generateNodeKeyPair().publicKey],
    ["newNonce", () => randomBytes(32)],
    ["mainNonce", () => randomBytes(32)],
    ["requestId", () => "c1d2e3f4-0000-4000-8000-000000000002"],
  ];

  it("covers all eleven inputs", () => {
    expect(changes.map(([key]) => key).sort()).toEqual(Object.keys(baseInputs()).sort());
  });

  // A changed input could keep the same code by chance one time in a million, so each change is
  // tried on several base sets and must move the code on at least one of them; in practice it
  // moves on all.
  it.each(changes)("changes when %s changes", (key, change) => {
    let moved = 0;
    for (let round = 0; round < 3; round++) {
      const inputs = baseInputs();
      if (joinCode(inputs) !== joinCode({ ...inputs, [key]: change(inputs) })) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("changes when two addresses swap a character across their boundary", () => {
    const inputs = baseInputs();
    const a = joinCode({ ...inputs, addresses: ["10.0.0.1", "10.0.0.23"] });
    const b = joinCode({ ...inputs, addresses: ["10.0.0.12", "10.0.0.3"] });
    expect(a).not.toBe(b);
  });

  it("is the first eight bytes of the hash, modulo a million, as six digits", () => {
    const inputs = baseInputs();
    const v = createHash("sha256")
      .update(
        encodeFields([
          "waitron box join code v1",
          inputs.newNodeId,
          Buffer.from(inputs.newPublicKey, "base64"),
          Buffer.from(inputs.encryptionKey, "base64"),
          inputs.contactUrl,
          inputs.storeUrl,
          [...inputs.addresses].sort().join("\n"),
          inputs.mainNodeId,
          Buffer.from(inputs.mainPublicKey, "base64"),
          inputs.newNonce,
          inputs.mainNonce,
          inputs.requestId,
        ]),
      )
      .digest();
    const expected = String(v.readBigUInt64BE(0) % 1_000_000n).padStart(6, "0");
    expect(joinCode(inputs)).toBe(expected);
  });

  it("gives the same code for fixed inputs as it always has", () => {
    expect(
      joinCode({
        newNodeId: "5b0c3f4e-1d2a-4c7e-9f00-0a1b2c3d4e5f",
        newPublicKey: Buffer.alloc(44, 1).toString("base64"),
        encryptionKey: Buffer.alloc(44, 2).toString("base64"),
        contactUrl: "https://192.168.1.40:8443",
        storeUrl: "https://192.168.1.40:9000",
        addresses: ["fd00::40", "192.168.1.40"],
        mainNodeId: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
        mainPublicKey: Buffer.alloc(44, 3).toString("base64"),
        newNonce: Buffer.alloc(32, 4),
        mainNonce: Buffer.alloc(32, 5),
        requestId: "c1d2e3f4-0000-4000-8000-000000000001",
      }),
    ).toBe("829075");
  });

  it("writes a small code as six digits with leading zeros", () => {
    // Search for inputs whose code starts with "0": about one in ten tries.
    const inputs = baseInputs();
    let code = joinCode(inputs);
    for (let i = 0; !code.startsWith("0") && i < 500; i++) {
      code = joinCode({ ...inputs, newNonce: randomBytes(32) });
    }
    expect(code).toMatch(/^0\d{5}$/);
  });

  it("is always six digits", () => {
    for (let i = 0; i < 50; i++) expect(joinCode(baseInputs())).toMatch(/^\d{6}$/);
  });
});

describe("a poll's signed fields", () => {
  it("are the poll's clock reading and whether the new box said Join, as text", () => {
    expect(pollMessageFields(1_234, true)).toEqual([Buffer.from("1234"), Buffer.from("true")]);
    expect(pollMessageFields(1_234, false)).toEqual([Buffer.from("1234"), Buffer.from("false")]);
  });

  it("do not let a signature over a poll without the Yes pass for one with it", () => {
    const keys = generateNodeKeyPair();
    const signature = signJoinMessage(
      JOIN_POLL_LABEL,
      "req-1",
      2,
      pollMessageFields(1_234, false),
      keys.privateKey,
    );
    expect(
      verifyJoinMessage(
        JOIN_POLL_LABEL,
        "req-1",
        2,
        pollMessageFields(1_234, true),
        signature,
        keys.publicKey,
      ),
    ).toBe(false);
  });
});

describe("the join protocol", () => {
  it("is version 2, so a box on the release before the Yes is refused at its hello", () => {
    expect(JOIN_PROTOCOL).toBe(2);
  });
});

describe("signed join messages", () => {
  const keys = generateNodeKeyPair();
  const fields = ["node-1", Buffer.from([1, 2, 3])];

  it("signs the base64 text of the length-prefixed label, request id, seq and fields", () => {
    const text = joinMessageText(JOIN_REVEAL_LABEL, "req-1", 1, fields);
    const bytes = Buffer.from(text, "base64");
    expect(bytes.toString("base64")).toBe(text);
    expect(bytes.equals(encodeFields([JOIN_REVEAL_LABEL, "req-1", "1", ...fields]))).toBe(true);
    const signature = signJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, keys.privateKey);
    expect(verifyBytes(text, signature, keys.publicKey)).toBe(true);
  });

  it("begins the signed bytes with the label, length-prefixed", () => {
    const bytes = Buffer.from(joinMessageText(JOIN_REVEAL_LABEL, "req-1", 1, fields), "base64");
    const label = Buffer.from(JOIN_REVEAL_LABEL, "utf8");
    expect(bytes.readUInt32BE(0)).toBe(label.length);
    expect(bytes.subarray(4, 4 + label.length).equals(label)).toBe(true);
  });

  it("never signs text that begins as canonical JSON would", () => {
    expect(joinMessageText(JOIN_REVEAL_LABEL, "req-1", 1, fields).startsWith("{")).toBe(false);
  });

  it("verifies a message signed with the matching key", () => {
    const signature = signJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, keys.privateKey);
    expect(
      verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, signature, keys.publicKey),
    ).toBe(true);
  });

  it("refuses a signature made for another label", () => {
    const signature = signJoinMessage(JOIN_APPROVED_LABEL, "req-1", 1, fields, keys.privateKey);
    expect(
      verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, signature, keys.publicKey),
    ).toBe(false);
  });

  it("refuses a signature made for another request id", () => {
    const signature = signJoinMessage(JOIN_REVEAL_LABEL, "req-2", 1, fields, keys.privateKey);
    expect(
      verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, signature, keys.publicKey),
    ).toBe(false);
  });

  it("refuses a signature made for another seq", () => {
    const signature = signJoinMessage(JOIN_REVEAL_LABEL, "req-1", 2, fields, keys.privateKey);
    expect(
      verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, signature, keys.publicKey),
    ).toBe(false);
  });

  it("refuses a signature by another key", () => {
    const signature = signJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, keys.privateKey);
    const other = generateNodeKeyPair().publicKey;
    expect(verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, fields, signature, other)).toBe(false);
  });

  it("refuses a seq that is not a whole number", () => {
    expect(() => joinMessageText(JOIN_REVEAL_LABEL, "req-1", 1.5, fields)).toThrow();
    expect(() => joinMessageText(JOIN_REVEAL_LABEL, "req-1", -1, fields)).toThrow();
  });

  it("signs the bytes 41 ff 42 and 41 fe 42 differently", () => {
    const ff = Buffer.from([0x41, 0xff, 0x42]);
    const fe = Buffer.from([0x41, 0xfe, 0x42]);
    // Through a UTF-8 string both bytes would become U+FFFD and the two messages would be one.
    expect(ff.toString("utf8")).toBe(fe.toString("utf8"));
    const signature = signJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, [ff], keys.privateKey);
    expect(verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, [ff], signature, keys.publicKey)).toBe(
      true,
    );
    expect(verifyJoinMessage(JOIN_REVEAL_LABEL, "req-1", 1, [fe], signature, keys.publicKey)).toBe(
      false,
    );
  });
});
