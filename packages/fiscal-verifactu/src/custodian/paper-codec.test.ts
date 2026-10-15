import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createCustodyKey } from "./key-codec.js";
import { encodeSecretPaper, restoreSecretPaper } from "./paper-codec.js";

const scope = {
  custodianId: "test-custodian",
  taxpayerNif: "B12345674",
  softwareId: "W1",
  environment: "production" as const,
};
const refused = { message: "Custody material refused" };
afterEach(() => vi.restoreAllMocks());
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function fixture(
  prefix = "302e020100300506032b657004220420",
  seed = "11".repeat(32),
  declaredFingerprint?: string,
) {
  const der = Buffer.from("302e020100300506032b657004220420" + seed, "hex");
  const publicKey = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  const actualFingerprint = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
  const expected = {
    scope,
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    fingerprint: actualFingerprint,
  };
  const fingerprint = declaredFingerprint ?? actualFingerprint;
  const hex = (prefix + seed).toUpperCase();
  const groups = Array.from({ length: 12 }, (_, i) => {
    const index = String(i + 1).padStart(2, "0"),
      group = hex.slice(i * 8, i * 8 + 8);
    return `${index}:${group}:${hash(["waitron.custodian-paper.group", 1, scope, fingerprint, index, group]).slice(0, 8).toUpperCase()}`;
  });
  const lines = [
    "SECRET / SECRETO",
    "waitron-custodian-paper",
    "version 1",
    "Ed25519 / PKCS8-DER / HEX",
    `scope ${JSON.stringify(scope)}`,
    `fingerprint ${fingerprint}`,
    "page 1/1",
    ...groups,
    `checksum ${hash(["waitron.custodian-paper", 1, scope, fingerprint, hex])}`,
  ];
  return { text: lines.join("\n"), expected, lines };
}

it("restores an independently encoded synthetic key and renders twelve checked groups on one page", async () => {
  const f = fixture();
  const key = await restoreSecretPaper(f.text, f.expected);
  expect(key.fingerprint).toBe(f.expected.fingerprint);
  expect(key.publicKey).toBe(f.expected.publicKey);
  expect(await encodeSecretPaper(key)).toBe(f.text);
  expect((await restoreSecretPaper(f.text.replaceAll("\n", "\r\n"), f.expected)).publicKey).toBe(
    key.publicKey,
  );
  key.dispose();
});

it("encodes a newly created key that a separate recovery session can restore", async () => {
  const key = await createCustodyKey(scope);
  const paper = await encodeSecretPaper(key);
  const expected = { scope: key.scope, publicKey: key.publicKey, fingerprint: key.fingerprint };
  key.dispose();
  const restored = await restoreSecretPaper(paper, expected);
  expect(restored.publicKey).toBe(expected.publicKey);
  expect(restored.fingerprint).toBe(expected.fingerprint);
  expect(paper.split("\n").filter((l) => /^\d\d:/.test(l))).toHaveLength(12);
  restored.dispose();
});

it.each(Array.from({ length: 12 }, (_, i) => i))(
  "rejects missing, duplicate, reordered and mistyped group %i before signing",
  async (index) => {
    const f = fixture();
    const signing = vi.spyOn(crypto.subtle, "sign");
    const missing = [...f.lines];
    missing.splice(7 + index, 1);
    const duplicate = [...f.lines];
    duplicate.splice(7 + index, 0, duplicate[7 + index]!);
    const reordered = [...f.lines];
    const next = 7 + ((index + 1) % 12);
    [reordered[7 + index], reordered[next]] = [reordered[next]!, reordered[7 + index]!];
    const typo = [...f.lines];
    typo[7 + index] = typo[7 + index]!.slice(0, 3) + "F" + typo[7 + index]!.slice(4);
    const badCheck = [...f.lines];
    const old = badCheck[7 + index]!;
    badCheck[7 + index] = old.slice(0, -1) + (old.endsWith("0") ? "1" : "0");
    for (const lines of [missing, duplicate, reordered, typo, badCheck])
      await expect(restoreSecretPaper(lines.join("\n"), f.expected)).rejects.toMatchObject(refused);
    expect(signing).not.toHaveBeenCalled();
  },
);

it("refuses checksum, version, page, DER, scope and independent fingerprint mismatches before signing", async () => {
  const f = fixture(),
    other = fixture(undefined, "22".repeat(32));
  const signing = vi.spyOn(crypto.subtle, "sign");
  const bad = [
    f.text.replace("version 1", "version 2"),
    f.text.replace("page 1/1", "page 1/2"),
    f.text.replace("Ed25519", "RSA"),
    f.text.replace("SECRET / SECRETO", "PUBLIC"),
    f.text.replace(/checksum ./, "checksum Z"),
    f.text.slice(0, -1) + (f.text.endsWith("0") ? "1" : "0"),
    fixture(undefined, undefined, "0".repeat(64)).text,
    f.text.replace("scope {", 'scope {"extra":true,'),
    fixture("302e020200300506032b657004220420").text,
    fixture("302e020101300506032b657004220420").text,
    f.text + "\n",
    "é".repeat(8193),
    f.text.replace("01:", "01\u00a0:"),
  ];
  for (const text of bad)
    await expect(restoreSecretPaper(text, f.expected)).rejects.toMatchObject(refused);
  await expect(restoreSecretPaper(other.text, f.expected)).rejects.toMatchObject(refused);
  await expect(
    restoreSecretPaper(f.text, {
      ...f.expected,
      fingerprint: "0" + f.expected.fingerprint.slice(1),
    }),
  ).rejects.toMatchObject(refused);
  await expect(
    restoreSecretPaper(f.text, { ...f.expected, scope: { ...scope, custodianId: "other" } }),
  ).rejects.toMatchObject(refused);
  await expect(
    restoreSecretPaper(f.text, { ...f.expected, publicKey: other.expected.publicKey }),
  ).rejects.toMatchObject(refused);
  expect(signing).not.toHaveBeenCalled();
});

it("refuses a disposed handle instead of emitting secret paper", async () => {
  const key = await createCustodyKey(scope);
  key.dispose();
  await expect(encodeSecretPaper(key)).rejects.toMatchObject(refused);
});
