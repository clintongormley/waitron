import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { AppError } from "@waitron/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import { makeMasterKey, masterKeyId, sealingPublicKey } from "./master-key.js";
import { openPacket, packetMasterKeyId, sealPacket } from "./sealed-packet.js";

const masterKey = Buffer.from("000102030405060708090a0b0c0d0e0f1011121314151617", "hex");
const venuePublicKey = sealingPublicKey(masterKey);
const plaintext = Buffer.from("secrets/fiscal.p12 stand-in bytes");

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function changed(packet: Buffer, offset: number): Buffer {
  const copy = Buffer.from(packet);
  copy[offset] = copy[offset]! ^ 0x01;
  return copy;
}

describe("a WSP1 packet opens with the master key; another key and a changed header byte are refused", () => {
  const packet = sealPacket(venuePublicKey, plaintext);

  it("lays out WSP1, version 1, the key id, the one-use key, the iv and the tag before the ciphertext", () => {
    expect(packet.subarray(0, 4).toString("ascii")).toBe("WSP1");
    expect(packet[4]).toBe(1);
    expect(packet.subarray(5, 13).equals(masterKeyId(venuePublicKey))).toBe(true);
    expect(createPublicKey({ key: packet.subarray(13, 57), format: "der", type: "spki" })).toEqual(
      expect.objectContaining({ asymmetricKeyType: "x25519" }),
    );
    expect(packet).toHaveLength(85 + plaintext.length);
    expect(packetMasterKeyId(packet).equals(masterKeyId(venuePublicKey))).toBe(true);
  });

  it("opens with the master key", () => {
    expect(openPacket(masterKey, packet).equals(plaintext)).toBe(true);
  });

  it("opens independently of this module with the layout and key the design names", () => {
    const sealingPrivate = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b656e04220420", "hex"),
        Buffer.from(
          hkdfSync(
            "sha256",
            masterKey,
            Buffer.from("waitron.master-key.v1"),
            Buffer.from("seal.x25519"),
            32,
          ),
        ),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const oneUse = packet.subarray(13, 57);
    const shared = diffieHellman({
      privateKey: sealingPrivate,
      publicKey: createPublicKey({ key: oneUse, format: "der", type: "spki" }),
    });
    const key = Buffer.from(
      hkdfSync(
        "sha256",
        shared,
        Buffer.alloc(0),
        Buffer.concat([Buffer.from("waitron.sealed-packet.v1", "ascii"), oneUse, venuePublicKey]),
        32,
      ),
    );
    const decipher = createDecipheriv("aes-256-gcm", key, packet.subarray(57, 69));
    decipher.setAAD(packet.subarray(0, 69));
    decipher.setAuthTag(packet.subarray(69, 85));
    const opened = Buffer.concat([decipher.update(packet.subarray(85)), decipher.final()]);
    expect(opened.equals(plaintext)).toBe(true);
  });

  it("uses a new one-use key and iv for every packet", () => {
    const again = sealPacket(venuePublicKey, plaintext);
    expect(again.subarray(13, 57).equals(packet.subarray(13, 57))).toBe(false);
    expect(again.subarray(57, 69).equals(packet.subarray(57, 69))).toBe(false);
  });

  it("seals and opens an empty plaintext", () => {
    const empty = sealPacket(venuePublicKey, Buffer.alloc(0));
    expect(empty).toHaveLength(85);
    expect(openPacket(masterKey, empty)).toHaveLength(0);
  });

  it("refuses another master key before any decryption, naming both key ids", () => {
    const other = makeMasterKey();
    const error = refusal(() => openPacket(other, packet));
    expect(error.code).toBe("sealed_packet.other_master_key");
    expect(error.params).toEqual({
      packetKeyId: masterKeyId(venuePublicKey).toString("hex"),
      masterKeyId: masterKeyId(sealingPublicKey(other)).toString("hex"),
    });
  });

  it("refuses a packet naming another key id even when nothing after the id could be opened", () => {
    const forged = Buffer.concat([packet.subarray(0, 5), randomBytes(8), Buffer.alloc(80)]);
    expect(refusal(() => openPacket(masterKey, forged)).code).toBe(
      "sealed_packet.other_master_key",
    );
  });

  it.each([
    ["magic", 0, "sealed_packet.malformed"],
    ["magic's last byte", 3, "sealed_packet.malformed"],
    ["version", 4, "sealed_packet.malformed"],
    ["key id", 5, "sealed_packet.other_master_key"],
    ["key id's last byte", 12, "sealed_packet.other_master_key"],
    ["one-use key", 13, "sealed_packet.unopenable"],
    ["one-use key's last byte", 56, "sealed_packet.unopenable"],
    ["iv", 57, "sealed_packet.unopenable"],
    ["iv's last byte", 68, "sealed_packet.unopenable"],
    ["tag", 69, "sealed_packet.unopenable"],
    ["tag's last byte", 84, "sealed_packet.unopenable"],
    ["ciphertext", 85, "sealed_packet.unopenable"],
  ])("refuses a changed %s byte", (_field, offset, code) => {
    expect(refusal(() => openPacket(masterKey, changed(packet, offset))).code).toBe(code);
  });

  it.each([
    ["no bytes", Buffer.alloc(0)],
    ["a header one byte short", packet.subarray(0, 84)],
  ])("refuses %s as malformed", (_label, bytes) => {
    expect(refusal(() => openPacket(masterKey, bytes)).code).toBe("sealed_packet.malformed");
    expect(refusal(() => packetMasterKeyId(bytes)).code).toBe("sealed_packet.malformed");
  });

  it("refuses a master key that is not 24 bytes", () => {
    const error = refusal(() => openPacket(Buffer.alloc(23), packet));
    expect(error.code).toBe("master_key.invalid");
  });
});

describe("sealing takes only the public key", () => {
  it("accepts a sealing public key and nothing else", () => {
    expectTypeOf(sealPacket).parameter(0).toEqualTypeOf<ReturnType<typeof sealingPublicKey>>();
    // @ts-expect-error The master key's bytes are not a sealing public key.
    expect(() => sealPacket(masterKey, plaintext)).toThrow();
    // @ts-expect-error Unchecked bytes are not a sealing public key until sealingPublicKeyFrom reads them.
    expect(() => sealPacket(Buffer.from(venuePublicKey), plaintext)).not.toThrow();
  });
});
