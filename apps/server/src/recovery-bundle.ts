import { AppError } from "@waitron/shared";
import {
  encryptSecretEnvelope,
  decryptSecretEnvelope,
  MIN_PASSPHRASE_LENGTH,
} from "./secret-envelope.js";
import "./errors.js";

export { MIN_PASSPHRASE_LENGTH };

/** A recovery bundle's plaintext: relative posix path → UTF-8 file contents. */
export type BundleFiles = Record<string, string>;

export function encryptBundle(files: BundleFiles, passphrase: string): string {
  return encryptSecretEnvelope(JSON.stringify(files), passphrase);
}

export function decryptBundle(envelopeJson: string, passphrase: string): BundleFiles {
  const plaintext = decryptSecretEnvelope(envelopeJson, passphrase);
  // GCM auth proves the envelope is authentic, NOT that its plaintext is a string-map: someone who
  // knows the passphrase can seal valid JSON that is an array or has non-string values, which would
  // then throw a RAW error out of unpackBundleToDir's Object.entries/writeFileAtomic. Validate the
  // shape before returning it.
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((v) => typeof v === "string")
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  return parsed as BundleFiles;
}
