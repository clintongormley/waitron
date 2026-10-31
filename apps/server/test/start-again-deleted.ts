import type { Held } from "./start-again-held-fixture.js";
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir } from "node:fs/promises";
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
    "venue.db-journal",
    "node.db-journal",
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

export const snapshot = (f: Pick<Held, "roots">) => diskSnapshot(f.roots);

export async function heldConfirmationRecords(stateDir: string) {
  const folder = join(stateDir, START_AGAIN_CONFIRMATIONS_DIR);
  return Promise.all(
    (await readdir(folder)).map(
      async (name) =>
        JSON.parse(await readFile(join(folder, name), "utf8")) as {
          at: string;
          database: string;
          shown: unknown;
        },
    ),
  );
}

/** Sends Start again, and checks the refusal changed nothing: files, journal, records. */
export async function expectStartAgainRefused(f: Held, send: () => Promise<void>, refusal: object) {
  const before = await snapshot(f);
  const last = (await f.workspace.readChain()).at(-1);
  await expect(send()).rejects.toMatchObject(refusal);
  expect(await snapshot(f)).toEqual(before);
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
}

export const LEFT_STATE =
  /^(first-setup-start-again-confirmations\/(\w|[-.])*|first-setup-resolutions\/|first-setup-resolutions\/backup-recovery\/(current\.json)?|first-setup-resolutions\/backup-recovery\/[^/]+\/(\d{6}\.json|target\/|target\/(venue|state)\/|target\/(venue|state)\/((venue|migrations|recovery)\.lock(-journal)?|venue\.holder\.json))?)$/;

export const noConfirmations = (f: Held) =>
  expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });
