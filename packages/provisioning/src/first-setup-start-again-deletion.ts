import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { AppError, isUuid } from "@waitron/shared";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import { canonicalFirstSetupDirectory } from "./first-setup-resolution.js";
import "./errors.js";

export const START_AGAIN_MARKER_FILE = "first-setup-deleting.json";
const MARKER_LIMIT = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const RECORDS = "first-setup-resolutions";
const DOCUMENTS = "first-fiscal-documents";
const STEP = /^step-\d{6}$/;
const WAL_FILES = ["venue.db-wal", "node.db-wal"] as const;
const SIDE_FILES = ["venue.db-wal", "venue.db-shm", "node.db-wal", "node.db-shm"] as const;
const REFUSED = {
  state: [
    "trading.env",
    "setup-operation.json",
    "restore-request.json",
    "reset-request.json",
    "modules.json",
    "cloud-replacement.json",
    "first-setup-workspaces",
    "first-setup-selection.json",
    "first-setup-retirement.json",
    "first-setup-workspace.json",
  ],
  venue: [
    ".venue.db-litestream",
    RECORDS,
    "first-setup-workspaces",
    "first-setup-selection.json",
    "first-setup-retirement.json",
    "first-setup-workspace.json",
  ],
} as const;

type Root = "venue" | "state";
type Roots = { stateDir: string; venueDir: string };
export interface StartAgainFingerprint {
  size: number;
  sha256: string;
}
export interface StartAgainMarkedFile extends StartAgainFingerprint {
  root: Root;
  name: string;
}
export interface StartAgainMarker {
  version: 1;
  attemptId: string;
  frozenDigest: string;
  venueDir: string;
  stateDir: string;
  files: StartAgainMarkedFile[];
  wal: Record<(typeof WAL_FILES)[number], StartAgainFingerprint | null>;
}

const incomplete = () => new AppError("setup.start_again_incomplete", {});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const missing = (error: unknown) => object(error) && error.code === "ENOENT";
const entryName = (name: string) =>
  name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0");

/** Only the deletion list's own names; the note, the confirmation folder and `tls/` are not among them. */
function listed(root: Root, name: string): boolean {
  const parts = name.split("/");
  if (!parts.every(entryName)) return false;
  if (root === "venue")
    return parts.length === 1 && ["venue.db", "node.db", "first-setup-claim.json"].includes(name);
  if (parts.length === 1)
    return [
      "module-preparation-state.json",
      "first-setup-node-key.json",
      "module-operation-public.json",
      "first-setup.json",
    ].includes(name);
  if (parts[0] === DOCUMENTS) return parts.length === 2;
  return (
    parts[0] === RECORDS &&
    isUuid(parts[1]!) &&
    (parts.length === 3 || (parts.length === 4 && STEP.test(parts[2]!)))
  );
}

function fingerprint(value: unknown): StartAgainFingerprint {
  if (
    !object(value) ||
    !exactKeys(value, ["size", "sha256"]) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    typeof value.sha256 !== "string" ||
    !HASH.test(value.sha256)
  )
    throw incomplete();
  return { size: value.size as number, sha256: value.sha256 };
}

function parseMarker(value: unknown): StartAgainMarker {
  const keys = ["version", "attemptId", "frozenDigest", "venueDir", "stateDir", "files", "wal"];
  if (!object(value) || !exactKeys(value, keys)) throw incomplete();
  const { version, attemptId, frozenDigest, venueDir, stateDir, files, wal } = value;
  if (
    version !== 1 ||
    typeof attemptId !== "string" ||
    !isUuid(attemptId) ||
    typeof frozenDigest !== "string" ||
    !HASH.test(frozenDigest) ||
    typeof venueDir !== "string" ||
    !venueDir.startsWith("/") ||
    typeof stateDir !== "string" ||
    !stateDir.startsWith("/") ||
    !Array.isArray(files) ||
    !object(wal) ||
    !exactKeys(wal, WAL_FILES)
  )
    throw incomplete();
  const seen = new Set<string>();
  const parsed = files.map((entry: unknown): StartAgainMarkedFile => {
    if (!object(entry) || !exactKeys(entry, ["root", "name", "size", "sha256"])) throw incomplete();
    const { root, name } = entry;
    if (
      (root !== "venue" && root !== "state") ||
      typeof name !== "string" ||
      !listed(root, name) ||
      seen.has(`${root}:${name}`)
    )
      throw incomplete();
    seen.add(`${root}:${name}`);
    return { root, name, ...fingerprint({ size: entry.size, sha256: entry.sha256 }) };
  });
  return {
    version: 1,
    attemptId,
    frozenDigest,
    venueDir,
    stateDir,
    files: parsed,
    wal: {
      "venue.db-wal": wal["venue.db-wal"] === null ? null : fingerprint(wal["venue.db-wal"]),
      "node.db-wal": wal["node.db-wal"] === null ? null : fingerprint(wal["node.db-wal"]),
    },
  };
}

export function markerSize(marker: StartAgainMarker): number {
  return Buffer.byteLength(JSON.stringify(marker));
}

async function canonicalRoots(roots: Roots): Promise<Roots> {
  return {
    stateDir: await canonicalFirstSetupDirectory(roots.stateDir),
    venueDir: await canonicalFirstSetupDirectory(roots.venueDir),
  };
}

async function info(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
const present = async (path: string) => (await info(path)) !== null;
const same = (a: StartAgainFingerprint | null | undefined, b: StartAgainFingerprint) =>
  a !== null && a !== undefined && a.size === b.size && a.sha256 === b.sha256;

type Item =
  | { kind: "file"; root: Root; name: string; path: string }
  | { kind: "side"; path: string }
  | { kind: "folder"; path: string };

async function entries(path: string): Promise<{ name: string; folder: boolean }[] | null> {
  const folder = await info(path);
  if (folder === null) return null;
  if (!folder.isDirectory() || folder.isSymbolicLink()) throw incomplete();
  const names = (await readdir(path)).sort();
  const result: { name: string; folder: boolean }[] = [];
  for (const name of names) {
    const entry = await lstat(join(path, name));
    if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) throw incomplete();
    result.push({ name, folder: entry.isDirectory() });
  }
  return result;
}

/** Every item of D3's deletion list present on disk, in its deletion order. */
async function itemsOnDisk(roots: Roots): Promise<Item[]> {
  const items: Item[] = [];
  const file = async (root: Root, name: string) => {
    const path = join(root === "venue" ? roots.venueDir : roots.stateDir, name);
    const found = await info(path);
    if (found === null) return;
    if (!found.isFile() || found.isSymbolicLink()) throw incomplete();
    items.push({ kind: "file", root, name, path });
  };
  const filesIn = async (relative: string, allowFolders: boolean) => {
    const found = await entries(join(roots.stateDir, relative));
    if (found === null) return null;
    for (const entry of found) {
      if (entry.folder) {
        if (!allowFolders) throw incomplete();
      } else await file("state", `${relative}/${entry.name}`);
    }
    return found;
  };
  await file("venue", "venue.db");
  await file("venue", "node.db");
  for (const name of SIDE_FILES) {
    const path = join(roots.venueDir, name);
    if (await present(path)) items.push({ kind: "side", path });
  }
  await file("state", "module-preparation-state.json");
  if ((await filesIn(DOCUMENTS, false)) !== null)
    items.push({ kind: "folder", path: join(roots.stateDir, DOCUMENTS) });
  await file("state", "first-setup-node-key.json");
  await file("state", "module-operation-public.json");
  const records = await entries(join(roots.stateDir, RECORDS));
  if (records !== null) {
    for (const record of records) {
      if (!record.folder || !isUuid(record.name)) throw incomplete();
      const relative = `${RECORDS}/${record.name}`;
      const inside = (await entries(join(roots.stateDir, relative)))!;
      for (const step of inside.filter((entry) => entry.folder)) {
        if (!STEP.test(step.name)) throw incomplete();
        await filesIn(`${relative}/${step.name}`, false);
        items.push({ kind: "folder", path: join(roots.stateDir, relative, step.name) });
      }
      await filesIn(relative, true);
      items.push({ kind: "folder", path: join(roots.stateDir, relative) });
    }
    items.push({ kind: "folder", path: join(roots.stateDir, RECORDS) });
  }
  await file("venue", "first-setup-claim.json");
  await file("state", "first-setup.json");
  return items;
}

async function sha256(path: string): Promise<StartAgainFingerprint> {
  const bytes = await readFile(path);
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function syncFolder(path: string): Promise<void> {
  const folder = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

async function removeAndSync(path: string, kind: "file" | "folder"): Promise<void> {
  if (kind === "file") await unlink(path);
  else await rmdir(path);
  await syncFolder(dirname(path));
}

/** Names every present file of the deletion list with its size and SHA-256. */
export async function startAgainMarkerFor(
  roots: Roots,
  attempt: { attemptId: string; frozenDigest: string },
): Promise<StartAgainMarker> {
  const canonical = await canonicalRoots(roots);
  const items = await itemsOnDisk(canonical);
  const files: StartAgainMarkedFile[] = [];
  for (const item of items)
    if (item.kind === "file")
      files.push({ root: item.root, name: item.name, ...(await sha256(item.path)) });
  const wal = async (name: string) => {
    const path = join(canonical.venueDir, name);
    return (await present(path)) ? sha256(path) : null;
  };
  return parseMarker({
    version: 1,
    ...attempt,
    ...canonical,
    files,
    wal: { "venue.db-wal": await wal("venue.db-wal"), "node.db-wal": await wal("node.db-wal") },
  });
}

export async function readStartAgainMarker(venueDir: string): Promise<StartAgainMarker | null> {
  let value: unknown;
  try {
    value = await readDurableHostJson(join(venueDir, START_AGAIN_MARKER_FILE), MARKER_LIMIT);
  } catch {
    throw incomplete();
  }
  return value === null ? null : parseMarker(value);
}

export async function assertNoStartAgainDeletion(venueDir: string): Promise<void> {
  if (await present(join(venueDir, START_AGAIN_MARKER_FILE)).catch(() => true)) throw incomplete();
}

export async function writeStartAgainMarker(roots: Roots, marker: StartAgainMarker): Promise<void> {
  if (markerSize(marker) > MARKER_LIMIT) throw new AppError("setup.not_ready", {});
  const value = parseMarker(marker);
  const canonical = await canonicalRoots(roots);
  if (value.venueDir !== canonical.venueDir || value.stateDir !== canonical.stateDir)
    throw incomplete();
  await assertNoStartAgainDeletion(canonical.venueDir);
  await writeDurableHostJson(
    join(canonical.venueDir, START_AGAIN_MARKER_FILE),
    value,
    MARKER_LIMIT,
  );
}

/**
 * Deletes only the marked files and the side files beside the databases; a folder goes by
 * `rmdir`, so a file the marker does not name stops its folder's removal and stays.
 */
export async function deleteMarkedAttempt(
  roots: Roots,
  marker: StartAgainMarker,
  remove: (path: string, kind: "file" | "folder") => Promise<void> = removeAndSync,
): Promise<void> {
  const value = parseMarker(marker);
  const canonical = await canonicalRoots(roots);
  if (value.venueDir !== canonical.venueDir || value.stateDir !== canonical.stateDir)
    throw incomplete();
  const named = new Set(value.files.map((entry) => `${entry.root}:${entry.name}`));
  try {
    for (const item of await itemsOnDisk(canonical)) {
      if (item.kind === "folder") await remove(item.path, "folder");
      else if (item.kind === "side" || named.has(`${item.root}:${item.name}`))
        await remove(item.path, "file");
    }
  } catch {
    throw incomplete();
  }
}

/** Run at the start: finishes an interrupted Start again deletion, or refuses and deletes nothing. */
export async function finishStartAgainDeletion(roots: Roots): Promise<void> {
  const canonical = await canonicalRoots(roots);
  if ((await readStartAgainMarker(canonical.venueDir)) === null) return;
  const hold = await lockVenueDatabase(canonical.venueDir);
  try {
    const marker = await readStartAgainMarker(canonical.venueDir);
    if (marker === null) return;
    if (marker.venueDir !== canonical.venueDir || marker.stateDir !== canonical.stateDir)
      throw incomplete();
    for (const root of ["state", "venue"] as const)
      for (const name of REFUSED[root])
        if (await present(join(root === "venue" ? canonical.venueDir : canonical.stateDir, name)))
          throw incomplete();
    const recorded = new Map(marker.files.map((entry) => [`${entry.root}:${entry.name}`, entry]));
    for (const item of await itemsOnDisk(canonical))
      if (
        item.kind === "file" &&
        !same(recorded.get(`${item.root}:${item.name}`), await sha256(item.path))
      )
        throw incomplete();
    for (const name of WAL_FILES) {
      const path = join(canonical.venueDir, name);
      if (!(await present(path))) continue;
      const actual = await sha256(path);
      if (actual.size !== 0 && !same(marker.wal[name], actual)) throw incomplete();
    }
    await deleteMarkedAttempt(canonical, marker);
    await removeAndSync(join(canonical.venueDir, START_AGAIN_MARKER_FILE), "file");
  } catch (error) {
    throw error instanceof AppError ? error : incomplete();
  } finally {
    hold.release();
  }
}
