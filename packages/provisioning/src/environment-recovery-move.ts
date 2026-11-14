import * as fs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  STATE_LAYOUT,
  ENVIRONMENT_RECOVERY_MOVE_FILE,
  BACKUP_ROOM_NOTE_FILE,
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
  RECOVERY_LOCK_FILE,
  START_AGAIN_GUESSES_FILE,
  RECOVERY_STATE_FILE,
  LOGS_DIR,
  RECORDS_DIR,
  VENUE_DIR_NAME,
  TLS_DIR,
  TLS_JOINED_FILE,
  STREAM_RESTORE_PREFIX,
  RESTORE_ENTRY_PREFIX,
  VENUE_WAL_FILE,
  VENUE_FILE,
  SHM_SUFFIX,
  JOURNAL_SUFFIX,
  NODE_WAL_FILE,
  NODE_FILE,
  VENUE_LITESTREAM_DIR,
} from "@waitron/store";
import { lockVenueDatabase } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { FIRST_SETUP_HOST_FILES } from "./first-setup-state.js";
import { canonicalFirstSetupRoots } from "./first-setup-directories.js";
import { readDurableHostJson } from "./durable-host-json.js";
import { writeFileDurable } from "./fs-atomic.js";
import { removeAndSync } from "./folder-sync.js";
import { deleteBackupRoomNote } from "./backup-room-note-file.js";
import {
  prepareSetAside,
  makeDestinationFolders,
  setAsideDestinations,
  movePiece,
  type SetAsideIo,
} from "./first-setup-start-again-set-aside.js";
import type { StartAgainUnit } from "./first-setup-start-again-leftovers.js";
import "./errors.js";

type Roots = { stateDir: string; venueDir: string };
type Piece = { root: "state" | "venue"; path: string };
interface Move {
  version: 1;
  roots: Roots;
  pieces: Piece[];
  setAside: { state: string; venue: string };
}
const KEEP = new Set([
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
  RECOVERY_LOCK_FILE,
  START_AGAIN_GUESSES_FILE,
  RECOVERY_STATE_FILE,
  LOGS_DIR,
  RECORDS_DIR,
  VENUE_DIR_NAME,
  BACKUP_ROOM_NOTE_FILE,
  ENVIRONMENT_RECOVERY_MOVE_FILE,
]);
const VENUE = [
  VENUE_WAL_FILE,
  `${VENUE_FILE}${SHM_SUFFIX}`,
  `${VENUE_FILE}${JOURNAL_SUFFIX}`,
  VENUE_FILE,
  NODE_WAL_FILE,
  `${NODE_FILE}${SHM_SUFFIX}`,
  `${NODE_FILE}${JOURNAL_SUFFIX}`,
  NODE_FILE,
  VENUE_LITESTREAM_DIR,
  "first-setup-workspaces",
  "first-setup-selection.json",
  "first-setup-retirement.json",
  "first-setup-workspace.json",
];
const STATE = [
  ...new Set([
    ...STATE_LAYOUT.filter((entry) => entry.reset === "deleted").map((entry) => entry.name),
    ...FIRST_SETUP_HOST_FILES,
  ]),
].filter((name) => !KEEP.has(name));
const staging = (name: string) =>
  [STREAM_RESTORE_PREFIX, RESTORE_ENTRY_PREFIX].some(
    (prefix) => name.startsWith(prefix) && !name.includes("/") && !name.includes("\\"),
  );
const realIo: SetAsideIo = fs;
const unfinished = () => new AppError("setup.environment_move_unfinished", {});
async function present(path: string, io: SetAsideIo): Promise<boolean> {
  try {
    await io.lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
const unit = (piece: Piece): StartAgainUnit => ({
  ...piece,
  why: "not-created",
  pieces: [piece.path],
  entries: [],
});
const at = (roots: Roots, piece: Piece) =>
  join(piece.root === "state" ? roots.stateDir : roots.venueDir, piece.path);

async function inventory(roots: Roots): Promise<Piece[]> {
  const state = [...STATE, ...(await fs.readdir(roots.stateDir)).filter(staging)];
  if (await present(join(roots.stateDir, TLS_JOINED_FILE), realIo)) state.push(TLS_DIR);
  const pieces: Piece[] = [];
  for (const [root, names] of [
    ["venue", VENUE],
    ["state", state],
  ] as const)
    for (const path of names) {
      const piece = { root, path };
      if (await present(at(roots, piece), realIo)) pieces.push(piece);
    }
  return pieces;
}

async function move(record: Move, io: SetAsideIo) {
  try {
    const folders = await makeDestinationFolders(
      record.roots,
      { listed: { units: record.pieces }, setAside: record.setAside },
      io,
    );
    await deleteBackupRoomNote(record.roots.stateDir);
    for (const piece of record.pieces) {
      const source = await present(at(record.roots, piece), io);
      const destination = await present(join(folders[piece.root], piece.path), io);
      if (source && destination) throw unfinished();
      if (source) await movePiece(record.roots, folders, unit(piece), piece.path, io);
    }
    return { roots: record.roots, folders, setAside: record.setAside };
  } catch (error) {
    throw new AppError(
      "setup.environment_move_unfinished",
      {},
      {
        reason:
          error instanceof AppError
            ? error.code
            : ((error as NodeJS.ErrnoException).code ?? "move_failed"),
      },
    );
  }
}

/** The caller holds the venue folder from its mismatch/password checks through this Move. */
export async function beginEnvironmentMove(given: Roots, io: SetAsideIo = realIo) {
  const roots = await canonicalFirstSetupRoots(given);
  if (await present(join(roots.stateDir, ENVIRONMENT_RECOVERY_MOVE_FILE), realIo))
    throw unfinished();
  const pieces = await inventory(roots);
  const setAside = setAsideDestinations(`${Date.now()}-${randomUUID()}`);
  await prepareSetAside(roots, pieces.map(unit), setAside, io);
  const record: Move = { version: 1, roots, pieces, setAside };
  await writeFileDurable(
    join(roots.stateDir, ENVIRONMENT_RECOVERY_MOVE_FILE),
    JSON.stringify(record),
    0o600,
  );
  return move(record, io);
}

function parse(value: unknown): Move {
  const record = value as Move;
  if (
    record?.version !== 1 ||
    typeof record.roots?.stateDir !== "string" ||
    typeof record.roots?.venueDir !== "string" ||
    !Array.isArray(record.pieces) ||
    typeof record.setAside?.state !== "string" ||
    typeof record.setAside.venue !== "string"
  )
    throw unfinished();
  const stem = record.setAside.state.split("/").at(-2);
  if (stem === undefined || !/^\d+-[0-9a-f-]{36}$/.test(stem)) throw unfinished();
  for (const piece of record.pieces)
    if (
      piece === null ||
      typeof piece !== "object" ||
      typeof piece.path !== "string" ||
      !(
        (piece.root === "venue" && VENUE.includes(piece.path)) ||
        (piece.root === "state" &&
          (STATE.includes(piece.path) || piece.path === TLS_DIR || staging(piece.path)))
      )
    )
      throw unfinished();
  return record;
}

/** Takes the recorded venue lock; a destination alone already completed its rename. */
export async function resumeEnvironmentMove(given: Roots, io: SetAsideIo = realIo) {
  const value = await readDurableHostJson(
    join(given.stateDir, ENVIRONMENT_RECOVERY_MOVE_FILE),
    64 * 1024,
  );
  if (value === null) return null;
  const record = parse(value);
  const canonical = await canonicalFirstSetupRoots(record.roots);
  if (
    canonical.stateDir !== record.roots.stateDir ||
    canonical.venueDir !== record.roots.venueDir ||
    canonical.stateDir !== (await canonicalFirstSetupRoots(given)).stateDir
  )
    throw unfinished();
  const expected = setAsideDestinations(record.setAside.state.split("/").at(-2)!);
  if (expected.state !== record.setAside.state || expected.venue !== record.setAside.venue)
    throw unfinished();
  const hold = await lockVenueDatabase(canonical.venueDir);
  try {
    return await move(record, io);
  } finally {
    hold.release();
  }
}

/** Called only after the recovery stop has been cleared through its own writer. */
export async function finishEnvironmentMove(stateDir: string): Promise<void> {
  await removeAndSync(join(stateDir, ENVIRONMENT_RECOVERY_MOVE_FILE), "file");
}
