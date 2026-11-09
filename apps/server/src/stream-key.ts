import { hkdfSync } from "node:crypto";

export function deriveStreamKey(backupKey: string, venueId: string): string {
  return Buffer.from(
    hkdfSync("sha256", backupKey, venueId, "waitron.stream.sse-c.v1", 32),
  ).toString("base64");
}
