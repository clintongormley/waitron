import { generateKeyPairSync } from "node:crypto";
import { generateNodeKeyPair } from "@waitron/membership";
import { describe, expect, it } from "vitest";
import {
  approvedSignature,
  lockJoinBundle,
  unlockJoinBundle,
  type LockedJoinBundle,
} from "./box-join-seal.js";

function encryptionKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

const REQUEST_ID = "3f2a1b0c-9d8e-4f7a-b6c5-d4e3f2a1b0c9";
const BUNDLE = Buffer.from(JSON.stringify({ primaryPublicKey: "pk", ring: "secret ring" }));

function setup() {
  const main = generateNodeKeyPair();
  const enc = encryptionKeyPair();
  const locked = lockJoinBundle({
    requestId: REQUEST_ID,
    encryptionKey: enc.publicKey,
    bundle: BUNDLE,
    mainPrivateKey: main.privateKey,
  });
  const unlock = (overrides: {
    locked?: LockedJoinBundle;
    requestId?: string;
    encryptionPrivateKey?: string;
    mainPublicKey?: string;
  }) =>
    unlockJoinBundle({
      requestId: overrides.requestId ?? REQUEST_ID,
      locked: overrides.locked ?? locked,
      encryptionKey: enc.publicKey,
      encryptionPrivateKey: overrides.encryptionPrivateKey ?? enc.privateKey,
      mainPublicKey: overrides.mainPublicKey ?? main.publicKey,
    });
  return { main, enc, locked, unlock };
}

function flipByte(b64: string, index: number): string {
  const bytes = Buffer.from(b64, "base64");
  bytes[index] = bytes[index]! ^ 0x01;
  return bytes.toString("base64");
}

describe("lockJoinBundle and unlockJoinBundle", () => {
  it("round-trips the bundle, and the locked bytes do not contain it", () => {
    const { locked, unlock } = setup();
    expect(unlock({})).toEqual(BUNDLE);
    expect(Buffer.from(locked.ciphertext, "base64").includes(Buffer.from("secret ring"))).toBe(
      false,
    );
  });

  it("refuses another X25519 private key", () => {
    const { unlock } = setup();
    expect(unlock({ encryptionPrivateKey: encryptionKeyPair().privateKey })).toBeNull();
  });

  it("refuses one changed byte of the locked bytes, signature re-made or not", () => {
    const { main, locked, unlock } = setup();
    const ciphertext = flipByte(locked.ciphertext, 20);
    expect(unlock({ locked: { ...locked, ciphertext } })).toBeNull();
    // Re-signed with the real node key, only the cipher's own check stands between this and success.
    const resigned = approvedSignature(
      REQUEST_ID,
      locked.oneUsePublicKey,
      ciphertext,
      main.privateKey,
    );
    expect(unlock({ locked: { ...locked, ciphertext, signature: resigned } })).toBeNull();
  });

  it("refuses a bundle locked to the new box's key but signed by another key", () => {
    const { main, enc, unlock } = setup();
    const other = generateNodeKeyPair();
    const forged = lockJoinBundle({
      requestId: REQUEST_ID,
      encryptionKey: enc.publicKey,
      bundle: BUNDLE,
      mainPrivateKey: other.privateKey,
    });
    expect(unlock({ locked: forged })).toBeNull();
    expect(unlock({ locked: forged, mainPublicKey: other.publicKey })).toEqual(BUNDLE);
    expect(main.publicKey).not.toBe(other.publicKey);
  });

  it("refuses a bundle that is not signed", () => {
    const { locked, unlock } = setup();
    expect(unlock({ locked: { ...locked, signature: "" } })).toBeNull();
  });

  it("refuses a signature made for another request id", () => {
    const { main, locked, unlock } = setup();
    // The locked bytes are this request's, so only the signature's request id is wrong.
    const signature = approvedSignature(
      "00000000-0000-4000-8000-000000000000",
      locked.oneUsePublicKey,
      locked.ciphertext,
      main.privateKey,
    );
    expect(unlock({ locked: { ...locked, signature } })).toBeNull();
  });
});
