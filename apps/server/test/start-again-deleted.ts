import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { START_AGAIN_CONFIRMATIONS_DIR, readStartAgainMarker } from "@waitron/provisioning";

type Roots = { stateDir: string; venueDir: string };

/** The plan's D3 deletion list. */
const DELETED = {
  venue: [
    "venue.db",
    "node.db",
    "venue.db-wal",
    "venue.db-shm",
    "node.db-wal",
    "node.db-shm",
    "first-setup-claim.json",
  ],
  state: [
    "module-preparation-state.json",
    "first-fiscal-documents",
    "first-setup-node-key.json",
    "module-operation-public.json",
    "first-setup-resolutions",
    "first-setup.json",
  ],
} as const;

export async function expectStartAgainDeleted(roots: Roots): Promise<void> {
  for (const [dir, names] of [
    [roots.venueDir, DELETED.venue],
    [roots.stateDir, DELETED.state],
  ] as const)
    for (const name of names)
      await expect(lstat(join(dir, name)), name).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
}

async function confirmations(stateDir: string): Promise<string[] | null> {
  try {
    return (await readdir(join(stateDir, START_AGAIN_CONFIRMATIONS_DIR))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** For a refused Start again: no marker, and the confirmation folder's entries as they were. */
export async function startAgainUnchanged(roots: Roots): Promise<() => Promise<void>> {
  const before = await confirmations(roots.stateDir);
  return async () => {
    expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
    expect(await confirmations(roots.stateDir)).toEqual(before);
  };
}

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(join(dir, prefix))).sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    // Every exclusive turn rewrites the anchor's own lock pair.
    if (prefix === "" && /^venue\.(lock|holder)/.test(name)) continue;
    if ((await lstat(join(dir, relative))).isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else
      result[relative] = createHash("sha256")
        .update(await readFile(join(dir, relative)))
        .digest("hex");
  }
  return result;
}

/** Every file under the two folders and a digest of its bytes, the anchor's lock pair left out. */
export async function diskSnapshot(roots: Roots) {
  return { venue: await tree(roots.venueDir), state: await tree(roots.stateDir) };
}
