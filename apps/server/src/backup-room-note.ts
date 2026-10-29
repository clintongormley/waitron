import { randomBytes } from "node:crypto";
import { lstat, readFile, rename as renameFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP_ROOM_NOTE_FILE } from "@waitron/provisioning";
import type { BackupFolder } from "./backup-room.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

/**
 * Lets the start delete old backups without opening the venue database: it trusts the
 * installation start only while `venue.db` is still the very file the note was written beside.
 */
export interface BackupRoomNote {
  version: 1;
  nodeId: string;
  installationStartedAt: string;
  venueDb: VenueDbIdentity;
  managedByEnvironment: boolean;
  folders: BackupFolder[];
  writtenAt: string;
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

type Rename = (from: string, to: string) => Promise<void>;

const notePath = (stateDir: string) => join(stateDir, BACKUP_ROOM_NOTE_FILE);

async function venueDbIdentity(venueDir: string): Promise<VenueDbIdentity> {
  const info = await lstat(join(venueDir, "venue.db"), { bigint: true });
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
}

/**
 * Replaces the note with one naming the current `venue.db`. With `venue.db` missing, or on any
 * failure, no note is left. Nothing is thrown.
 */
export async function writeBackupRoomNote(options: {
  stateDir: string;
  venueDir: string;
  nodeId: string;
  installationStartedAt: Date;
  managedByEnvironment: boolean;
  folders: readonly BackupFolder[];
  now: () => Date;
  log: Logger;
  rename?: Rename;
}): Promise<void> {
  const { stateDir, log, rename = renameFile } = options;
  const temporary = join(
    stateDir,
    `${BACKUP_ROOM_NOTE_FILE}.${randomBytes(6).toString("hex")}.tmp`,
  );
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
      folders: options.folders.map(({ destination, dir }) => ({ destination, dir })),
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

/** A missing note counts as deleted; any other failure is thrown. */
export async function deleteBackupRoomNote(stateDir: string): Promise<void> {
  try {
    await unlink(notePath(stateDir));
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") throw error;
  }
}

/** The note, only when it parses, names this node, and `venue.db` is the file it was written beside. */
export async function readBackupRoomNote(options: {
  stateDir: string;
  venueDir: string;
  nodeId: string;
}): Promise<{ note: BackupRoomNote } | { skipped: BackupRoomNoteSkip }> {
  let text: string;
  try {
    text = await readFile(notePath(options.stateDir), "utf8");
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

const isTime = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const isDigits = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

function parseNote(text: string): BackupRoomNote | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.nodeId !== "string") return null;
  if (!isTime(value.installationStartedAt) || !isTime(value.writtenAt)) return null;
  const { venueDb, folders } = value;
  if (!isRecord(venueDb) || ![venueDb.dev, venueDb.ino, venueDb.birthtimeNs].every(isDigits))
    return null;
  if (typeof value.managedByEnvironment !== "boolean" || !Array.isArray(folders)) return null;
  const foldersValid = folders.every(
    (folder) =>
      isRecord(folder) && typeof folder.destination === "string" && typeof folder.dir === "string",
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
    folders: (folders as BackupFolder[]).map(({ destination, dir }) => ({ destination, dir })),
    writtenAt: value.writtenAt,
  };
}
