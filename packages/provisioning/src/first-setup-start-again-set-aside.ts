import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { AppError } from "@waitron/shared";
import type { StartAgainChoiceRecord } from "./first-setup-start-again-choice.js";
import type { StartAgainUnit } from "./first-setup-start-again-leftovers.js";
import { START_AGAIN_SET_ASIDE_DIR } from "./first-setup-start-again-names.js";
import { raiseStartAgainNote, readStartAgainNote } from "./first-setup-start-again-note.js";
import "./errors.js";

export interface SetAsideIo {
  lstat: typeof fs.lstat;
  mkdir: typeof fs.mkdir;
  rmdir: typeof fs.rmdir;
  rename: (from: string, to: string) => Promise<void>;
}

type Root = "venue" | "state";
type Roots = { stateDir: string; venueDir: string };
type Destinations = { readonly state: string; readonly venue: string };

const defaultIo: SetAsideIo = {
  lstat: fs.lstat,
  mkdir: fs.mkdir,
  rmdir: fs.rmdir,
  rename: fs.rename,
};
const PROBE = ".first-setup-set-aside-probe-";
const LEFTOVER_PROBE =
  /^\.first-setup-set-aside-probe-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODE = 0o700;

const codeOf = (error: unknown) =>
  String(
    (error !== null && typeof error === "object" && (error as { code?: unknown }).code) ||
      "unknown",
  );
const rootDir = (roots: Roots, root: Root) => (root === "venue" ? roots.venueDir : roots.stateDir);
const failed = (code: string, label: string) =>
  new AppError(
    "setup.start_again_incomplete",
    {},
    { reason: `set-aside failed: ${code} ${label}` },
  );

/**
 * Folders relative to their roots, for the choice record. Venue units go beside the state units
 * when both roots report one filesystem; otherwise into the venue folder's own set-aside folder,
 * whose path is the stem folder itself. `setAsideFolders` tells the two apart by that last segment.
 * Takes canonical roots.
 */
export async function setAsideDestinations(
  roots: Roots,
  stem: string,
  io: SetAsideIo = defaultIo,
): Promise<{ state: string; venue: string }> {
  const one = (await io.lstat(roots.stateDir)).dev === (await io.lstat(roots.venueDir)).dev;
  const folder = `${START_AGAIN_SET_ASIDE_DIR}/${stem}`;
  return { state: `${folder}/state`, venue: one ? `${folder}/venue` : folder };
}

const venueBesideState = (destinations: Destinations) =>
  destinations.venue.split("/").at(-1) === "venue";

/** The root folder each root's destination is under. */
const destinationRoots = (roots: Roots, destinations: Destinations): Record<Root, string> => ({
  state: roots.stateDir,
  venue: venueBesideState(destinations) ? roots.stateDir : roots.venueDir,
});

/** The absolute destination folder for each root's units, from the record's relative ones. */
function setAsideFolders(roots: Roots, destinations: Destinations): Record<Root, string> {
  const under = destinationRoots(roots, destinations);
  return {
    state: join(under.state, destinations.state),
    venue: join(under.venue, destinations.venue),
  };
}

/** The `<stem>` folder a root's destination lives in: its parent, or itself under the venue root. */
const stemFolderOf = (root: Root, folders: Record<Root, string>, destinations: Destinations) =>
  root === "state" || venueBesideState(destinations) ? dirname(folders[root]) : folders[root];

/** Box-named empty probe folders a cut left, in each root and in any set-aside stem folder. */
async function removeLeftoverProbes(roots: Roots, io: SetAsideIo): Promise<void> {
  const list = async (folder: string) => {
    try {
      return await fs.readdir(folder);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(codeOf(error))) return [];
      throw error;
    }
  };
  const folders: string[] = [];
  for (const root of [roots.stateDir, roots.venueDir]) {
    folders.push(root);
    const base = join(root, START_AGAIN_SET_ASIDE_DIR);
    for (const stem of await list(base)) {
      folders.push(join(base, stem));
      for (const sub of ["state", "venue"]) folders.push(join(base, stem, sub));
    }
  }
  for (const folder of folders)
    for (const name of await list(folder))
      if (LEFTOVER_PROBE.test(name))
        try {
          await io.rmdir(join(folder, name));
        } catch (error) {
          // Not empty, or not a folder: not a probe this code left, so it stays.
          if (!["ENOTEMPTY", "EEXIST", "ENOTDIR"].includes(codeOf(error))) throw error;
        }
}

/**
 * D4 step 1, before the record: the set-aside folders, then a rename probe from each source root
 * the units use into its destination. A failure removes the empty folders this call made; `EXDEV`
 * refuses `setup.start_again_set_aside_unavailable`, anything else is thrown as it came.
 */
export async function prepareSetAside(
  roots: Roots,
  units: readonly StartAgainUnit[],
  destinations: Destinations,
  io: SetAsideIo = defaultIo,
): Promise<void> {
  const folders = setAsideFolders(roots, destinations);
  const used = (["state", "venue"] as const).filter((root) =>
    units.some((unit) => unit.root === root),
  );
  const made: string[] = [];
  let probeAt: string | null = null;
  try {
    await removeLeftoverProbes(roots, io);
    for (const root of used) {
      const stemFolder = stemFolderOf(root, folders, destinations);
      const base = dirname(stemFolder);
      if ((await io.mkdir(base, { recursive: true, mode: MODE })) !== undefined) made.push(base);
      if (!made.includes(stemFolder)) {
        try {
          await io.mkdir(stemFolder, { mode: MODE });
        } catch (error) {
          if (codeOf(error) === "EEXIST") throw new AppError("setup.attempt_conflict", {});
          throw error;
        }
        made.push(stemFolder);
      }
      if (folders[root] !== stemFolder) {
        await io.mkdir(folders[root], { mode: MODE });
        made.push(folders[root]);
      }
    }
    for (const root of used) {
      const name = `${PROBE}${basename(stemFolderOf(root, folders, destinations))}`;
      const probe = join(rootDir(roots, root), name);
      await io.mkdir(probe, { mode: MODE });
      probeAt = probe;
      await io.rename(probe, join(folders[root], name));
      probeAt = join(folders[root], name);
      await io.rmdir(probeAt);
      probeAt = null;
    }
  } catch (error) {
    for (const folder of [...(probeAt === null ? [] : [probeAt]), ...made.reverse()])
      await io.rmdir(folder).catch(() => undefined);
    if (codeOf(error) === "EXDEV")
      throw new AppError(
        "setup.start_again_set_aside_unavailable",
        {},
        { reason: "rename crosses filesystems" },
      );
    throw error;
  }
}

async function syncFolder(path: string): Promise<void> {
  const folder = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

/** `top`, then every folder below it down to `bottom`, which is inside it or is it. */
function chain(top: string, bottom: string): string[] {
  const out = [top];
  for (const name of relative(top, bottom)
    .split(sep)
    .filter((part) => part !== ""))
    out.push(join(out.at(-1)!, name));
  return out;
}

/**
 * D4 steps 3 and 4: raises the note to the record's floor, then renames each unit's pieces, in
 * survey order and each unit's move order, into the record's folders. Never overwrites: a present
 * destination refuses. The caller holds the venue lock.
 */
export async function moveStartAgainUnits(
  roots: Roots,
  record: StartAgainChoiceRecord,
  io: SetAsideIo = defaultIo,
): Promise<void> {
  if (record.choice !== "move" || record.setAside === null)
    throw new AppError("setup.attempt_invalid", {});
  const folders = setAsideFolders(roots, record.setAside);
  if (record.noteFloorMs !== null) {
    const note = await readStartAgainNote(roots.stateDir);
    if (note !== null)
      await raiseStartAgainNote(roots.stateDir, {
        floorMs: record.noteFloorMs,
        lastName: note.lastName,
        module: note.module,
      });
  }
  const under = destinationRoots(roots, record.setAside);
  for (const root of ["state", "venue"] as const) {
    if (!record.listed.units.some((unit) => unit.root === root)) continue;
    try {
      // Made without a sync before the record; each folder's entry is synced before a piece lands.
      await io.mkdir(folders[root], { recursive: true, mode: MODE });
      for (const folder of chain(under[root], folders[root])) await syncFolder(folder);
    } catch (error) {
      const at = under[root] === roots.stateDir ? "state" : "venue";
      throw failed(codeOf(error), `${at}/${record.setAside[root]}`);
    }
  }
  for (const unit of record.listed.units)
    for (const piece of unit.pieces) {
      const label = `${unit.root}/${piece}`;
      const from = join(rootDir(roots, unit.root), piece);
      const to = join(folders[unit.root], piece);
      try {
        const present = await io.lstat(to).then(
          () => true,
          (error: unknown) => {
            if (codeOf(error) === "ENOENT") return false;
            throw error;
          },
        );
        if (present) throw failed("EEXIST", label);
        await io.mkdir(dirname(to), { recursive: true, mode: MODE });
        await io.rename(from, to);
        await syncFolder(dirname(from));
        for (const folder of chain(folders[unit.root], dirname(to))) await syncFolder(folder);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw failed(codeOf(error), label);
      }
    }
}
