import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { readStartAgainMarker } from "@waitron/provisioning";

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

/** For a refused Start again: no marker. */
export async function startAgainUnchanged(roots: Roots): Promise<() => Promise<void>> {
  return async () => {
    expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
  };
}
