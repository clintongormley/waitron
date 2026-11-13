import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_ROOM_NOTE_FILE,
  NODE_FILE,
  PAIR_COPY_DIR,
  SECRETS_ENV_FILE,
  VENUE_FILE,
} from "@waitron/store";
import { PAIR_COPY_READY_FILE } from "./spare-copy.js";
import { placeFirstCopy } from "./spare-copy-placement.js";

const renames = vi.hoisted(() => ({
  before: undefined as undefined | ((to: string) => void),
  after: undefined as undefined | ((to: string) => void),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      renames.before?.(to);
      await actual.rename(from, to);
      renames.after?.(to);
    },
  };
});

let root: string;
let stateDir: string;
let venueDir: string;
const log = vi.fn();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "spare-copy-placement-"));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  mkdirSync(stateDir);
  mkdirSync(venueDir);
  log.mockReset();
});
afterEach(async () => {
  renames.before = undefined;
  renames.after = undefined;
  await rm(root, { recursive: true, force: true });
});

const live = () => join(venueDir, VENUE_FILE);
const copyFolder = () => join(stateDir, PAIR_COPY_DIR);
const note = () => join(stateDir, BACKUP_ROOM_NOTE_FILE);
const place = () => placeFirstCopy({ stateDir, venueDir, log });

/** A spare as its latch start leaves it once the copy is ready, with the leftovers a restore leaves. */
function spareWithReadyCopy(): void {
  writeFileSync(live(), "the spare's own empty venue");
  writeFileSync(`${live()}-wal`, "an old write-ahead log");
  writeFileSync(`${live()}-shm`, "an old shared-memory file");
  mkdirSync(join(venueDir, ".venue.db-litestream"));
  writeFileSync(join(venueDir, ".venue.db-litestream", "generation"), "old");
  writeFileSync(join(venueDir, NODE_FILE), "this box's node.db");
  writeFileSync(join(stateDir, SECRETS_ENV_FILE), "WAITRON_CREDENTIALS_KEY=x");
  mkdirSync(join(stateDir, "tls"));
  writeFileSync(join(stateDir, "tls", "server.pem"), "this box's certificate");
  writeFileSync(note(), "{}");
  mkdirSync(copyFolder());
  writeFileSync(join(copyFolder(), VENUE_FILE), "the main box's venue");
  writeFileSync(join(copyFolder(), `${VENUE_FILE}-wal`), "");
  writeFileSync(join(copyFolder(), `${VENUE_FILE}-shm`), "read-only open's shm");
  mkdirSync(join(copyFolder(), ".litestream-restore"));
  writeFileSync(join(copyFolder(), ".litestream-restore", "ltx"), "restore working file");
  writeFileSync(join(copyFolder(), PAIR_COPY_READY_FILE), '{"generation":"g1"}');
}

describe("placeFirstCopy", () => {
  it("puts the copy in place before the store opens, keeping node.db, secrets.env and tls/", async () => {
    spareWithReadyCopy();

    expect(await place()).toBe(true);

    expect(readFileSync(live(), "utf8")).toBe("the main box's venue");
    expect(existsSync(`${live()}-wal`)).toBe(false);
    expect(existsSync(`${live()}-shm`)).toBe(false);
    expect(existsSync(join(venueDir, ".venue.db-litestream"))).toBe(false);
    expect(readFileSync(join(venueDir, NODE_FILE), "utf8")).toBe("this box's node.db");
    expect(readFileSync(join(stateDir, SECRETS_ENV_FILE), "utf8")).toBe(
      "WAITRON_CREDENTIALS_KEY=x",
    );
    expect(readFileSync(join(stateDir, "tls", "server.pem"), "utf8")).toBe(
      "this box's certificate",
    );
    expect(log).toHaveBeenCalledWith("info", "spare.first_copy_placed", {});
  });

  it("removes the whole pair-copy folder once the copy is in place", async () => {
    spareWithReadyCopy();

    await place();

    expect(existsSync(copyFolder())).toBe(false);
  });

  it("does nothing when ready.json is absent", async () => {
    spareWithReadyCopy();
    await rm(join(copyFolder(), PAIR_COPY_READY_FILE));

    expect(await place()).toBe(false);

    expect(readFileSync(live(), "utf8")).toBe("the spare's own empty venue");
    expect(existsSync(`${live()}-wal`)).toBe(true);
    expect(existsSync(note())).toBe(true);
    expect(existsSync(join(copyFolder(), VENUE_FILE))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("deletes the backup-room note before replacing venue.db", async () => {
    spareWithReadyCopy();
    const noteAtRename: boolean[] = [];
    renames.before = (to) => {
      if (to === live()) noteAtRename.push(existsSync(note()));
    };

    await place();

    expect(noteAtRename).toEqual([false]);
  });

  it("a crash after the rename finishes at the next start", async () => {
    spareWithReadyCopy();
    renames.after = (to) => {
      if (to === live()) throw new Error("killed after the rename");
    };
    await expect(place()).rejects.toThrow("killed after the rename");
    renames.after = undefined;
    expect(existsSync(join(copyFolder(), PAIR_COPY_READY_FILE))).toBe(true);
    // Entry's ahead check opens the placed file before the server starts.
    writeFileSync(`${live()}-wal`, "the ahead check's write-ahead log");

    expect(await place()).toBe(true);

    expect(readFileSync(live(), "utf8")).toBe("the main box's venue");
    expect(readFileSync(`${live()}-wal`, "utf8")).toBe("the ahead check's write-ahead log");
    expect(existsSync(copyFolder())).toBe(false);
  });
});
