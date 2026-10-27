import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { canonicalFirstSetupRoots } from "./first-setup-resolution.js";
import {
  readStartAgainChoices,
  type StartAgainChoiceRecord,
} from "./first-setup-start-again-choice.js";
import { readStartAgainMarker } from "./first-setup-start-again-deletion.js";
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
 * What stands at a root's set-aside name when it is not a real folder: `symlink`, `file` or
 * `other`; null when nothing is there or a real folder is. A Move never puts files through one.
 */
async function notASetAsideFolder(root: string, io: SetAsideIo): Promise<string | null> {
  return notAFolder(join(root, START_AGAIN_SET_ASIDE_DIR), io);
}

async function notAFolder(path: string, io: SetAsideIo): Promise<string | null> {
  let info;
  try {
    info = await io.lstat(path);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
  if (info.isDirectory()) return null;
  return info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : "other";
}

const setAsideLabel = (roots: Roots, root: string) =>
  `${root === roots.stateDir ? "state" : "venue"}/${START_AGAIN_SET_ASIDE_DIR}`;

/**
 * Folders relative to their roots, for the choice record. Venue units go beside the state units
 * when both roots report one filesystem; otherwise into the venue folder's own set-aside folder,
 * whose path is the stem folder itself. `setAsideFolderPaths` tells the two apart by that last segment.
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
export function setAsideFolderPaths(
  roots: Roots,
  destinations: Destinations,
): Record<Root, string> {
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
  // Descends only into real folders, so nothing is read or removed through a link.
  const folders: string[] = [];
  for (const root of [roots.stateDir, roots.venueDir]) {
    folders.push(root);
    if ((await notASetAsideFolder(root, io)) !== null) continue;
    const base = join(root, START_AGAIN_SET_ASIDE_DIR);
    for (const stem of await list(base)) {
      const stemFolder = join(base, stem);
      if ((await notAFolder(stemFolder, io)) !== null) continue;
      folders.push(stemFolder);
      for (const sub of ["state", "venue"])
        if ((await notAFolder(join(stemFolder, sub), io)) === null)
          folders.push(join(stemFolder, sub));
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
 * refuses `setup.start_again_set_aside_unavailable`, anything else is thrown as it came. Returns
 * the folders it made, deepest first.
 */
export async function prepareSetAside(
  roots: Roots,
  units: readonly StartAgainUnit[],
  destinations: Destinations,
  io: SetAsideIo = defaultIo,
): Promise<string[]> {
  const folders = setAsideFolderPaths(roots, destinations);
  const used = (["state", "venue"] as const).filter((root) =>
    units.some((unit) => unit.root === root),
  );
  const under = destinationRoots(roots, destinations);
  for (const root of used) {
    const found = await notASetAsideFolder(under[root], io);
    if (found !== null)
      throw new AppError(
        "setup.start_again_set_aside_unavailable",
        {},
        { reason: `set-aside failed: ${found} ${setAsideLabel(roots, under[root])}` },
      );
  }
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
  return made.reverse();
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

async function raiseNoteToRecord(stateDir: string, record: StartAgainChoiceRecord) {
  if (record.noteFloorMs === null) return;
  const note = await readStartAgainNote(stateDir);
  if (note !== null)
    await raiseStartAgainNote(stateDir, {
      floorMs: record.noteFloorMs,
      lastName: note.lastName,
      module: note.module,
    });
}

/** The record's destination folders, made if absent, each synced from its root down. */
async function makeDestinationFolders(
  roots: Roots,
  record: StartAgainChoiceRecord & { setAside: Destinations },
  io: SetAsideIo,
): Promise<Record<Root, string>> {
  const folders = setAsideFolderPaths(roots, record.setAside);
  const under = destinationRoots(roots, record.setAside);
  for (const root of ["state", "venue"] as const) {
    if (!record.listed.units.some((unit) => unit.root === root)) continue;
    const at = under[root] === roots.stateDir ? "state" : "venue";
    // A link there would take the pieces somewhere else.
    for (const folder of chain(under[root], folders[root]).slice(1)) {
      const found = await notAFolder(folder, io).catch((error: unknown) => codeOf(error));
      if (found !== null) throw failed(found, `${at}/${relative(under[root], folder)}`);
    }
    try {
      // Made without a sync before the record; each folder's entry is synced before a piece lands.
      await io.mkdir(folders[root], { recursive: true, mode: MODE });
      for (const folder of chain(under[root], folders[root])) await syncFolder(folder);
    } catch (error) {
      throw failed(codeOf(error), `${at}/${record.setAside[root]}`);
    }
  }
  return folders;
}

/** Refuses a piece whose parent folders under `base` are not all real folders: a link there leads outside the roots. */
async function refuseUnrealParents(
  base: string,
  piece: string,
  label: string,
  io: SetAsideIo,
): Promise<void> {
  for (const folder of chain(base, dirname(join(base, piece))).slice(1)) {
    const found = await notAFolder(folder, io);
    if (found !== null) throw failed(found, label);
  }
}

/** Renames one piece into its folder, never over anything, and syncs both parents. */
async function movePiece(
  roots: Roots,
  folders: Record<Root, string>,
  unit: StartAgainUnit,
  piece: string,
  io: SetAsideIo,
): Promise<void> {
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
    if (present) throw failed("EEXIST", `${unit.root}/${piece}`);
    await refuseUnrealParents(rootDir(roots, unit.root), piece, `${unit.root}/${piece}`, io);
    await refuseUnrealParents(folders[unit.root], piece, `${unit.root}/${piece}`, io);
    await io.mkdir(dirname(to), { recursive: true, mode: MODE });
    await io.rename(from, to);
    await syncFolder(dirname(from));
    for (const folder of chain(folders[unit.root], dirname(to))) await syncFolder(folder);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw failed(codeOf(error), `${unit.root}/${piece}`);
  }
}

const DATABASES = new Set(["venue.db", "node.db"]);
const SIDE_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

/**
 * Before a database's main file, its last piece, moves: a side file still at its source. The
 * recorded side pieces have moved by then, so one present was not recorded, and would stay behind
 * holding committed rows (D2). Its name, or null.
 */
async function unrecordedSideFile(
  roots: Roots,
  unit: StartAgainUnit,
  piece: string,
  io: SetAsideIo,
): Promise<string | null> {
  if (unit.root !== "venue" || piece !== unit.path || !DATABASES.has(piece)) return null;
  for (const suffix of SIDE_SUFFIXES) {
    const side = `${piece}${suffix}`;
    try {
      await io.lstat(join(roots.venueDir, side));
      return side;
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw failed(codeOf(error), `venue/${side}`);
    }
  }
  return null;
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
  await raiseNoteToRecord(roots.stateDir, record);
  const folders = await makeDestinationFolders(roots, { ...record, setAside: record.setAside }, io);
  for (const unit of record.listed.units)
    for (const piece of unit.pieces) {
      const side = await unrecordedSideFile(roots, unit, piece, io);
      if (side !== null) throw failed("unrecorded", `venue/${side}`);
      await movePiece(roots, folders, unit, piece, io);
    }
}

type Seen = {
  path: string;
  type: string;
  ino: string;
  size: string | null;
  mtimeNs: string | null;
};
const byPath = (a: Seen, b: Seen) => (a.path < b.path ? -1 : 1);

/** The piece and everything under it as the survey records entries; null when the piece is absent. */
async function entriesAt(base: string, piece: string, io: SetAsideIo): Promise<Seen[] | null> {
  const out: Seen[] = [];
  const visit = async (path: string, top: boolean): Promise<boolean> => {
    let info;
    try {
      info = await io.lstat(join(base, path), { bigint: true });
    } catch (error) {
      if (top && codeOf(error) === "ENOENT") return false;
      throw error;
    }
    const ino = info.ino.toString();
    if (info.isFile())
      out.push({
        path,
        type: "file",
        ino,
        size: info.size.toString(),
        mtimeNs: info.mtimeNs.toString(),
      });
    else if (info.isDirectory()) {
      out.push({ path, type: "folder", ino, size: null, mtimeNs: null });
      for (const child of await fs.readdir(join(base, path)))
        await visit(`${path}/${child}`, false);
    } else out.push({ path, type: "other", ino, size: null, mtimeNs: null });
    return true;
  };
  if (!(await visit(piece, true))) return null;
  return out.sort(byPath);
}

const recordedFor = (unit: StartAgainUnit, piece: string): Seen[] =>
  unit.entries
    .filter((entry) => entry.path === piece || entry.path.startsWith(`${piece}/`))
    .map((entry) => ({ ...entry }))
    .sort(byPath);

/** The latest Move record for the marker on the box, or null when there is no marker or no Move. Takes canonical roots. */
export async function recordedStartAgainMove(
  roots: Roots,
): Promise<(StartAgainChoiceRecord & { setAside: Destinations }) | null> {
  const marker = await readStartAgainMarker(roots.venueDir);
  if (marker === null) return null;
  const records = await readStartAgainChoices(roots.stateDir, marker);
  const record = records.filter((each) => each.choice === "move").at(-1);
  return record?.setAside ? { ...record, setAside: record.setAside } : null;
}

/**
 * D4 "After a cut", at every start before the finisher: with a marker and a Move record for it
 * (the latest), finishes that Move piece by piece into the folders the record names. A piece at
 * its source exactly as recorded, with nothing at its destination, is renamed; one gone from its
 * source and at its destination exactly as recorded is already moved; anything else stops,
 * moving nothing more. Removes nothing but empty probe folders.
 */
export async function resumeStartAgainSetAside(
  roots: Roots,
  io: SetAsideIo = defaultIo,
): Promise<"none" | "resumed" | "stopped"> {
  const canonical = await canonicalFirstSetupRoots(roots);
  const latestMove = () => recordedStartAgainMove(canonical);
  if ((await latestMove()) === null) return "none";
  const hold = await lockVenueDatabase(canonical.venueDir);
  try {
    const record = await latestMove();
    if (record === null) return "none";
    await removeLeftoverProbes(canonical, io);
    await raiseNoteToRecord(canonical.stateDir, record);
    const folders = await makeDestinationFolders(canonical, record, io);
    for (const unit of record.listed.units)
      for (const piece of unit.pieces) {
        const expected = JSON.stringify(recordedFor(unit, piece));
        let source: Seen[] | null;
        let destination: Seen[] | null;
        const label = `${unit.root}/${piece}`;
        try {
          await refuseUnrealParents(rootDir(canonical, unit.root), piece, label, io);
          await refuseUnrealParents(folders[unit.root], piece, label, io);
          source = await entriesAt(rootDir(canonical, unit.root), piece, io);
          destination = await entriesAt(folders[unit.root], piece, io);
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw failed(codeOf(error), label);
        }
        if (destination === null && JSON.stringify(source) === expected) {
          if ((await unrecordedSideFile(canonical, unit, piece, io)) !== null) return "stopped";
          await movePiece(canonical, folders, unit, piece, io);
        } else if (source === null && JSON.stringify(destination) === expected) continue;
        else return "stopped";
      }
    return "resumed";
  } finally {
    hold.release();
  }
}
