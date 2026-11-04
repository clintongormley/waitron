import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import {
  NODE_LOCAL_MANIFEST,
  sha256Hex,
  type NodeLocalItem,
  type RetainedRevision,
} from "@waitron/handover";
import { canonicalize } from "@waitron/membership";
import { readModulePreparationRevisions } from "@waitron/provisioning";
import { parseEnvFile } from "./env-file.js";
import { readModuleConfig } from "./module-config.js";

const BACKUP_SETTINGS = "backup.env";
const MODULE_SETTINGS = "modules.json";
const RING = "secrets.env";
const RETAINED_SELECTIONS = "module-preparation-state.json";

/**
 * `secrets.env` carries its key versions, not a digest: the receiving box must hold every version
 * the sender lists, which a digest of the file cannot answer. The two settings files are digested
 * as values, so two boxes that hold the same settings in another order or spacing read alike.
 */
export async function buildNodeLocalManifest(
  stateDir: string,
  ring: KeyRing,
): Promise<NodeLocalItem[]> {
  const items: NodeLocalItem[] = [];
  for (const row of NODE_LOCAL_MANIFEST) {
    if (row.where === "state" && row.item === BACKUP_SETTINGS) {
      items.push({ ...row, sha256: await backupSettingsDigest(stateDir) });
    } else if (row.where === "state" && row.item === MODULE_SETTINGS) {
      items.push({ ...row, sha256: await moduleSettingsDigest(stateDir) });
    } else if (row.where === "state" && row.item === RING) {
      items.push({ ...row, ringVersions: ringVersions(ring) });
    } else if (row.where === "state" && row.item === RETAINED_SELECTIONS) {
      // The file holds parsed JSON, so each value is one a signed body can carry.
      const revisions = await readModulePreparationRevisions({ stateDir });
      items.push({ ...row, revisions: revisions as readonly RetainedRevision[] });
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

async function backupSettingsDigest(stateDir: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(stateDir, BACKUP_SETTINGS), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return sha256Hex(canonicalize(parseEnvFile(text)));
}

/**
 * Only the modules switched off: a module is on unless named `false` (`isEnabled`), and setup names
 * the filing module `true` (`fiscal-slot.ts`), so a `true` entry changes no box's module set.
 */
async function moduleSettingsDigest(stateDir: string): Promise<string | null> {
  const { overrides } = await readModuleConfig(stateDir);
  const off = [...overrides].filter(([, enabled]) => !enabled);
  return off.length === 0 ? null : sha256Hex(canonicalize(Object.fromEntries(off)));
}
