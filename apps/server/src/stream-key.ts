import { hkdfSync } from "node:crypto";

export function deriveStreamKey(backupKey: string, streamId: string): string {
  return Buffer.from(
    hkdfSync("sha256", backupKey, streamId, "waitron.stream.sse-c.v1", 32),
  ).toString("base64");
}
