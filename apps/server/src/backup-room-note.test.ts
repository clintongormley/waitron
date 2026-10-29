import { existsSync } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKUP_ROOM_NOTE_FILE, BACKUP_ROOM_START_DELETED_FILE } from "@waitron/provisioning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteBackupRoomNote,
  readBackupRoomNote,
  writeBackupRoomNote,
  type BackupRoomNote,
} from "./backup-room-note.js";

let root: string;
let stateDir: string;
let venueDir: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "backup-room-note-")));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await writeFile(venueDb(), "first installation");
});
afterEach(() => rm(root, { recursive: true, force: true }));

const venueDb = () => join(venueDir, "venue.db");
const notePath = () => join(stateDir, BACKUP_ROOM_NOTE_FILE);
const startedAt = new Date("2026-10-01T09:00:00.000Z");
const now = new Date("2026-10-29T12:00:00.000Z");

async function write(overrides: Partial<Parameters<typeof writeBackupRoomNote>[0]> = {}) {
  const log = vi.fn();
  await writeBackupRoomNote({
    stateDir,
    venueDir,
    nodeId: "node-1",
    installationStartedAt: startedAt,
    managedByEnvironment: false,
    folders: [{ destination: "usb", dir: join(root, "usb") }],
    now: () => now,
    log,
    ...overrides,
  });
  return log;
}

const read = (nodeId = "node-1") => readBackupRoomNote({ stateDir, venueDir, nodeId });

describe("file names", () => {
  it("names the note and the start's deletion record in the state folder", () => {
    expect(BACKUP_ROOM_NOTE_FILE).toBe("backup-room-note.json");
    expect(BACKUP_ROOM_START_DELETED_FILE).toBe("backup-room-start-deleted.json");
  });
});

describe("writeBackupRoomNote", () => {
  it("writes the installation start, venue.db's identity, the folders and the time", async () => {
    const log = await write({ managedByEnvironment: true });
    const stored = JSON.parse(await readFile(notePath(), "utf8")) as BackupRoomNote;
    expect(stored).toEqual({
      version: 1,
      nodeId: "node-1",
      installationStartedAt: "2026-10-01T09:00:00.000Z",
      venueDb: {
        dev: expect.stringMatching(/^\d+$/),
        ino: expect.stringMatching(/^\d+$/),
        birthtimeNs: expect.stringMatching(/^\d+$/),
      },
      managedByEnvironment: true,
      folders: [{ destination: "usb", dir: join(root, "usb") }],
      writtenAt: "2026-10-29T12:00:00.000Z",
    });
    expect(log).not.toHaveBeenCalled();
    expect(await readdir(stateDir)).toEqual([BACKUP_ROOM_NOTE_FILE]);
  });

  it("reads back as the note it wrote", async () => {
    await write();
    const stored = JSON.parse(await readFile(notePath(), "utf8")) as BackupRoomNote;
    expect(await read()).toEqual({ note: stored });
  });

  it("deletes an older note and writes nothing when venue.db is missing", async () => {
    await write();
    await unlink(venueDb());
    const log = await write();
    expect(existsSync(notePath())).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves no note, and no temporary file, when the rename fails, even with an older note there", async () => {
    await write();
    const failing = vi.fn(async () => {
      throw Object.assign(new Error("no room"), { code: "ENOSPC" });
    });
    const log = await write({ rename: failing });
    expect(failing).toHaveBeenCalledOnce();
    expect(existsSync(notePath())).toBe(false);
    expect(await readdir(stateDir)).toEqual([]);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.room_note_write_failed", { errno: "ENOSPC" }],
    ]);
  });

  it("never throws, and logs a failure that carries no errno as null", async () => {
    await write();
    const log = await write({
      rename: async () => {
        throw new Error("odd");
      },
    });
    expect(existsSync(notePath())).toBe(false);
    expect(log.mock.calls).toEqual([["warn", "backup.room_note_write_failed", { errno: null }]]);
  });

  it("deletes an older note and logs when venue.db cannot be read for another reason", async () => {
    await write();
    await rm(venueDir, { recursive: true });
    await writeFile(venueDir, "a file where the venue folder was");
    const log = await write();
    expect(await readdir(stateDir)).toEqual([]);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.room_note_write_failed", { errno: "ENOTDIR" }],
    ]);
  });

  it("logs and writes nothing when even the older note cannot be deleted", async () => {
    await mkdir(notePath());
    await writeFile(join(notePath(), "inside"), "x");
    const log = await write();
    expect(log.mock.calls).toEqual([
      ["warn", "backup.room_note_write_failed", { errno: expect.any(String) }],
    ]);
  });
});

describe("deleteBackupRoomNote", () => {
  it("deletes the note", async () => {
    await write();
    await deleteBackupRoomNote(stateDir);
    expect(existsSync(notePath())).toBe(false);
  });

  it("answers quietly when there is no note", async () => {
    await expect(deleteBackupRoomNote(stateDir)).resolves.toBeUndefined();
  });

  it("throws any failure other than a missing note", async () => {
    await mkdir(notePath());
    await expect(deleteBackupRoomNote(stateDir)).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|EPERM)$/),
    });
  });
});

describe("readBackupRoomNote", () => {
  it("answers missing when there is no note", async () => {
    expect(await read()).toEqual({ skipped: "missing" });
  });

  it("answers unreadable when the note cannot be read", async () => {
    await mkdir(notePath());
    expect(await read()).toEqual({ skipped: "unreadable" });
  });

  it("refuses the note once venue.db is replaced by a rename over it, as a restore does", async () => {
    await write();
    await writeFile(join(venueDir, "restored.db"), "restored installation");
    await rename(join(venueDir, "restored.db"), venueDb());
    expect(await read()).toEqual({ skipped: "identity_mismatch" });
  });

  it("refuses the note once venue.db is deleted and created again", async () => {
    await write();
    await unlink(venueDb());
    // A filesystem that hands the freed inode straight to the new file (ext4 may) and stamps times
    // from a clock coarser than its nanosecond field would make the two files look alike; real
    // replacements are never this quick, so the test waits out such a tick.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(venueDb(), "new installation");
    expect(await read()).toEqual({ skipped: "identity_mismatch" });
  });

  it("refuses a note whose venue.db birth time differs only below the millisecond", async () => {
    await write();
    const info = await lstat(venueDb(), { bigint: true });
    const stored = JSON.parse(await readFile(notePath(), "utf8")) as Record<string, unknown>;
    const otherNs =
      info.birthtimeNs % 1_000_000n === 0n ? info.birthtimeNs + 1n : info.birthtimeNs - 1n;
    stored.venueDb = {
      dev: info.dev.toString(),
      ino: info.ino.toString(),
      birthtimeNs: otherNs.toString(),
    };
    await writeFile(notePath(), JSON.stringify(stored));
    expect(await read()).toEqual({ skipped: "identity_mismatch" });
  });

  it("accepts the note after writes into the same venue.db (control)", async () => {
    await write();
    await appendFile(venueDb(), " and more sales");
    await writeFile(venueDb(), "rewritten in place");
    expect(await read()).toMatchObject({ note: { nodeId: "node-1" } });
  });

  it("refuses the note for another node", async () => {
    await write();
    expect(await read("node-2")).toEqual({ skipped: "node_mismatch" });
  });

  it("refuses the note when venue.db is missing", async () => {
    await write();
    await unlink(venueDb());
    expect(await read()).toEqual({ skipped: "venue_db_missing" });
  });

  it("refuses the note when venue.db cannot be read for another reason", async () => {
    await write();
    await rm(venueDir, { recursive: true });
    await writeFile(venueDir, "a file where the venue folder was");
    expect(await read()).toEqual({ skipped: "venue_db_unreadable" });
  });

  const valid = (): Record<string, unknown> => ({
    version: 1,
    nodeId: "node-1",
    installationStartedAt: "2026-10-01T09:00:00.000Z",
    venueDb: { dev: "1", ino: "2", birthtimeNs: "3" },
    managedByEnvironment: false,
    folders: [{ destination: "usb", dir: "/mnt/usb" }],
    writtenAt: "2026-10-29T12:00:00.000Z",
  });

  it.each<[string, (note: Record<string, unknown>) => unknown]>([
    ["not JSON", () => "{"],
    ["not an object", () => [1]],
    ["null", () => null],
    ["another version", (note) => ({ ...note, version: 2 })],
    ["a node id that is not text", (note) => ({ ...note, nodeId: 7 })],
    [
      "an installation start that is not a time",
      (note) => ({ ...note, installationStartedAt: "soon" }),
    ],
    ["an installation start that is not text", (note) => ({ ...note, installationStartedAt: 5 })],
    ["a written time that is not a time", (note) => ({ ...note, writtenAt: "later" })],
    ["no venue.db identity", (note) => ({ ...note, venueDb: null })],
    [
      "a venue.db identity that is not digits",
      (note) => ({ ...note, venueDb: { dev: "1", ino: "x", birthtimeNs: "3" } }),
    ],
    [
      "a venue.db identity number",
      (note) => ({ ...note, venueDb: { dev: "1", ino: "2", birthtimeNs: 3 } }),
    ],
    [
      "a managed flag that is not true or false",
      (note) => ({ ...note, managedByEnvironment: "no" }),
    ],
    ["folders that are not a list", (note) => ({ ...note, folders: {} })],
    ["a folder that is not an object", (note) => ({ ...note, folders: ["usb"] })],
    ["a folder with no directory", (note) => ({ ...note, folders: [{ destination: "usb" }] })],
    ["a folder with no destination", (note) => ({ ...note, folders: [{ dir: "/mnt/usb" }] })],
  ])("answers malformed for %s", async (_label, change) => {
    const body = change(valid());
    await writeFile(notePath(), typeof body === "string" ? body : JSON.stringify(body));
    expect(await read()).toEqual({ skipped: "malformed" });
  });

  it("parses a hand-written valid note before checking venue.db (control for the malformed cases)", async () => {
    await writeFile(notePath(), JSON.stringify(valid()));
    expect(await read()).toEqual({ skipped: "identity_mismatch" });
  });
});
