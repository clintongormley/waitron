import { AppError, isAppError } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import { lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { STORAGE_DRIVES_ROOT, STORAGE_DRIVE_NAME } from "../../../scripts/box/host-protocol.mjs";
import { parseBackupArchiveKey } from "./backup-keys.js";
import { askHost, type HostPlaces } from "./box-host-api.js";
import type { BoxHostRequests, StorageDrive } from "./box-host-client.js";
import { errnoOf } from "./errno.js";
import "./errors.js";
import { freeBytes as statFreeBytes } from "./free-bytes.js";
import type { Logger } from "./logger.js";
import {
  receiveSetupArchive,
  type ArchiveUpload,
  type ArchiveUploadOptions,
  type ReceiveArchive,
} from "./setup-archive-upload.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";

export const SETUP_DRIVE_LIST_BODY_MAX = 4096;
/** Above the largest form field setup's restore routes take (128 KiB). */
export const SETUP_DRIVE_BODY_MAX = 262144;
export const SWITCH_DRIVE_BODY_MAX = 1024 * 1024;

const FOLDERS_DEEP = 3;
const SYSTEM_FOLDERS = new Set(["System Volume Information", "LOST.DIR"]);
const UNREADABLE = new Set(["ENOENT", "EIO", "ENODEV", "ENXIO"]);

export type InvalidCode = "setup.request_invalid" | "handover.request_invalid";

export interface DriveBackupFile {
  readonly drive: string;
  readonly path: string;
  readonly size: number;
  readonly takenAt: string;
}

export interface DriveBackupList {
  readonly drives: readonly StorageDrive[];
  readonly files: readonly DriveBackupFile[];
}

/** The box's host and the places every host route shares; boot makes one of each. */
export interface DriveHost<Calls extends "storageList" | "storageRelease" = "storageList"> {
  requests: Pick<BoxHostRequests, Calls>;
  places: HostPlaces;
}

export interface ResolvedDriveFile {
  readonly path: string;
  readonly size: number;
  readonly takenAt: string;
}

export interface DriveFileOptions {
  root?: string;
  invalidCode?: InvalidCode;
}

export interface TakeDriveFileOptions extends DriveFileOptions {
  /** `<state>/scratch/restore`. */
  stagingDir: string;
  signal?: AbortSignal;
  freeBytes?: (dir: string) => Promise<number | null>;
}

export interface TakenDriveFile {
  artifactPath: string;
  byteLength: number;
  dispose(): Promise<void>;
}

function refuse(code: InvalidCode, field: string): AppError {
  return code === "handover.request_invalid"
    ? new AppError("handover.request_invalid", { field })
    : new AppError("setup.request_invalid", { field });
}

function capacity(): AppError {
  return new AppError("restore.archive_resource_limit", {});
}

function unreadable(): AppError {
  return new AppError("restore.drive_file_unreadable", {});
}

function skipped(name: string): boolean {
  return name.startsWith(".") || name.startsWith("$") || SYSTEM_FOLDERS.has(name);
}

async function entriesOf(dir: string, drive: string, log: Logger): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    log("warn", "drives.folder_unreadable", { drive, code: errnoOf(error) ?? "unexpected" });
    return [];
  }
}

/** Dirent types come from the folder listing itself, so a link is neither a file nor a folder. */
async function walk(
  drive: string,
  dir: string,
  relative: readonly string[],
  found: DriveBackupFile[],
  log: Logger,
): Promise<void> {
  for (const entry of await entriesOf(dir, drive, log)) {
    const segments = [...relative, entry.name];
    if (entry.isDirectory()) {
      if (relative.length < FOLDERS_DEEP && !skipped(entry.name))
        await walk(drive, join(dir, entry.name), segments, found, log);
      continue;
    }
    if (!entry.isFile()) continue;
    const parsed = parseBackupArchiveKey(entry.name);
    if (parsed === null) continue;
    try {
      const { size } = await lstat(join(dir, entry.name));
      found.push({
        drive,
        path: segments.join("/"),
        size,
        takenAt: parsed.timestamp.toISOString(),
      });
    } catch {
      continue;
    }
  }
}

/** The backup files on the readable drives the host listed, newest first by the stamp in their
 * names: a copy onto a stick carries the copy's time, never the backup's. */
export async function listDriveBackups(
  drives: readonly StorageDrive[],
  { root = STORAGE_DRIVES_ROOT, log }: { root?: string; log: Logger },
): Promise<DriveBackupList> {
  const found: DriveBackupFile[] = [];
  for (const { drive, readable } of drives) {
    if (readable && STORAGE_DRIVE_NAME.test(drive))
      await walk(drive, join(root, drive), [], found, log);
  }
  found.sort(
    (a, b) =>
      b.takenAt.localeCompare(a.takenAt) ||
      a.drive.localeCompare(b.drive) ||
      a.path.localeCompare(b.path),
  );
  return { drives, files: found };
}

/** Asks the host, as the server, to mount the drives, then lists their backup files. */
export async function listHostDriveBackups(
  host: DriveHost,
  options: { root?: string; log: Logger },
): Promise<DriveBackupList> {
  const { drives } = await askHost(
    host.places,
    () => host.requests.storageList({ source: "server" }),
    { busy: "box_host.busy" },
  );
  return listDriveBackups(drives, options);
}

function checkedName(file: unknown, code: InvalidCode): { drive: string; segments: string[] } {
  if (typeof file !== "object" || file === null || Array.isArray(file)) throw refuse(code, "file");
  const keys = Object.keys(file);
  if (keys.length !== 2 || !keys.includes("drive") || !keys.includes("path"))
    throw refuse(code, "file");
  const { drive, path } = file as Record<string, unknown>;
  if (typeof drive !== "string" || !STORAGE_DRIVE_NAME.test(drive)) throw refuse(code, "file");
  if (typeof path !== "string") throw refuse(code, "file");
  const segments = path.split("/");
  if (
    segments.length > FOLDERS_DEEP + 1 ||
    segments.some((segment) => segment === "" || segment.startsWith(".")) ||
    parseBackupArchiveKey(segments.at(-1)!) === null
  )
    throw refuse(code, "file");
  return { drive, segments };
}

/** A file named `{drive, path}` that lies in that drive's folder, through no link anywhere below
 * the drives folder. The drives folder itself may be reached through a link (on a Mac `/var` is
 * `/private/var`), so both sides are compared resolved. */
export async function resolveDriveFile(
  file: unknown,
  { root = STORAGE_DRIVES_ROOT, invalidCode = "setup.request_invalid" }: DriveFileOptions = {},
): Promise<ResolvedDriveFile> {
  const { drive, segments } = checkedName(file, invalidCode);
  const path = join(root, drive, ...segments);
  try {
    const real = await realpath(path);
    if (real !== join(await realpath(root), drive, ...segments)) throw refuse(invalidCode, "file");
    const found = await lstat(real);
    if (!found.isFile()) throw refuse(invalidCode, "file");
    const takenAt = parseBackupArchiveKey(segments.at(-1)!)!.timestamp.toISOString();
    return { path, size: found.size, takenAt };
  } catch (error) {
    if (isAppError(error)) throw error;
    if (UNREADABLE.has(errnoOf(error) ?? "")) throw unreadable();
    throw error;
  }
}

/** A copy of the drive file in its own `drive-<uuid>` folder under `stagingDir`, so the stick can
 * be pulled; the free space must hold the file and the start's floor before anything is copied. */
export async function takeDriveFile(
  file: unknown,
  options: TakeDriveFileOptions,
): Promise<TakenDriveFile> {
  const source = await resolveDriveFile(file, options);
  const free = options.freeBytes ?? statFreeBytes;
  let dir: string | undefined;
  try {
    await mkdir(options.stagingDir, { recursive: true, mode: 0o700 });
    const available = await free(options.stagingDir);
    if (available === null || available - START_FREE_SPACE_FLOOR < source.size) throw capacity();
    dir = join(options.stagingDir, `drive-${randomUUID()}`);
    await mkdir(dir, { mode: 0o700 });
    const artifactPath = join(dir, "archive");
    await pipeline(
      createReadStream(source.path),
      createWriteStream(artifactPath, { flags: "wx", mode: 0o600 }),
      { signal: options.signal },
    );
    const copied = dir;
    return {
      artifactPath,
      byteLength: (await stat(artifactPath)).size,
      dispose: () => rm(copied, { recursive: true, force: true }),
    };
  } catch (error) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    if (isAppError(error) || options.signal?.aborted) throw error;
    const code = errnoOf(error) ?? "";
    if (code === "ENOSPC" || code === "EDQUOT") throw capacity();
    if (UNREADABLE.has(code)) throw unreadable();
    throw error;
  }
}

/** A JSON body read up to `limitBytes`, refused before it is parsed when longer. */
export async function readDriveJson(
  request: Request,
  limitBytes: number,
  invalidCode: InvalidCode = "setup.request_invalid",
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limitBytes) {
    await request.body?.cancel().catch(() => {});
    throw refuse(invalidCode, "body");
  }
  const reader = request.body?.getReader();
  if (reader === undefined) throw refuse(invalidCode, "body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limitBytes) {
        await reader.cancel().catch(() => {});
        throw refuse(invalidCode, "body");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw refuse(invalidCode, "body");
  }
}

export interface DriveArchiveDeps {
  stagingDir: string;
  limitBytes: number;
  root?: string;
  freeBytes?: (dir: string) => Promise<number | null>;
}

/** A setup route's JSON body, answered as an upload would be: `file` becomes `artifactPath` and
 * each other named key a field, an object as its JSON text. No byte limit applies to the file. */
export async function receiveDriveArchive(
  request: Request,
  options: ArchiveUploadOptions,
  deps: DriveArchiveDeps,
): Promise<ArchiveUpload> {
  const body = await readDriveJson(request, deps.limitBytes);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw refuse("setup.request_invalid", "body");
  const record = body as Record<string, unknown>;
  if (!Object.hasOwn(record, "file")) throw refuse("setup.request_invalid", "file");
  const fields = new Map<string, string>();
  for (const [name, value] of Object.entries(record)) {
    if (name === "file") continue;
    if (!options.fields?.includes(name)) {
      if (options.exactFields) throw refuse("setup.request_invalid", "body");
      continue;
    }
    if (typeof value === "string") fields.set(name, value);
    else if (typeof value === "object" && value !== null) fields.set(name, JSON.stringify(value));
    else throw refuse("setup.request_invalid", name);
  }
  if (options.moves) {
    const taken = await takeDriveFile(record.file, {
      stagingDir: deps.stagingDir,
      root: deps.root,
      freeBytes: deps.freeBytes,
      signal: request.signal,
    });
    return { ...taken, fields };
  }
  const resolved = await resolveDriveFile(record.file, { root: deps.root });
  return {
    artifactPath: resolved.path,
    byteLength: resolved.size,
    fields,
    dispose: async () => {},
  };
}

/** Setup's receiver: a JSON body names a file on a drive, and anything else is an upload. */
export function receiveRestoreArchive(stagingDir: string, root?: string): ReceiveArchive {
  return (request, options = {}) =>
    request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
      ? receiveDriveArchive(request, options, {
          stagingDir,
          limitBytes: SETUP_DRIVE_BODY_MAX,
          root,
        })
      : receiveSetupArchive(request, stagingDir, options);
}

/** Never throws: a drive left mounted read-only harms nothing, and the next list clears it. */
export async function releaseDrives(deps: {
  host: Pick<BoxHostRequests, "storageRelease">;
  places: HostPlaces;
  log: Logger;
}): Promise<void> {
  try {
    const { released } = await askHost(
      deps.places,
      () => deps.host.storageRelease({ source: "server" }),
      { busy: "box_host.busy" },
    );
    deps.log("info", "drives.released", { released });
  } catch (error) {
    deps.log(
      "warn",
      "drives.release_failed",
      isAppError(error) ? { code: error.code, ...error.params } : { code: "unexpected" },
    );
  }
}
