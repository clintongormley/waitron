import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";
import {
  agreeOrRefuse,
  masterKeyId,
  sealingPrivateKey,
  sealingPublicKeyOf,
  type SealingPublicKey,
} from "./master-key.js";

const MAGIC = Buffer.from("WSP1", "ascii");
const VERSION = 0x01;
const INFO = Buffer.from("waitron.sealed-packet.v1", "ascii");
const KEY_ID_AT = 5;
const ONE_USE_AT = 13;
const IV_AT = 57;
const TAG_AT = 69;
const HEADER_BYTES = 85;

function packetKey(shared: Buffer, oneUseSpki: Buffer, venueSpki: Buffer): Buffer {
  const info = Buffer.concat([INFO, oneUseSpki, venueSpki]);
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), info, 32));
}

/** Seals bytes to the venue's sealing public key; only the master key opens the packet. */
export function sealPacket(venuePublicKey: SealingPublicKey, plaintext: Uint8Array): Buffer {
  let venueKey: KeyObject;
  try {
    venueKey = createPublicKey({ key: venuePublicKey, format: "der", type: "spki" });
  } catch {
    throw new AppError("master_key.invalid", { reason: "public_key" });
  }
  const oneUse = generateKeyPairSync("x25519");
  const oneUseSpki = oneUse.publicKey.export({ format: "der", type: "spki" });
  const shared = agreeOrRefuse(oneUse.privateKey, venueKey);
  const iv = randomBytes(12);
  const head = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    masterKeyId(venuePublicKey),
    oneUseSpki,
    iv,
  ]);
  const cipher = createCipheriv("aes-256-gcm", packetKey(shared, oneUseSpki, venuePublicKey), iv);
  cipher.setAAD(head);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([head, cipher.getAuthTag(), ciphertext]);
}

function view(packet: Uint8Array): Buffer {
  return Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength);
}

/** The id of the master key a packet was sealed to, read without opening it. */
export function packetMasterKeyId(packet: Uint8Array): Buffer {
  const bytes = view(packet);
  if (
    bytes.length < HEADER_BYTES ||
    !bytes.subarray(0, KEY_ID_AT - 1).equals(MAGIC) ||
    bytes[KEY_ID_AT - 1] !== VERSION
  ) {
    throw new AppError("sealed_packet.malformed", {});
  }
  // A copy, so that holding the id does not hold the packet.
  const id = Buffer.alloc(ONE_USE_AT - KEY_ID_AT);
  bytes.copy(id, 0, KEY_ID_AT, ONE_USE_AT);
  return id;
}

export function openPacket(masterKey: Uint8Array, packet: Uint8Array): Buffer {
  const packetKeyId = packetMasterKeyId(packet);
  const privateKey = sealingPrivateKey(masterKey);
  const venueSpki = sealingPublicKeyOf(privateKey);
  const ownKeyId = masterKeyId(venueSpki);
  if (!packetKeyId.equals(ownKeyId)) {
    throw new AppError("sealed_packet.other_master_key", {
      packetKeyId: packetKeyId.toString("hex"),
      masterKeyId: ownKeyId.toString("hex"),
    });
  }
  const bytes = view(packet);
  const oneUseSpki = bytes.subarray(ONE_USE_AT, IV_AT);
  try {
    const oneUseKey: KeyObject = createPublicKey({ key: oneUseSpki, format: "der", type: "spki" });
    const shared = diffieHellman({ privateKey, publicKey: oneUseKey });
    const decipher = createDecipheriv(
      "aes-256-gcm",
      packetKey(shared, oneUseSpki, venueSpki),
      bytes.subarray(IV_AT, TAG_AT),
    );
    decipher.setAAD(bytes.subarray(0, TAG_AT));
    decipher.setAuthTag(bytes.subarray(TAG_AT, HEADER_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new AppError("sealed_packet.unopenable", {});
  }
}
