import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { lockVenueDatabase } from "@waitron/db";
import { AppError, isUuid } from "@waitron/shared";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import { canonicalFirstSetupRoots } from "./first-setup-resolution.js";
import { insideFirstSetupWorkspace } from "./first-setup-workspace.js";
import {
  createFirstSetupBackupWorkspace,
  insideBackupRepairTarget,
} from "./first-setup-backup-workspace.js";
import { isEmptiedTombstone } from "./first-setup-backup-discard.js";
import { removeAndSync } from "./folder-sync.js";
import "./errors.js";

export const START_AGAIN_MARKER_FILE = "first-setup-deleting.json";
export const START_AGAIN_MARKER_LIMIT = 1024 * 1024;
const MARKER_LIMIT = START_AGAIN_MARKER_LIMIT;
const HASH = /^[a-f0-9]{64}$/;
const RECORDS = "first-setup-resolutions";
const BACKUP = "backup-recovery";
const POINTER = "current.json";
const LEGACY = [
  "first-setup-workspaces",
  "first-setup-selection.json",
  "first-setup-retirement.json",
  "first-setup-workspace.json",
] as const;
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
/** `discarding`: the id of the backup recovery this Start again is about to discard. */
type Options = { discarding?: string };
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

/** `reason` is log-only: a check's name and a path, never a file's contents. */
const incomplete = (reason: string) => new AppError("setup.start_again_incomplete", {}, { reason });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const codeOf = (error: unknown) =>
  object(error) && error.code !== undefined ? String(error.code) : "unknown";
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const missing = (error: unknown) => object(error) && error.code === "ENOENT";
const pathOf = (error: unknown) =>
  object(error) && typeof error.path === "string" ? error.path : undefined;
const checkFailed = (error: unknown) =>
  incomplete(
    `check failed: ${codeOf(error)}${pathOf(error) === undefined ? "" : ` ${pathOf(error)}`}`,
  );
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
    throw incomplete("marker damaged");
  return { size: value.size as number, sha256: value.sha256 };
}

function parseMarker(value: unknown): StartAgainMarker {
  const keys = ["version", "attemptId", "frozenDigest", "venueDir", "stateDir", "files", "wal"];
  if (!object(value) || !exactKeys(value, keys)) throw incomplete("marker damaged");
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
    throw incomplete("marker damaged");
  const seen = new Set<string>();
  const parsed = files.map((entry: unknown): StartAgainMarkedFile => {
    if (!object(entry) || !exactKeys(entry, ["root", "name", "size", "sha256"]))
      throw incomplete("marker damaged");
    const { root, name } = entry;
    if (
      (root !== "venue" && root !== "state") ||
      typeof name !== "string" ||
      !listed(root, name) ||
      seen.has(`${root}:${name}`)
    )
      throw incomplete("marker damaged");
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

async function info(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
const present = async (path: string) => (await info(path)) !== null;
const same = (a: StartAgainFingerprint | null, b: StartAgainFingerprint) =>
  a !== null && a.size === b.size && a.sha256 === b.sha256;

type Item =
  | { kind: "file"; root: Root; name: string; path: string }
  | { kind: "side"; path: string }
  | { kind: "folder"; path: string };

async function entries(path: string): Promise<{ name: string; folder: boolean }[] | null> {
  const folder = await info(path);
  if (folder === null) return null;
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw incomplete(`layout unexpected: ${path}`);
  const names = (await readdir(path)).sort();
  const result: { name: string; folder: boolean }[] = [];
  for (const name of names) {
    const entry = await lstat(join(path, name));
    if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory()))
      throw incomplete(`layout unexpected: ${join(path, name)}`);
    result.push({ name, folder: entry.isDirectory() });
  }
  return result;
}

/**
 * Whether the state folder's backup recovery folder may stay: its pointer names either an
 * abandoned journal, with every recovery folder an emptied tombstone, or the recovery being
 * discarded, with every other recovery folder an emptied tombstone. The journal is read by its
 * chain only, since the attempt it was taken against may have changed since.
 */
async function backupRecoveryKept(roots: Roots, { discarding }: Options): Promise<boolean> {
  try {
    const found = await entries(join(roots.stateDir, RECORDS, BACKUP));
    if (found === null || !found.some((entry) => entry.name === POINTER && !entry.folder))
      return false;
    const last = (await createFirstSetupBackupWorkspace(roots).readChain()).at(-1);
    if (last === undefined) return false;
    if (
      discarding === undefined ? last.phase !== "abandoned" : last.target.recoveryId !== discarding
    )
      return false;
    for (const { name } of found)
      if (name !== POINTER && name !== discarding && !(await isEmptiedTombstone(roots, name)))
        return false;
    return true;
  } catch (error) {
    if (error instanceof AppError) return false;
    throw error;
  }
}

/** With `discarding`, the venue folder may hold the pointer of the recovery being discarded. */
async function venuePointerOnly(roots: Roots, { discarding }: Options): Promise<boolean> {
  if (discarding === undefined) return false;
  try {
    const records = (await entries(join(roots.venueDir, RECORDS)))!;
    const backup = (await entries(join(roots.venueDir, RECORDS, BACKUP)))!;
    return (
      records.length === 1 &&
      records[0]!.name === BACKUP &&
      backup.length === 1 &&
      backup[0]!.name === POINTER &&
      !backup[0]!.folder
    );
  } catch {
    return false;
  }
}

/** Every item of D3's deletion list present on disk, in its deletion order. */
async function itemsOnDisk(roots: Roots, options: Options = {}): Promise<Item[]> {
  const items: Item[] = [];
  const file = async (root: Root, name: string) => {
    const path = join(root === "venue" ? roots.venueDir : roots.stateDir, name);
    const found = await info(path);
    if (found === null) return;
    if (!found.isFile() || found.isSymbolicLink()) throw incomplete(`layout unexpected: ${path}`);
    items.push({ kind: "file", root, name, path });
  };
  const filesIn = async (relative: string, allowFolders: boolean) => {
    const found = await entries(join(roots.stateDir, relative));
    if (found === null) return null;
    for (const entry of found) {
      if (entry.folder) {
        if (!allowFolders) throw incomplete(`layout unexpected: ${relative}/${entry.name}`);
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
  const kept = await backupRecoveryKept(roots, options);
  if (options.discarding !== undefined && !kept)
    throw incomplete(`layout unexpected: ${RECORDS}/${BACKUP}`);
  const records = await entries(join(roots.stateDir, RECORDS));
  if (records !== null) {
    for (const record of records) {
      if (kept && record.name === BACKUP) continue;
      if (!record.folder || !isUuid(record.name))
        throw incomplete(`layout unexpected: ${RECORDS}/${record.name}`);
      const relative = `${RECORDS}/${record.name}`;
      const inside = (await entries(join(roots.stateDir, relative)))!;
      for (const step of inside.filter((entry) => entry.folder)) {
        if (!STEP.test(step.name)) throw incomplete(`layout unexpected: ${relative}/${step.name}`);
        await filesIn(`${relative}/${step.name}`, false);
        items.push({ kind: "folder", path: join(roots.stateDir, relative, step.name) });
      }
      await filesIn(relative, true);
      items.push({ kind: "folder", path: join(roots.stateDir, relative) });
    }
    if (!kept) items.push({ kind: "folder", path: join(roots.stateDir, RECORDS) });
  }
  await file("venue", "first-setup-claim.json");
  await file("state", "first-setup.json");
  return items;
}

async function sha256(path: string): Promise<StartAgainFingerprint> {
  const bytes = await readFile(path);
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Names every present file of the deletion list with its size and SHA-256. */
export async function startAgainMarkerFor(
  roots: Roots,
  attempt: { attemptId: string; frozenDigest: string },
  options: Options = {},
): Promise<StartAgainMarker> {
  const canonical = await canonicalFirstSetupRoots(roots);
  const items = await itemsOnDisk(canonical, options).catch((error: unknown) => {
    throw error instanceof AppError ? error : checkFailed(error);
  });
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
    throw incomplete("marker unreadable");
  }
  return value === null ? null : parseMarker(value);
}

export async function assertNoStartAgainDeletion(venueDir: string): Promise<void> {
  if (await present(join(venueDir, START_AGAIN_MARKER_FILE)).catch(() => true))
    throw incomplete("a Start again deletion is pending");
}

export async function writeStartAgainMarker(roots: Roots, marker: StartAgainMarker): Promise<void> {
  if (markerSize(marker) > MARKER_LIMIT) throw new AppError("setup.not_ready", {});
  const value = parseMarker(marker);
  const canonical = await canonicalFirstSetupRoots(roots);
  if (value.venueDir !== canonical.venueDir || value.stateDir !== canonical.stateDir)
    throw incomplete("marker folders differ");
  await assertNoStartAgainDeletion(canonical.venueDir);
  await writeDurableHostJson(
    join(canonical.venueDir, START_AGAIN_MARKER_FILE),
    value,
    MARKER_LIMIT,
  );
}

export async function clearStartAgainMarker(venueDir: string): Promise<void> {
  try {
    await removeAndSync(join(venueDir, START_AGAIN_MARKER_FILE), "file");
  } catch (error) {
    throw incomplete(`clear failed: ${codeOf(error)} ${pathOf(error) ?? venueDir}`);
  }
}

/** D3's refusals that the folders alone can answer; returns the canonical folders. */
export async function assertStartAgainAllowedOnDisk(
  roots: Roots,
  options: Options = {},
): Promise<Roots> {
  const notReady = (reason: string) => new AppError("setup.not_ready", {}, { reason });
  const canonical = await canonicalFirstSetupRoots(roots);
  const rootOf = (root: Root) => (root === "venue" ? canonical.venueDir : canonical.stateDir);
  const exists = async (path: string) => {
    try {
      return await present(path);
    } catch (error) {
      throw notReady(`check failed: ${codeOf(error)} ${path}`);
    }
  };
  if (Object.values(canonical).some(insideFirstSetupWorkspace))
    throw new AppError("setup.workspace_unsupported", {}, { reason: "folder in a workspace" });
  for (const root of ["state", "venue"] as const)
    for (const name of LEGACY)
      if (await exists(join(rootOf(root), name)))
        throw new AppError(
          "setup.workspace_unsupported",
          {},
          { reason: `earlier layout: ${root}/${name}` },
        );
  if (Object.values(canonical).some(insideBackupRepairTarget))
    throw notReady("folder in a backup recovery target");
  for (const root of ["state", "venue"] as const)
    for (const name of REFUSED[root])
      if (
        (await exists(join(rootOf(root), name))) &&
        !(root === "venue" && name === RECORDS && (await venuePointerOnly(canonical, options)))
      )
        throw notReady(`refused artifact: ${root}/${name}`);
  await assertNoStartAgainDeletion(canonical.venueDir);
  try {
    await itemsOnDisk(canonical, options);
  } catch (error) {
    if (error instanceof AppError) throw notReady(error.reason ?? error.code);
    throw notReady(`check failed: ${codeOf(error)} ${pathOf(error) ?? ""}`);
  }
  const node = join(canonical.venueDir, "node.db");
  if (await exists(node)) {
    // An immutable open leaves no side files behind, but reads only the main file, so a -wal
    // that may hold pages is refused rather than read past.
    const wal = await info(`${node}-wal`).catch((error: unknown) => {
      throw notReady(`check failed: ${codeOf(error)} ${node}-wal`);
    });
    if (wal !== null && wal.size !== 0) throw notReady("node.db-wal holds pages");
    const url = pathToFileURL(node);
    url.searchParams.set("mode", "ro");
    url.searchParams.set("immutable", "1");
    let tables: unknown[];
    try {
      const connection = new DatabaseSync(url, { readOnly: true });
      try {
        tables = connection
          .prepare("select name from sqlite_schema where name not like 'sqlite\\_%' escape '\\'")
          .all();
      } finally {
        connection.close();
      }
    } catch {
      throw notReady("node.db unreadable");
    }
    if (tables.length !== 0) throw notReady("node.db holds a table");
  }
  return canonical;
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
  const canonical = await canonicalFirstSetupRoots(roots);
  if (value.venueDir !== canonical.venueDir || value.stateDir !== canonical.stateDir)
    throw incomplete("marker folders differ");
  const named = new Set(value.files.map((entry) => `${entry.root}:${entry.name}`));
  let current = "";
  try {
    for (const item of await itemsOnDisk(canonical)) {
      current = item.path;
      if (item.kind === "folder") await remove(item.path, "folder");
      else if (item.kind === "side" || named.has(`${item.root}:${item.name}`))
        await remove(item.path, "file");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw incomplete(`deletion failed: ${codeOf(error)} ${pathOf(error) ?? current}`);
  }
}

/** Run at the start: finishes an interrupted Start again deletion, or refuses and deletes nothing. */
export async function finishStartAgainDeletion(roots: Roots): Promise<void> {
  const canonical = await canonicalFirstSetupRoots(roots);
  if ((await readStartAgainMarker(canonical.venueDir)) === null) return;
  const hold = await lockVenueDatabase(canonical.venueDir);
  try {
    const marker = await readStartAgainMarker(canonical.venueDir);
    if (marker === null) return;
    if (marker.venueDir !== canonical.venueDir || marker.stateDir !== canonical.stateDir)
      throw incomplete("marker folders differ");
    for (const root of ["state", "venue"] as const)
      for (const name of REFUSED[root])
        if (await present(join(root === "venue" ? canonical.venueDir : canonical.stateDir, name)))
          throw incomplete(`refused artifact present: ${root}/${name}`);
    const recorded = new Map(marker.files.map((entry) => [`${entry.root}:${entry.name}`, entry]));
    for (const item of await itemsOnDisk(canonical)) {
      if (item.kind !== "file") continue;
      const expected = recorded.get(`${item.root}:${item.name}`);
      if (expected === undefined) throw incomplete(`unlisted file: ${item.root}/${item.name}`);
      if (!same(expected, await sha256(item.path)))
        throw incomplete(`size or hash differs: ${item.root}/${item.name}`);
    }
    for (const name of WAL_FILES) {
      const path = join(canonical.venueDir, name);
      if (!(await present(path))) continue;
      const actual = await sha256(path);
      if (actual.size !== 0 && !same(marker.wal[name], actual))
        throw incomplete(`unexpected -wal: venue/${name}`);
    }
    await deleteMarkedAttempt(canonical, marker);
    await removeAndSync(join(canonical.venueDir, START_AGAIN_MARKER_FILE), "file");
  } catch (error) {
    throw error instanceof AppError ? error : checkFailed(error);
  } finally {
    hold.release();
  }
}
