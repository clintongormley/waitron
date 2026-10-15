import { verify } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createCustodyKey, openCustodyKey, protectCustodyKey } from "./key-codec.js";
import { encodeSecretPaper, restoreSecretPaper } from "./paper-codec.js";
import { checkCustodyChallenge, createCustodyCheckVerifier } from "./challenge.js";
import { parsePaperBlock, parsePaperConsumption } from "../paper-protocol.js";

const scope = {
  custodianId: "test-custodian",
  taxpayerNif: "B12345674",
  softwareId: "W1",
  environment: "production" as const,
};
const request = { requestId: "synthetic-request-1", kind: "saved-file" as const };
const refused = { message: "Custody material refused" };
afterEach(() => vi.restoreAllMocks());

it("signs the exact harmless domain with fresh 32-byte nonces, independently verifiable by Node", async () => {
  const created = await createCustodyKey(scope);
  const key = await openCustodyKey(
    await protectCustodyKey(created, "twelve-words-here"),
    "twelve-words-here",
    created,
  );
  const receipt = await checkCustodyChallenge(key, created, request);
  expect(Object.keys(receipt)).toEqual([
    "version",
    "requestId",
    "kind",
    "fingerprint",
    "nonce",
    "signature",
  ]);
  expect(receipt).toMatchObject({ version: 1, ...request, fingerprint: created.fingerprint });
  expect(Buffer.from(receipt.nonce, "base64")).toHaveLength(32);
  const bytes = Buffer.from(
    JSON.stringify([
      "waitron.custody-check",
      1,
      request.requestId,
      "saved-file",
      scope,
      created.fingerprint,
      receipt.nonce,
    ]),
  );
  expect(verify(null, bytes, created.publicKey, Buffer.from(receipt.signature, "base64"))).toBe(
    true,
  );
  const second = await checkCustodyChallenge(key, created, request);
  expect(second.nonce).not.toBe(receipt.nonce);
  expect(parsePaperBlock(receipt)).toBeNull();
  expect(parsePaperConsumption(receipt)).toBeNull();
  const paperAccept = createCustodyCheckVerifier(created, { ...request, kind: "secret-paper" });
  expect(await paperAccept(receipt)).toBe(false);
  expect(await paperAccept({ ...receipt, kind: "secret-paper" })).toBe(false);
  const accept = createCustodyCheckVerifier(created, request);
  expect(await accept(receipt)).toBe(true);
  expect(await accept(second)).toBe(true);
  expect(await accept(receipt)).toBe(false);
  created.dispose();
  key.dispose();
});

it("makes paper and file receipts noninterchangeable and rejects replay or another request", async () => {
  const created = await createCustodyKey(scope);
  const paper = await restoreSecretPaper(await encodeSecretPaper(created), created);
  const receipt = await checkCustodyChallenge(paper, created, { ...request, kind: "secret-paper" });
  const accept = createCustodyCheckVerifier(created, { ...request, kind: "secret-paper" });
  expect(await createCustodyCheckVerifier(created, request)(receipt)).toBe(false);
  expect(
    await createCustodyCheckVerifier(created, { requestId: "different", kind: "secret-paper" })(
      receipt,
    ),
  ).toBe(false);
  expect(
    await createCustodyCheckVerifier(created, request)({ ...receipt, kind: "saved-file" }),
  ).toBe(false);
  expect(await accept({ ...receipt, requestId: "different" })).toBe(false);
  expect(await Promise.all([accept(receipt), accept(receipt)])).toEqual([true, false]);
  created.dispose();
  paper.dispose();
});

it("does not sign with a fresh, wrong-origin, disposed, foreign, or mismatched public/scope key", async () => {
  const created = await createCustodyKey(scope),
    other = await createCustodyKey(scope);
  const key = await restoreSecretPaper(await encodeSecretPaper(created), created);
  const signing = vi.spyOn(crypto.subtle, "sign");
  const paperRequest = { ...request, kind: "secret-paper" as const };
  await expect(checkCustodyChallenge(created, created, request)).rejects.toMatchObject(refused);
  await expect(checkCustodyChallenge(key, created, request)).rejects.toMatchObject(refused);
  for (const expected of [
    other,
    { ...created, fingerprint: "0".repeat(64) },
    { ...created, publicKey: other.publicKey },
    { ...created, scope: { ...scope, custodianId: "foreign" } },
  ])
    await expect(checkCustodyChallenge(key, expected, paperRequest)).rejects.toMatchObject(refused);
  key.dispose();
  await expect(checkCustodyChallenge(key, created, paperRequest)).rejects.toMatchObject(refused);
  expect(signing).not.toHaveBeenCalled();
  created.dispose();
  other.dispose();
});

it("verifies the challenge against independently supplied authority and hides native errors", async () => {
  const created = await createCustodyKey(scope);
  const key = await restoreSecretPaper(await encodeSecretPaper(created), created);
  vi.spyOn(crypto.subtle, "sign").mockResolvedValueOnce(new Uint8Array(64).buffer);
  await expect(
    checkCustodyChallenge(key, created, { ...request, kind: "secret-paper" }),
  ).rejects.toMatchObject(refused);
  created.dispose();
  key.dispose();
});

it("rejects malformed receipts without accepting a modified signature, kind or nonce", async () => {
  const created = await createCustodyKey(scope);
  const key = await restoreSecretPaper(await encodeSecretPaper(created), created);
  const check = { ...request, kind: "secret-paper" as const };
  const receipt = await checkCustodyChallenge(key, created, check);
  for (const bad of [
    null,
    [],
    { ...receipt, version: 2 },
    { ...receipt, extra: true },
    { ...receipt, kind: "other" },
    { ...receipt, fingerprint: "0".repeat(64) },
    { ...receipt, nonce: Buffer.alloc(31).toString("base64") },
    { ...receipt, signature: Buffer.alloc(64).toString("base64") },
    { ...receipt, signature: "@@@@" },
  ])
    expect(await createCustodyCheckVerifier(created, check)(bad)).toBe(false);
  expect(await createCustodyCheckVerifier(created, check)(receipt)).toBe(true);
  created.dispose();
  key.dispose();
});

it("rejects malformed check bindings and unusable independent public keys before signing", async () => {
  const created = await createCustodyKey(scope);
  const key = await restoreSecretPaper(await encodeSecretPaper(created), created);
  const check = { ...request, kind: "secret-paper" as const };
  const signing = vi.spyOn(crypto.subtle, "sign");
  for (const bad of [
    null,
    { ...check, extra: true },
    { ...check, requestId: "" },
    { ...check, kind: "other" },
  ])
    await expect(checkCustodyChallenge(key, created, bad as typeof check)).rejects.toMatchObject(
      refused,
    );
  for (const publicKey of [
    "not a PEM key",
    "x".repeat(1025),
    "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n",
    `-----BEGIN PUBLIC KEY-----\n${Buffer.alloc(44).toString("base64")}\n-----END PUBLIC KEY-----\n`,
  ])
    await expect(
      checkCustodyChallenge(key, { ...created, publicKey }, check),
    ).rejects.toMatchObject(refused);
  expect(signing).not.toHaveBeenCalled();
  created.dispose();
  key.dispose();
});
