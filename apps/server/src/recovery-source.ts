import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";

export function recoveryArchiveSourceId(artifact: Uint8Array): string {
  return createHash("sha256").update(artifact).digest("hex");
}

export async function recoveryArchiveFileSourceId(artifactPath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(artifactPath)) hash.update(bytes as Buffer);
  return hash.digest("hex");
}

export async function recoveryStreamSourceId(
  databasePath: string,
  entries: readonly ArchiveEntry[],
): Promise<string> {
  const ordered = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const hash = createHash("sha256")
    .update("waitron-stream-recovery-v1\0")
    .update(packArchive(ordered));
  for await (const bytes of createReadStream(databasePath)) hash.update(bytes as Buffer);
  return `stream-sha256:${hash.digest("hex")}`;
}
