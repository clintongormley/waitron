import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS, setNodeModeTx } from "@waitron/node-db";
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

const lockHolders: ChildProcess[] = [];
let root: string;
let stateDir: string;
let venueDir: string;
const log = vi.fn();
const nodeId = "selected-copy-mirror";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "spare-copy-placement-"));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  mkdirSync(stateDir);
  mkdirSync(venueDir);
  log.mockReset();
});
afterEach(async () => {
  for (const holder of lockHolders.splice(0)) holder.kill("SIGKILL");
  renames.before = undefined;
  renames.after = undefined;
  await rm(root, { recursive: true, force: true });
});

const live = () => join(venueDir, VENUE_FILE);
const copyFolder = () => join(stateDir, PAIR_COPY_DIR);
const note = () => join(stateDir, BACKUP_ROOM_NOTE_FILE);
const place = () => placeFirstCopy({ stateDir, venueDir, nodeId, log });

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
  // As Litestream's restore leaves it.
  chmodSync(join(copyFolder(), VENUE_FILE), 0o644);
  writeFileSync(join(copyFolder(), `${VENUE_FILE}-wal`), "");
  writeFileSync(join(copyFolder(), `${VENUE_FILE}-shm`), "read-only open's shm");
  mkdirSync(join(copyFolder(), ".litestream-restore"));
  writeFileSync(join(copyFolder(), ".litestream-restore", "ltx"), "restore working file");
  writeFileSync(join(copyFolder(), PAIR_COPY_READY_FILE), '{"generation":"g1"}');
}

describe("placeFirstCopy", () => {
  it.each(["primary", "mirror"] as const)(
    "a selected backup replaces only a mirror, with mode %s",
    async (mode) => {
      spareWithReadyCopy();
      await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, nodeId, mode));
      await rm(join(venueDir, NODE_FILE));
      await suite.node.archiveTo(join(venueDir, NODE_FILE));
      const selection = { source: "selected-backup", sourceId: "a".repeat(64) };
      writeFileSync(join(copyFolder(), PAIR_COPY_READY_FILE), JSON.stringify(selection));
      const nodeBefore = readFileSync(join(venueDir, NODE_FILE));

      expect(await place()).toBe(mode === "mirror");

      expect(readFileSync(live(), "utf8")).toBe(
        mode === "mirror" ? "the main box's venue" : "the spare's own empty venue",
      );
      expect(readFileSync(join(venueDir, NODE_FILE))).toEqual(nodeBefore);
      expect(existsSync(join(copyFolder(), VENUE_FILE))).toBe(false);
      if (mode === "mirror") {
        expect(JSON.parse(readFileSync(join(copyFolder(), "placed.json"), "utf8"))).toEqual(
          selection,
        );
        expect(await place()).toBe(false);
        expect(readFileSync(live(), "utf8")).toBe("the main box's venue");
        await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, nodeId, "primary"));
        await rm(join(venueDir, NODE_FILE));
        await suite.node.archiveTo(join(venueDir, NODE_FILE));
        expect(await place()).toBe(false);
        expect(existsSync(copyFolder())).toBe(false);
        expect(readFileSync(live(), "utf8")).toBe("the main box's venue");
      } else expect(existsSync(copyFolder())).toBe(false);
    },
  );

  it("finishes selected provenance after a crash just after the live rename", async () => {
    spareWithReadyCopy();
    await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, nodeId, "mirror"));
    await rm(join(venueDir, NODE_FILE));
    await suite.node.archiveTo(join(venueDir, NODE_FILE));
    const selection = { source: "selected-backup", sourceId: "a".repeat(64) };
    writeFileSync(join(copyFolder(), PAIR_COPY_READY_FILE), JSON.stringify(selection));
    renames.after = (to) => {
      if (to === live()) throw new Error("stopped after live rename");
    };
    await expect(place()).rejects.toThrow("stopped after live rename");
    renames.after = undefined;
    writeFileSync(`${live()}-wal`, "the next ahead check's wal");
    expect(await place()).toBe(true);
    expect(readFileSync(`${live()}-wal`, "utf8")).toBe("the next ahead check's wal");
    expect(JSON.parse(readFileSync(join(copyFolder(), "placed.json"), "utf8"))).toEqual(selection);
    expect(existsSync(join(copyFolder(), PAIR_COPY_READY_FILE))).toBe(false);
  });

  it("puts the copy in place before the store opens, keeping node.db, secrets.env and tls/", async () => {
    spareWithReadyCopy();

    expect(await place()).toBe(true);

    expect(readFileSync(live(), "utf8")).toBe("the main box's venue");
    expect(statSync(live()).mode & 0o777).toBe(0o600);
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

  it("is refused, changing nothing, while another process holds the folder, and releases its own hold", async () => {
    spareWithReadyCopy();
    const lockFile = join(venueDir, "venue.lock");
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const c = new DatabaseSync(process.argv[1]);
         c.exec("begin immediate");
         console.log("held");
         setInterval(() => {}, 1000);`,
        lockFile,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    lockHolders.push(holder);
    await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));

    await expect(place()).rejects.toMatchObject({ code: "provisioning.database_in_use" });
    expect(readFileSync(live(), "utf8")).toBe("the spare's own empty venue");
    expect(readFileSync(note(), "utf8")).toBe("{}");
    expect(readFileSync(join(copyFolder(), PAIR_COPY_READY_FILE), "utf8")).toBe(
      '{"generation":"g1"}',
    );

    holder.kill("SIGKILL");
    await new Promise((resolve) => holder.once("exit", resolve));
    expect(await place()).toBe(true);

    // Failing case, a hold never released: `begin immediate` here answers "database is locked".
    const taken = spawnSync(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         new DatabaseSync(process.argv[1]).exec("begin immediate");`,
        lockFile,
      ],
      { encoding: "utf8" },
    );
    expect(taken.stderr).toBe("");
    expect(taken.status).toBe(0);
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
