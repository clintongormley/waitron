import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import { NODE_LOCAL_MANIFEST, sha256Hex, type NodeLocalItem } from "@waitron/handover";

const DIGESTED = new Set(["backup.env", "modules.json"]);
const RING = "secrets.env";

/**
 * The manifest as this box reports it in a handover. `secrets.env` carries only its key versions,
 * never a key or a digest of one: a digest of a 32-byte random key would still identify it.
 */
export async function buildNodeLocalManifest(
  stateDir: string,
  ring: KeyRing,
): Promise<NodeLocalItem[]> {
  const items: NodeLocalItem[] = [];
  for (const row of NODE_LOCAL_MANIFEST) {
    if (row.where === "state" && DIGESTED.has(row.item)) {
      items.push({ ...row, sha256: await digestOf(join(stateDir, row.item)) });
    } else if (row.where === "state" && row.item === RING) {
      items.push({ ...row, ringVersions: ringVersions(ring) });
    } else {
      items.push({ ...row });
    }
  }
  return items;
}

function ringVersions(ring: KeyRing): number[] {
  const versions = [ring.current.version];
  if (ring.previous !== undefined) versions.push(ring.previous.version);
  return versions.sort((a, b) => a - b);
}

async function digestOf(path: string): Promise<string | null> {
  try {
    return sha256Hex(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
