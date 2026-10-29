import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteBackupRoomNote } from "./backup-room-note-file.js";
import { BACKUP_ROOM_NOTE_FILE } from "./spare-space-name.js";

vi.mock("node:fs/promises", { spy: true });

let stateDir: string;
const notePath = () => join(stateDir, BACKUP_ROOM_NOTE_FILE);

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "backup-room-note-file-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(stateDir, { recursive: true, force: true });
});

/** The folders opened and synced, in order, while `run` runs. */
async function syncedFolders(run: () => Promise<void>): Promise<string[]> {
  const synced: string[] = [];
  const { open: realOpen } = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await realOpen(...args);
    const realSync = handle.sync.bind(handle);
    handle.sync = async () => {
      synced.push(String(args[0]));
      return realSync();
    };
    return handle;
  });
  await run();
  return synced;
}

describe("deleteBackupRoomNote", () => {
  it("deletes the note and then syncs the state folder, so the deletion survives a power cut", async () => {
    await writeFile(notePath(), "{}");
    const synced = await syncedFolders(() => deleteBackupRoomNote(stateDir));
    expect(existsSync(notePath())).toBe(false);
    expect(synced).toEqual([stateDir]);
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

  it("throws when the state folder cannot be synced after the deletion", async () => {
    await writeFile(notePath(), "{}");
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error("no"), { code: "EIO" }));
    await expect(deleteBackupRoomNote(stateDir)).rejects.toMatchObject({ code: "EIO" });
    expect(existsSync(notePath())).toBe(false);
  });
});
