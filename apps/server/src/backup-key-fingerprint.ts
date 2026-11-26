import { createHash } from "node:crypto";

/** The first 8 hex characters of the SHA-256 of the backup key's text, shown beside the key. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}
