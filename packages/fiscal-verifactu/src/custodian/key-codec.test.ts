import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  pbkdf2Sync,
  sign,
  verify,
} from "node:crypto";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as codec from "./key-codec.js";

const scope = {
  custodianId: "test-custodian",
  taxpayerNif: "B12345674",
  softwareId: "W1",
  environment: "production" as const,
};
const password = "  twelve-ñ-words  ";
interface TestEnvelope extends Record<string, unknown> {
  kdf: Record<string, unknown> & { salt: string };
  cipher: Record<string, unknown>;
  scope: Record<string, unknown>;
}
const refused = { message: "Custody material refused" };
afterEach(() => vi.restoreAllMocks());

describe("protected custody file", () => {
  it("reopens the same key with canonical DER, independently decryptable AAD and full fingerprint", async () => {
    const key = await codec.createCustodyKey(scope);
    const text = await codec.protectCustodyKey(key, password);
    const envelope = JSON.parse(text);
    expect(Object.keys(envelope)).toEqual([
      "kind",
      "version",
      "kdf",
      "cipher",
      "scope",
      "fingerprint",
      "ciphertext",
    ]);
    expect(envelope).toMatchObject({
      kind: "waitron-custodian-key",
      version: 1,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000 },
      cipher: { name: "AES-GCM", bits: 256, tagBits: 128 },
      scope,
    });
    const salt = Buffer.from(envelope.kdf.salt, "base64");
    const iv = Buffer.from(envelope.cipher.iv, "base64");
    expect(salt.length).toBe(16);
    expect(iv.length).toBe(12);
    expect(salt.toString("base64")).toBe(envelope.kdf.salt);
    expect(iv.toString("base64")).toBe(envelope.cipher.iv);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      pbkdf2Sync(password, salt, 600000, 32, "sha256"),
      iv,
    );
    decipher.setAAD(
      Buffer.from(
        JSON.stringify([
          envelope.kind,
          envelope.version,
          envelope.kdf,
          envelope.cipher,
          scope,
          key.fingerprint,
        ]),
      ),
    );
    const encrypted = Buffer.from(envelope.ciphertext, "base64");
    decipher.setAuthTag(encrypted.subarray(-16));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString(),
    );
    expect(Object.keys(payload)).toEqual(["version", "pkcs8"]);
    expect(payload.version).toBe(1);
    const der = Buffer.from(payload.pkcs8, "base64");
    expect(der.length).toBe(48);
    expect(der.subarray(0, 16).toString("hex")).toBe("302e020100300506032b657004220420");
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const publicKey = createPublicKey(privateKey);
    const spki = publicKey.export({ format: "der", type: "spki" });
    expect(spki.length).toBe(44);
    expect(spki.subarray(0, 12).toString("hex")).toBe("302a300506032b6570032100");
    expect(key.publicKey).toBe(publicKey.export({ format: "pem", type: "spki" }));
    expect(key.fingerprint).toBe(createHash("sha256").update(spki).digest("hex"));
    const opened = await codec.openCustodyKey(text, password, key);
    expect(opened.fingerprint).toBe(key.fingerprint);
    expect(opened.scope).toEqual(scope);
    const webPublic = await crypto.subtle.importKey("spki", spki, "Ed25519", false, ["verify"]);
    const message = new TextEncoder().encode("independent test challenge");
    expect(
      await crypto.subtle.verify("Ed25519", webPublic, sign(null, message, privateKey), message),
    ).toBe(true);
    const webPrivate = await crypto.subtle.importKey("pkcs8", der, "Ed25519", false, ["sign"]);
    expect(
      verify(
        null,
        message,
        publicKey,
        Buffer.from(await crypto.subtle.sign("Ed25519", webPrivate, message)),
      ),
    ).toBe(true);
    expect(JSON.stringify(opened)).not.toContain(payload.pkcs8);
    opened.dispose();
    key.dispose();
  });

  it("uses independent random salt, IV and ciphertext on each protection", async () => {
    const key = await codec.createCustodyKey(scope);
    const a = JSON.parse(await codec.protectCustodyKey(key, password));
    const b = JSON.parse(await codec.protectCustodyKey(key, password));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    key.dispose();
  });

  it.each(["a".repeat(11), "é".repeat(513)])(
    "refuses out-of-bound UTF-8 passphrases before derivation",
    async (pass) => {
      const key = await codec.createCustodyKey(scope);
      const derive = vi.spyOn(crypto.subtle, "deriveKey");
      await expect(codec.protectCustodyKey(key, pass)).rejects.toMatchObject(refused);
      expect(derive).not.toHaveBeenCalled();
      key.dispose();
    },
  );

  it.each(["é".repeat(6), "é".repeat(512)])(
    "accepts inclusive UTF-8 passphrase bounds without normalization",
    async (pass) => {
      const key = await codec.createCustodyKey(scope);
      const file = await codec.protectCustodyKey(key, pass);
      expect((await codec.openCustodyKey(file, pass, key)).fingerprint).toBe(key.fingerprint);
      await expect(codec.openCustodyKey(file, pass.normalize("NFD"), key)).rejects.toMatchObject(
        refused,
      );
      key.dispose();
    },
  );

  it("refuses wrong passwords, tag/ciphertext/metadata changes and other valid keys without signing", async () => {
    const key = await codec.createCustodyKey(scope);
    const other = await codec.createCustodyKey(scope);
    const file = await codec.protectCustodyKey(key, password);
    const signing = vi.spyOn(crypto.subtle, "sign");
    await expect(codec.openCustodyKey(file, password.trim(), key)).rejects.toMatchObject(refused);
    await expect(codec.openCustodyKey(file, password, other)).rejects.toMatchObject(refused);
    for (const index of [0, -1]) {
      const e = JSON.parse(file);
      const bytes = Buffer.from(e.ciphertext, "base64");
      bytes[index < 0 ? bytes.length - 1 : index]! ^= 1;
      e.ciphertext = bytes.toString("base64");
      await expect(codec.openCustodyKey(JSON.stringify(e), password, key)).rejects.toMatchObject(
        refused,
      );
    }
    const e = JSON.parse(file);
    e.scope.custodianId = "other";
    await expect(
      codec.openCustodyKey(JSON.stringify(e), password, { ...key, scope: e.scope }),
    ).rejects.toMatchObject(refused);
    expect(signing).not.toHaveBeenCalled();
    key.dispose();
    other.dispose();
  });

  it("rejects malformed/oversize and noncanonical envelopes before expensive derivation", async () => {
    const key = await codec.createCustodyKey(scope);
    const file = await codec.protectCustodyKey(key, password);
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    const mutations = [
      (e: TestEnvelope) => {
        e.extra = true;
      },
      (e: TestEnvelope) => {
        e.version = 2;
      },
      (e: TestEnvelope) => {
        e.kind = "unknown";
      },
      (e: TestEnvelope) => {
        e.kdf.iterations = 1;
      },
      (e: TestEnvelope) => {
        e.kdf.hash = "SHA-1";
      },
      (e: TestEnvelope) => {
        e.kdf.name = "scrypt";
      },
      (e: TestEnvelope) => {
        e.kdf.extra = true;
      },
      (e: TestEnvelope) => {
        e.kdf.salt = "@@@@";
      },
      (e: TestEnvelope) => {
        e.kdf.salt = e.kdf.salt.replace(/=+$/, "");
      },
      (e: TestEnvelope) => {
        e.kdf.salt = Buffer.alloc(15).toString("base64");
      },
      (e: TestEnvelope) => {
        e.cipher.name = "AES-CBC";
      },
      (e: TestEnvelope) => {
        e.cipher.bits = 128;
      },
      (e: TestEnvelope) => {
        e.cipher.tagBits = 96;
      },
      (e: TestEnvelope) => {
        e.cipher.iv = Buffer.alloc(13).toString("base64");
      },
      (e: TestEnvelope) => {
        e.cipher.extra = true;
      },
      (e: TestEnvelope) => {
        e.scope.environment = "test";
      },
      (e: TestEnvelope) => {
        e.scope.extra = true;
      },
      (e: TestEnvelope) => {
        delete e.scope.taxpayerNif;
      },
      (e: TestEnvelope) => {
        e.fingerprint = "0".repeat(63);
      },
      (e: TestEnvelope) => {
        e.ciphertext = Buffer.alloc(4113).toString("base64");
      },
      (e: TestEnvelope) => {
        e.ciphertext = Buffer.alloc(16).toString("base64");
      },
    ];
    for (const mutate of mutations) {
      const e = JSON.parse(file);
      mutate(e);
      await expect(codec.openCustodyKey(JSON.stringify(e), password, key)).rejects.toMatchObject(
        refused,
      );
    }
    for (const bad of ["{", "null", "[]", "é".repeat(8193)])
      await expect(codec.openCustodyKey(bad, password, key)).rejects.toMatchObject(refused);
    expect(derive).not.toHaveBeenCalled();
    key.dispose();
  });

  it("makes disposed or invented handles unusable and contains native failures", async () => {
    const key = await codec.createCustodyKey(scope);
    key.dispose();
    key.dispose();
    await expect(codec.protectCustodyKey(key, password)).rejects.toMatchObject(refused);
    await expect(codec.protectCustodyKey({ ...key }, password)).rejects.toMatchObject(refused);
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValueOnce(new Error("native detail"));
    await expect(codec.createCustodyKey(scope)).rejects.toMatchObject(refused);
  });

  it("refuses authenticated but malformed payloads and inconsistent public metadata", async () => {
    const key = await codec.createCustodyKey(scope);
    const file = JSON.parse(await codec.protectCustodyKey(key, password));
    const der = Buffer.from("302e020100300506032b657004220420" + "11".repeat(32), "hex");
    function seal(payload: unknown, fingerprint = key.fingerprint) {
      const envelope = { ...file, fingerprint };
      const cipher = createCipheriv(
        "aes-256-gcm",
        pbkdf2Sync(password, Buffer.from(file.kdf.salt, "base64"), 600000, 32, "sha256"),
        Buffer.from(file.cipher.iv, "base64"),
      );
      cipher.setAAD(
        Buffer.from(
          JSON.stringify([
            envelope.kind,
            envelope.version,
            envelope.kdf,
            envelope.cipher,
            scope,
            fingerprint,
          ]),
        ),
      );
      envelope.ciphertext = Buffer.concat([
        cipher.update(typeof payload === "string" ? payload : JSON.stringify(payload)),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("base64");
      return JSON.stringify(envelope);
    }
    for (const payload of [
      null,
      [],
      { version: 2, pkcs8: der.toString("base64") },
      { version: 1, pkcs8: der.toString("base64"), extra: true },
      { version: 1, pkcs8: Buffer.alloc(48).toString("base64") },
      { version: 1, pkcs8: Buffer.alloc(47).toString("base64") },
      "{",
    ])
      await expect(codec.openCustodyKey(seal(payload), password, key)).rejects.toMatchObject(
        refused,
      );
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const nodePublic = createPublicKey(privateKey);
    const expected = {
      scope,
      publicKey: nodePublic.export({ format: "pem", type: "spki" }).toString(),
      fingerprint: createHash("sha256")
        .update(nodePublic.export({ format: "der", type: "spki" }))
        .digest("hex"),
    };
    await expect(
      codec.openCustodyKey(seal({ version: 1, pkcs8: der.toString("base64") }), password, expected),
    ).rejects.toMatchObject(refused);
    const imported = await codec.openCustodyKey(
      seal({ version: 1, pkcs8: der.toString("base64") }, expected.fingerprint),
      password,
      expected,
    );
    expect(imported.publicKey).toBe(expected.publicKey);
    imported.dispose();
    key.dispose();
  });

  it("checks scope before asking the browser to create a key", async () => {
    const generate = vi.spyOn(crypto.subtle, "generateKey");
    for (const bad of [
      null,
      [],
      { ...scope, extra: true },
      { ...scope, custodianId: "" },
      { ...scope, taxpayerNif: " bad " },
      { ...scope, softwareId: "long" },
      { ...scope, environment: "test" },
    ])
      await expect(codec.createCustodyKey(bad as typeof scope)).rejects.toMatchObject(refused);
    expect(generate).not.toHaveBeenCalled();
  });

  it("bundles only native browser facilities through the explicit custodian entry", async () => {
    const result = await build({
      stdin: {
        contents: 'export * from "@waitron/fiscal-verifactu/custodian";',
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      logLevel: "silent",
    });
    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0]!.text).not.toMatch(/\bBuffer\b|node:crypto|node:util/);
  });
});
