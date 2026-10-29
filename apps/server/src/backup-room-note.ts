import { randomBytes } from "node:crypto";
import { lstat, readFile, rename as renameFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import {
  BACKUP_ROOM_NOTE_FILE,
  backupRoomNoteTemporaryName,
  deleteBackupRoomNote,
} from "@waitron/provisioning";
import type { BackupFolder } from "./backup-room.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

/**
 * Lets the start delete old backups without opening the venue database: it trusts the
 * installation start only while venue.db's device number, file number and birth time still match
 * the note's.
 */
export interface BackupRoomNote {
  version: 1;
  nodeId: string;
  installationStartedAt: string;
  venueDb: VenueDbIdentity;
  managedByEnvironment: boolean;
  folders: BackupRoomNoteFolder[];
  writtenAt: string;
}

/**
 * `configuredDir` is the path backups are configured to write to, as given; `dir` is where it led
 * when the note was written. The start uses a folder only while the one still leads to the other.
 */
export interface BackupRoomNoteFolder extends BackupFolder {
  configuredDir: string;
}

/** Decimal strings: the numbers can exceed what a JSON number holds exactly. */
export interface VenueDbIdentity {
  dev: string;
  ino: string;
  birthtimeNs: string;
}

export type BackupRoomNoteSkip =
  | "missing"
  | "unreadable"
  | "malformed"
  | "node_mismatch"
  | "venue_db_missing"
  | "venue_db_unreadable"
  | "identity_mismatch";

export { deleteBackupRoomNote };

type Rename = (from: string, to: string) => Promise<void>;

const notePath = (stateDir: string) => join(stateDir, BACKUP_ROOM_NOTE_FILE);

const MAX_NOTE_BYTES = 64 * 1024;

export async function venueDbIdentity(venueDir: string): Promise<VenueDbIdentity> {
  const info = await lstat(join(venueDir, "venue.db"), { bigint: true });
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
}

/**
 * Replaces the note with one naming the current `venue.db`. With `venue.db` missing, or on any
 * failure, the note is deleted where it can be. Nothing is thrown.
 */
export async function writeBackupRoomNote(options: {
  stateDir: string;
  venueDir: string;
  nodeId: string;
  installationStartedAt: Date;
  managedByEnvironment: boolean;
  folders: readonly BackupRoomNoteFolder[];
  now: () => Date;
  log: Logger;
  rename?: Rename;
}): Promise<void> {
  const { stateDir, log, rename = renameFile } = options;
  const temporary = join(stateDir, backupRoomNoteTemporaryName(randomBytes(6).toString("hex")));
  try {
    let venueDb: VenueDbIdentity;
    try {
      venueDb = await venueDbIdentity(options.venueDir);
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") throw error;
      await deleteBackupRoomNote(stateDir);
      return;
    }
    const note: BackupRoomNote = {
      version: 1,
      nodeId: options.nodeId,
      installationStartedAt: options.installationStartedAt.toISOString(),
      venueDb,
      managedByEnvironment: options.managedByEnvironment,
      folders: options.folders.map(({ destination, dir, configuredDir }) => ({
        destination,
        dir,
        configuredDir,
      })),
      writtenAt: options.now().toISOString(),
    };
    await writeFile(temporary, JSON.stringify(note), { mode: 0o600, flag: "wx" });
    await rename(temporary, notePath(stateDir));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await deleteBackupRoomNote(stateDir).catch(() => undefined);
    log("warn", "backup.room_note_write_failed", { errno: errnoOf(error) ?? null });
  }
}

/**
 * The note, only when it is a regular file of at most 64 KiB, parses, names this node, and
 * `venue.db`'s device number, file number and birth time match the note's.
 */
export async function readBackupRoomNote(options: {
  stateDir: string;
  venueDir: string;
  nodeId: string;
}): Promise<{ note: BackupRoomNote } | { skipped: BackupRoomNoteSkip }> {
  let text: string;
  try {
    const path = notePath(options.stateDir);
    const info = await lstat(path);
    if (!info.isFile()) return { skipped: "unreadable" };
    if (info.size > MAX_NOTE_BYTES) return { skipped: "malformed" };
    text = await readFile(path, "utf8");
  } catch (error) {
    return { skipped: errnoOf(error) === "ENOENT" ? "missing" : "unreadable" };
  }
  const note = parseNote(text);
  if (note === null) return { skipped: "malformed" };
  if (note.nodeId !== options.nodeId) return { skipped: "node_mismatch" };
  let current: VenueDbIdentity;
  try {
    current = await venueDbIdentity(options.venueDir);
  } catch (error) {
    return { skipped: errnoOf(error) === "ENOENT" ? "venue_db_missing" : "venue_db_unreadable" };
  }
  const same =
    current.dev === note.venueDb.dev &&
    current.ino === note.venueDb.ino &&
    current.birthtimeNs === note.venueDb.birthtimeNs;
  return same ? { note } : { skipped: "identity_mismatch" };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only the spelling `toISOString` writes. */
const isTime = (value: unknown): value is string =>
  typeof value === "string" &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

const isFolderDir = (value: unknown): value is string =>
  typeof value === "string" && isAbsolute(value) && normalize(value) === value;

const isDigits = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

function parseNote(text: string): BackupRoomNote | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1 || !isText(value.nodeId)) return null;
  if (!isTime(value.installationStartedAt) || !isTime(value.writtenAt)) return null;
  if (Date.parse(value.installationStartedAt) > Date.parse(value.writtenAt)) return null;
  const { venueDb, folders } = value;
  if (!isRecord(venueDb) || ![venueDb.dev, venueDb.ino, venueDb.birthtimeNs].every(isDigits))
    return null;
  if (typeof value.managedByEnvironment !== "boolean" || !Array.isArray(folders)) return null;
  const foldersValid = folders.every(
    (folder) =>
      isRecord(folder) &&
      isText(folder.destination) &&
      isFolderDir(folder.dir) &&
      isFolderDir(folder.configuredDir),
  );
  if (!foldersValid) return null;
  return {
    version: 1,
    nodeId: value.nodeId,
    installationStartedAt: value.installationStartedAt,
    venueDb: {
      dev: venueDb.dev as string,
      ino: venueDb.ino as string,
      birthtimeNs: venueDb.birthtimeNs as string,
    },
    managedByEnvironment: value.managedByEnvironment,
    folders: (folders as BackupRoomNoteFolder[]).map(({ destination, dir, configuredDir }) => ({
      destination,
      dir,
      configuredDir,
    })),
    writtenAt: value.writtenAt,
  };
}
