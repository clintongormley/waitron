import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { signBytes, verifyBytes } from "@waitron/membership";

export const JOIN_COMMITMENT_LABEL = "waitron box join commitment v1";
export const JOIN_CODE_LABEL = "waitron box join code v1";
export const JOIN_HELLO_LABEL = "waitron box join hello v1";
export const JOIN_REVEAL_LABEL = "waitron box join reveal v1";
export const JOIN_POLL_LABEL = "waitron box join poll v1";
export const JOIN_CANCEL_LABEL = "waitron box join cancel v1";
export const JOIN_APPROVED_LABEL = "waitron box join approved v1";
export const JOIN_BUNDLE_LABEL = "waitron box join bundle v1";

export type JoinField = string | Uint8Array;

/** Each field preceded by its byte length as 4 bytes, big-endian; text is UTF-8. */
export function encodeFields(fields: readonly JoinField[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const bytes = typeof field === "string" ? Buffer.from(field, "utf8") : Buffer.from(field);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

function sha256(bytes: Buffer): Buffer {
  return createHash("sha256").update(bytes).digest();
}

/**
 * The text a join message's signature covers: the base64 of the length-prefixed label, request id,
 * `seq` (as decimal digits) and fields. Base64 keeps arbitrary bytes intact through `signBytes`'s
 * UTF-8 string, and never begins with `{`, so it can never be read as canonical JSON.
 */
export function joinMessageText(
  label: string,
  requestId: string,
  seq: number,
  fields: readonly JoinField[],
): string {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError("seq must be a whole number");
  return encodeFields([label, requestId, String(seq), ...fields]).toString("base64");
}

export function signJoinMessage(
  label: string,
  requestId: string,
  seq: number,
  fields: readonly JoinField[],
  privateKeyB64: string,
): string {
  return signBytes(joinMessageText(label, requestId, seq, fields), privateKeyB64);
}

export function verifyJoinMessage(
  label: string,
  requestId: string,
  seq: number,
  fields: readonly JoinField[],
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  return verifyBytes(joinMessageText(label, requestId, seq, fields), signatureB64, publicKeyB64);
}

/** `Cm`: what the main box sends in its hello answer before it has seen the new box's nonce. */
export function commitmentFor(requestId: string, mainNonce: Uint8Array): Buffer {
  return sha256(encodeFields([JOIN_COMMITMENT_LABEL, requestId, mainNonce]));
}

export function commitmentMatches(
  commitment: Uint8Array,
  requestId: string,
  mainNonce: Uint8Array,
): boolean {
  const expected = commitmentFor(requestId, mainNonce);
  return commitment.length === expected.length && timingSafeEqual(commitment, expected);
}

export interface JoinCodeInputs {
  newNodeId: string;
  /** The new box's node public key, base64 DER. */
  newPublicKey: string;
  /** The new box's one-join X25519 public key, base64 DER. */
  encryptionKey: string;
  contactUrl: string;
  storeUrl: string;
  addresses: readonly string[];
  mainNodeId: string;
  /** The main box's node identity public key, base64 DER. */
  mainPublicKey: string;
  newNonce: Uint8Array;
  mainNonce: Uint8Array;
  requestId: string;
}

/** Six digits with leading zeros: the first 8 bytes of the hash, modulo 1,000,000. */
export function joinCode(inputs: JoinCodeInputs): string {
  const v = sha256(
    encodeFields([
      JOIN_CODE_LABEL,
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
  );
  return String(v.readBigUInt64BE(0) % 1_000_000n).padStart(6, "0");
}

function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The real code cannot be redrawn, so a reveal whose code a listed request already shows is refused. */
export function codeTaken(code: string, listed: Iterable<string>): boolean {
  for (const shown of listed) if (shown === code) return true;
  return false;
}

/** Two decoys, distinct from the real code, from each other and from every listed request's codes. */
export function drawDecoys(
  real: string,
  listed: Iterable<string>,
  draw: () => string = randomCode,
): [string, string] {
  const avoid = new Set([real, ...listed]);
  const decoys: string[] = [];
  while (decoys.length < 2) {
    const code = draw();
    if (avoid.has(code)) continue;
    avoid.add(code);
    decoys.push(code);
  }
  return [decoys[0]!, decoys[1]!];
}

export const JOIN_PROTOCOL = 1;

export type JoinHelloFields = Pick<
  JoinCodeInputs,
  "newNodeId" | "newPublicKey" | "encryptionKey" | "contactUrl" | "storeUrl" | "addresses"
>;

/** The hello's fields every signature over it covers, in order. */
function helloFields(hello: JoinHelloFields): Buffer[] {
  return [
    Buffer.from(hello.newNodeId),
    Buffer.from(hello.newPublicKey, "base64"),
    Buffer.from(hello.encryptionKey, "base64"),
    Buffer.from(hello.contactUrl),
    Buffer.from(hello.storeUrl),
    Buffer.from([...hello.addresses].sort().join("\n")),
  ];
}

function helloMessageFields(hello: JoinHelloFields, at: number): Buffer[] {
  return [Buffer.from(String(JOIN_PROTOCOL)), ...helloFields(hello), Buffer.from(String(at))];
}

/** The hello is signed before any request exists, so it carries request id `""` and seq 0. */
export function signJoinHello(hello: JoinHelloFields, at: number, privateKeyB64: string): string {
  return signJoinMessage(JOIN_HELLO_LABEL, "", 0, helloMessageFields(hello, at), privateKeyB64);
}

export function verifyJoinHello(
  hello: JoinHelloFields,
  at: number,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  return verifyJoinMessage(
    JOIN_HELLO_LABEL,
    "",
    0,
    helloMessageFields(hello, at),
    signatureB64,
    publicKeyB64,
  );
}

/** What the new box signs in its reveal, under the request id and seq. */
export function revealMessageFields(newNonce: Buffer): Buffer[] {
  return [newNonce];
}

/** What the new box signs in a poll, under the request id and seq. */
export function pollMessageFields(at: number): Buffer[] {
  return [Buffer.from(String(at))];
}

/** What the main box signs in its reveal answer, under the reveal's request id and seq. */
export function revealAnswerFields(
  hello: JoinHelloFields,
  newNonce: Buffer,
  mainNonce: Buffer,
): Buffer[] {
  return [...helloFields(hello), newNonce, mainNonce];
}
