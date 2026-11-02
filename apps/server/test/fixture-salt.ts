import { randomBytes } from "node:crypto";
import { encryptArtifactWithSalt } from "../src/artifact-cipher.js";

// Drawn once per test file, so every archive the fixtures seal under one password reuses one
// derived key (src/testing/derived-key-cache-setup.ts). The IV is still fresh for each seal.
const salt = randomBytes(16);

export function sealFixtureArtifact(plaintext: Uint8Array, passphrase: string): Buffer {
  return encryptArtifactWithSalt(plaintext, passphrase, salt);
}
