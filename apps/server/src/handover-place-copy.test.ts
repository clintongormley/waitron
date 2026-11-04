import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { chmod, copyFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  lockVenueDatabase,
  openVenueDatabase,
  withNodeTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { signIndicator, type HandoverBinding, type NodeLocalItem } from "@waitron/handover";
import { generateNodeKeyPair } from "@waitron/membership";
import { appendHandoverEventTx, NODE_MIGRATIONS, setNodeModeTx } from "@waitron/node-db";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { FINAL_STATE_EVENT } from "./handover-capture.js";
import {
  COPY_PLACED_EVENT,
  placeAcceptedCopyAtStart,
  type PlacementSteps,
} from "./handover-place-copy.js";
import { advanceHandover, beginHandover } from "./handover-store.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const OTHER_NODE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE = "backup-room-note.json";
const PREPARATION = "module-preparation-state.json";

const BINDING: HandoverBinding = {
  operationId: OP,
  scenario: "controlled",
  venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
  sourceNodeId: SOURCE,
  destinationNodeId: NODE,
  membership: { term: 3, digest: "a".repeat(64) },
};

const REVISION = {
  binding: {
    module: "verifactu",
    action: "reserve-minute",
    eventId: "event-1",
    sourceId: "source-1",
    targetNodeId: SOURCE,
  },
  value: { minute: "ABCDE" },
};

const scratchFolders: string[] = [];
const lockHolders: ChildProcess[] = [];

afterEach(() => {
  for (const holder of lockHolders.splice(0)) holder.kill("SIGKILL");
  for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), "waitron-place-copy-"));
  scratchFolders.push(folder);
  return folder;
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A real database in the shape `VACUUM INTO` leaves, as the accepted copy is. */
function sqliteFile(path: string, table: string): void {
  const raw = new DatabaseSync(`${path}.source`);
  raw.exec(`create table ${table}(a); vacuum into '${path}'`);
  raw.close();
  rmSync(`${path}.source`);
}

/**
 * Real frames in `<path>-wal`, as a killed process leaves them: the writer's close would checkpoint
 * them away, so the files are taken while it is open and put back after.
 */
function realOldWal(path: string, write: string): void {
  const kept = scratch();
  const writer = new DatabaseSync(path);
  writer.exec(`pragma journal_mode = wal; pragma wal_autocheckpoint = 0; ${write}`);
  for (const suffix of ["", "-wal", "-shm"]) {
    copyFileSync(`${path}${suffix}`, join(kept, `db${suffix}`));
  }
  writer.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    copyFileSync(join(kept, `db${suffix}`), `${path}${suffix}`);
  }
}

function tableNames(databasePath: string): string[] {
  const reader = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = reader.prepare("select name from sqlite_master order by name").all();
    return rows.map((row) => (row as { name: string }).name);
  } finally {
    reader.close();
  }
}

const KILL_CHILD = fileURLToPath(new URL("./testing/place-copy-kill-child.ts", import.meta.url));

function killedPlacing(
  args: { venueDir: string; stateDir: string },
  at: string,
): Promise<{ signal: NodeJS.Signals | null; output: string }> {
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), KILL_CHILD, args.venueDir, args.stateDir, NODE, at],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  return new Promise((resolve) => {
    child.once("close", (_code, signal) => resolve({ signal, output }));
  });
}

interface Logged {
  readonly level: string;
  readonly message: string;
  readonly detail: unknown;
}

describe("placeAcceptedCopyAtStart", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
  const storeDeps = () => ({ node: suite.node, nodeId: NODE });

  async function recordIndicator(sha256: string, withRevision: boolean): Promise<void> {
    const nodeLocal: NodeLocalItem[] = [
      { item: "backup.env", where: "state", class: "transferred", treatment: "x", sha256: null },
      { item: "modules.json", where: "state", class: "transferred", treatment: "x", sha256: null },
      {
        item: "secrets.env",
        where: "state",
        class: "transferred",
        treatment: "x",
        ringVersions: [1],
      },
      {
        item: PREPARATION,
        where: "state",
        class: "transferred",
        treatment: "merged",
        revisions: withRevision ? [REVISION] : [],
      },
    ];
    const envelope = signIndicator(
      {
        binding: BINDING,
        snapshot: { sha256, bytes: 1, schema: [], modules: [] },
        nodeLocal,
        modulesSummary: {},
        capturedAtMs: 1,
      },
      { nodeId: SOURCE, privateKey: generateNodeKeyPair().privateKey },
    );
    await withNodeTransaction(suite.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: NODE,
        operationId: OP,
        kind: FINAL_STATE_EVENT,
        detail: {},
        envelope: JSON.stringify(envelope),
      }),
    );
  }

  /** A spare that has taken over filing and restarted, with the operation recorded by the real writers. */
  async function box(
    options: {
      mode?: "mirror" | "primary" | null;
      state?: "copy_accepted" | "filing_assumed";
      withRevision?: boolean;
      anotherBoxIsAMirror?: boolean;
    } = {},
  ) {
    const root = scratch();
    const venueDir = join(root, "venue");
    const stateDir = join(root, "state");
    mkdirSync(venueDir);
    mkdirSync(stateDir);
    const accepted = acceptedCopyPath(stateDir, OP);
    mkdirSync(join(stateDir, "handover", OP), { recursive: true });
    sqliteFile(accepted, "placed");
    const live = join(venueDir, "venue.db");
    sqliteFile(live, "old_mirror");
    writeFileSync(`${live}-wal`, "stale wal");
    writeFileSync(`${live}-shm`, "stale shm");
    mkdirSync(join(venueDir, ".venue.db-litestream"));
    writeFileSync(join(venueDir, ".venue.db-litestream", "generation"), "old");
    writeFileSync(join(stateDir, NOTE), "{}");

    const { mode = "mirror", state = "filing_assumed", withRevision = true } = options;
    await beginHandover(storeDeps(), BINDING, "destination");
    await recordIndicator(sha(accepted), withRevision);
    await advanceHandover(storeDeps(), OP, "copy_accepted", {});
    if (state === "filing_assumed") await advanceHandover(storeDeps(), OP, "filing_assumed", {});
    if (mode !== null) {
      await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, NODE, mode));
    }
    if (options.anotherBoxIsAMirror === true) {
      await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, OTHER_NODE, "mirror"));
    }
    const nodePath = join(venueDir, "node.db");
    suite.node.run(sql`vacuum into ${nodePath}`);

    const logged: Logged[] = [];
    return {
      venueDir,
      stateDir,
      accepted,
      incoming: `${live}.incoming`,
      live,
      nodePath,
      logged,
      note: join(stateDir, NOTE),
      preparation: join(stateDir, PREPARATION),
      litestream: join(venueDir, ".venue.db-litestream"),
      args: {
        venueDir,
        stateDir,
        nodeId: NODE,
        log: (level: string, message: string, detail?: unknown) => {
          logged.push({ level, message, detail });
        },
      } as Parameters<typeof placeAcceptedCopyAtStart>[0],
    };
  }

  describe("placing", () => {
    it("places once: the live file becomes the accepted bytes, and a start with no open in between does not place again", async () => {
      const b = await box();
      const old = sha(b.live);

      const first = await placeAcceptedCopyAtStart(b.args);

      expect(first).toEqual({ kind: "copy_placed_owed", operationId: OP, swapped: true });
      expect(sha(b.live)).toBe(sha(b.accepted));
      expect(sha(b.live)).not.toBe(old);
      const placedFile = statSync(b.live).ino;

      const again = await placeAcceptedCopyAtStart(b.args);

      // Failing case, placing again: `swapped: true` and another file number.
      expect(again).toEqual({ kind: "copy_placed_owed", operationId: OP, swapped: false });
      expect(statSync(b.live).ino).toBe(placedFile);
    });

    it("keeps accepted.db until copy_placed is recorded, and leaves no temporary file", async () => {
      const b = await box();
      const before = sha(b.accepted);

      await placeAcceptedCopyAtStart(b.args);

      expect(sha(b.accepted)).toBe(before);
      expect(readdirSync(join(b.stateDir, "handover", OP))).toEqual(["accepted.db"]);
      expect(existsSync(b.incoming)).toBe(false);
    });

    it("an open in between changes the digest, so it places again from the kept file; once copy_placed is recorded it never places again", async () => {
      const b = await box();
      await placeAcceptedCopyAtStart(b.args);

      const opened = await openVenueDatabase(b.venueDir);
      await opened.close();
      expect(sha(b.live)).not.toBe(sha(b.accepted));

      const afterOpen = await placeAcceptedCopyAtStart(b.args);

      expect(afterOpen).toEqual({ kind: "copy_placed_owed", operationId: OP, swapped: true });
      expect(sha(b.live)).toBe(sha(b.accepted));

      // What the next piece's start does at its first node handle: record the event once.
      const started = await openVenueDatabase(b.venueDir);
      await withNodeTransaction(started.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP,
          kind: COPY_PLACED_EVENT,
          detail: {},
          envelope: null,
        }),
      );
      await started.close();
      const serving = sha(b.live);
      expect(serving).not.toBe(sha(b.accepted));

      // Failing case, placing anyway: `swapped: true`, and the opened database is replaced.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({ kind: "nothing" });
      expect(sha(b.live)).toBe(serving);
    });

    it("with copy_placed recorded and accepted.db gone, it has nothing to do", async () => {
      const b = await box();
      await placeAcceptedCopyAtStart(b.args);
      const started = await openVenueDatabase(b.venueDir);
      await withNodeTransaction(started.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP,
          kind: COPY_PLACED_EVENT,
          detail: {},
          envelope: null,
        }),
      );
      await started.close();
      rmSync(b.accepted);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({ kind: "nothing" });
    });

    it("a partial incoming file a crash left behind is replaced, not placed", async () => {
      const b = await box();
      writeFileSync(b.incoming, "half a copy");

      await placeAcceptedCopyAtStart(b.args);

      expect(sha(b.live)).toBe(sha(b.accepted));
      expect(existsSync(b.incoming)).toBe(false);
    });

    it("the placed file is the venue file's owner-only mode, whatever accepted.db's is", async () => {
      const b = await box();
      chmodSync(b.accepted, 0o644);

      await placeAcceptedCopyAtStart(b.args);

      // Failing case, no chmod: 420, the copy keeping accepted.db's mode.
      expect(statSync(b.live).mode & 0o777).toBe(0o600);
    });

    it("a failed rename stays that failure: the old venue.db is still there and the incoming file is gone", async () => {
      const b = await box();
      const old = sha(b.live);
      const refused = Object.assign(new Error("refused"), { code: "EIO" });

      await expect(
        placeAcceptedCopyAtStart({ ...b.args, fs: { rename: () => Promise.reject(refused) } }),
      ).rejects.toBe(refused);

      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.incoming)).toBe(false);
    });
  });

  describe("a real kill at each file step of the swap", () => {
    async function killedBox(step: string) {
      const b = await box();
      realOldWal(
        b.live,
        "create table old_mirror_row_in_wal(a); insert into old_mirror_row_in_wal values (1)",
      );
      (await lockVenueDatabase(b.venueDir)).release();
      const before = {
        old: sha(b.live),
        kept: sha(b.accepted),
        node: sha(b.nodePath),
        lock: statSync(join(b.venueDir, "venue.lock")).ino,
      };

      const died = await killedPlacing(b, step);

      // Failing case, a step the child never reached: `null`, and the case proves nothing.
      expect(died.signal, died.output).toBe("SIGKILL");
      return { b, before };
    }

    function expectPlacedForGood(
      b: Awaited<ReturnType<typeof box>>,
      before: { kept: string },
    ): void {
      expect(sha(b.live)).toBe(before.kept);
      expect(sha(b.accepted)).toBe(before.kept);
      expect(existsSync(`${b.live}-wal`)).toBe(false);
      expect(existsSync(`${b.live}-shm`)).toBe(false);
      expect(existsSync(b.incoming)).toBe(false);
      expect(existsSync(b.litestream)).toBe(false);
    }

    it.each([
      ["while copying to the incoming name", "copy", false],
      ["before the incoming file's mode is set", "chmod", false],
      ["before the incoming file is flushed", "flush-incoming", false],
      ["before Litestream's folder is removed", "litestream", false],
      ["before the old -wal is removed", "wal", false],
      ["before the old -shm is removed", "shm", false],
      ["before the removals are flushed", "flush-before-rename", false],
      ["before the rename onto venue.db", "rename", false],
      ["before the rename is flushed", "flush-after-rename", true],
      ["after answering", "answered", true],
    ])("%s: venue.db is there, and the next start places once", async (_name, step, placed) => {
      const { b, before } = await killedBox(step);

      // Failing case, a swap that sets the old file aside first, at "rename": false, and a real
      // start refuses that before this function can run again.
      expect(existsSync(b.live)).toBe(true);
      expect(sha(b.live)).toBe(placed ? before.kept : before.old);
      expect(sha(b.nodePath)).toBe(before.node);
      expect(statSync(join(b.venueDir, "venue.lock")).ino).toBe(before.lock);
      expect(sha(b.accepted)).toBe(before.kept);

      const next = await placeAcceptedCopyAtStart(b.args);

      expect(next).toEqual({ kind: "copy_placed_owed", operationId: OP, swapped: !placed });
      expectPlacedForGood(b, before);

      const opened = await openVenueDatabase(b.venueDir);
      await opened.close();
      expect(tableNames(b.live)).toContain("placed");
      expect(tableNames(b.live)).not.toContain("old_mirror_row_in_wal");
    });

    it.each(["wal", "shm", "rename"])(
      "killed before %s, with the database opened before the next start places, as production's ahead check does",
      async (step) => {
        const { b, before } = await killedBox(step);
        const opened = await openVenueDatabase(b.venueDir);
        await opened.close();

        const next = await placeAcceptedCopyAtStart(b.args);

        expect(next).toEqual({ kind: "copy_placed_owed", operationId: OP, swapped: true });
        expectPlacedForGood(b, before);
      },
    );
  });

  describe("an old -wal beside a new venue.db", () => {
    const NEW_DATABASE = "create table t(a); insert into t values ('new'); create table placed(a)";

    function folderWithNewDatabase(): string {
      const folder = join(scratch(), "venue");
      mkdirSync(folder);
      const source = new DatabaseSync(join(folder, "source.db"));
      source.exec(`${NEW_DATABASE}; vacuum into '${join(folder, "venue.db")}'`);
      source.close();
      rmSync(join(folder, "source.db"));
      return folder;
    }

    function oldWalBeside(folder: string, write: string): void {
      const old = join(scratch(), "old.db");
      const source = new DatabaseSync(`${old}.source`);
      source.exec(`create table t(a); insert into t values ('old'); vacuum into '${old}'`);
      source.close();
      realOldWal(old, write);
      copyFileSync(`${old}-wal`, join(folder, "venue.db-wal"));
    }

    it("no -wal: the real open shows the new file's own tables", async () => {
      const folder = folderWithNewDatabase();

      const opened = await openVenueDatabase(folder);
      await opened.close();

      expect(tableNames(join(folder, "venue.db"))).toEqual(["placed", "t"]);
    });

    it("the real open replays its frames: a schema change replaces the new file's tables, with no error", async () => {
      const folder = folderWithNewDatabase();
      oldWalBeside(folder, "create table old_mirror(a)");

      const opened = await openVenueDatabase(folder);
      await opened.close();

      expect(tableNames(join(folder, "venue.db"))).toEqual(["old_mirror", "t"]);
    });

    it("the real open replays its frames: a row change leaves a file that does not open", async () => {
      const folder = folderWithNewDatabase();
      oldWalBeside(folder, "insert into t values ('old row')");

      await expect(openVenueDatabase(folder)).rejects.toThrow(/malformed/);
    });

    it("placing removes it first, so the placed database opens as the accepted copy", async () => {
      const b = await box();
      realOldWal(
        b.live,
        "create table old_mirror_row_in_wal(a); insert into old_mirror_row_in_wal values (1)",
      );

      await placeAcceptedCopyAtStart(b.args);
      const opened = await openVenueDatabase(b.venueDir);
      await opened.close();

      // Failing case, without the removal: `old_mirror_row_in_wal` in the list and no `placed`.
      expect(tableNames(b.live)).toContain("placed");
      expect(tableNames(b.live)).not.toContain("old_mirror_row_in_wal");
    });
  });

  describe("the order of the file steps", () => {
    function recordingSteps(seen: string[]): Partial<PlacementSteps> {
      return {
        copyFile: async (from, to) => {
          seen.push(`copy to ${basename(to)}`);
          await copyFile(from, to);
        },
        chmod: async (path, mode) => {
          seen.push(`chmod ${basename(path)}`);
          await chmod(path, mode);
        },
        reachDisk: async (path) => {
          seen.push(`flush ${basename(path)}`);
        },
        rm: async (path, options) => {
          seen.push(`remove ${basename(path)}`);
          await rm(path, options);
        },
        rename: async (from, to) => {
          seen.push(`rename ${basename(from)} to ${basename(to)}`);
          await rename(from, to);
        },
      };
    }

    it("on a swap: the file is flushed before anything old goes, the removals before the rename, the rename before the answer", async () => {
      const b = await box();
      const seen: string[] = [];

      await placeAcceptedCopyAtStart({ ...b.args, fs: recordingSteps(seen) });

      // Records the calls; no power cut was run to see what they keep.
      expect(seen).toEqual([
        "copy to venue.db.incoming",
        "chmod venue.db.incoming",
        "flush venue.db.incoming",
        "remove .venue.db-litestream",
        "remove venue.db-wal",
        "remove venue.db-shm",
        "flush venue",
        "rename venue.db.incoming to venue.db",
        "flush venue",
      ]);
    });

    it("with the file already equal: the folder is flushed before the answer, and nothing else happens", async () => {
      const b = await box();
      await placeAcceptedCopyAtStart(b.args);
      const seen: string[] = [];

      const answer = await placeAcceptedCopyAtStart({ ...b.args, fs: recordingSteps(seen) });

      expect(answer).toMatchObject({ swapped: false });
      // Failing case, no flush on this path: `[]`, and `copy_placed` could outrun a rename the
      // crashed run had not flushed.
      expect(seen).toEqual(["flush venue"]);
    });
  });

  describe("the venue folder's house rules", () => {
    it("the backup-room note is gone before venue.db changes", async () => {
      const b = await box();
      const old = sha(b.live);
      const noSpace = Object.assign(new Error("no space"), { code: "ENOSPC" });

      await expect(
        placeAcceptedCopyAtStart({
          ...b.args,
          fs: {
            copyFile: (_from, to) => {
              writeFileSync(to, "half a copy");
              return Promise.reject(noSpace);
            },
          },
        }),
      ).rejects.toBe(noSpace);

      // Failing case, without the deletion here: the note is still there, and `true` is printed.
      expect(existsSync(b.note)).toBe(false);
      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.incoming)).toBe(false);
      // A copy that fails leaves the old database whole: its side files and Litestream's folder stay.
      expect(existsSync(`${b.live}-wal`)).toBe(true);
      expect(existsSync(`${b.live}-shm`)).toBe(true);
      expect(existsSync(b.litestream)).toBe(true);
    });

    it("Litestream's folder and the old side files are removed", async () => {
      const b = await box();

      await placeAcceptedCopyAtStart(b.args);

      expect(existsSync(b.litestream)).toBe(false);
      expect(existsSync(`${b.live}-wal`)).toBe(false);
      expect(existsSync(`${b.live}-shm`)).toBe(false);
    });

    it("venue.lock is never unlinked", async () => {
      const b = await box();
      // The first placement's own hold creates it; the second must find the same file.
      await placeAcceptedCopyAtStart(b.args);
      const lockFile = join(b.venueDir, "venue.lock");
      const file = statSync(lockFile).ino;
      const opened = await openVenueDatabase(b.venueDir);
      await opened.close();

      await placeAcceptedCopyAtStart(b.args);

      expect(statSync(lockFile).ino).toBe(file);
    });

    it("the swap does not touch node.db", async () => {
      const b = await box();
      const before = sha(b.nodePath);

      await placeAcceptedCopyAtStart(b.args);

      expect(sha(b.nodePath)).toBe(before);
    });

    it("reads an operation whose rows are only in node.db's -wal, and changes neither file", async () => {
      const b = await box({ state: "copy_accepted" });
      const writer = new DatabaseSync(b.nodePath);
      writer.exec(
        `pragma journal_mode = wal; pragma wal_autocheckpoint = 0;
         update node_handover_operations set state = 'filing_assumed'`,
      );
      const crashed = join(scratch(), "crashed");
      mkdirSync(crashed);
      copyFileSync(b.nodePath, join(crashed, "node.db"));
      copyFileSync(`${b.nodePath}-wal`, join(crashed, "node.db-wal"));
      writer.close();
      copyFileSync(join(crashed, "node.db"), b.nodePath);
      copyFileSync(join(crashed, "node.db-wal"), `${b.nodePath}-wal`);
      const main = sha(b.nodePath);
      const wal = sha(`${b.nodePath}-wal`);

      const placed = await placeAcceptedCopyAtStart(b.args);

      expect(placed).toEqual({ kind: "copy_placed_owed", operationId: OP, swapped: true });
      expect(sha(b.nodePath)).toBe(main);
      expect(sha(`${b.nodePath}-wal`)).toBe(wal);
    });

    it("is refused, changing nothing, while another process holds the folder, and releases its own hold", async () => {
      const b = await box();
      const old = sha(b.live);
      const lockFile = join(b.venueDir, "venue.lock");
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

      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({
        code: "provisioning.database_in_use",
      });
      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.note)).toBe(true);

      holder.kill("SIGKILL");
      await new Promise((resolve) => holder.once("exit", resolve));
      await placeAcceptedCopyAtStart(b.args);

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
  });

  describe("the old box's retained selections", () => {
    it("merges them into this box's own file before placing, and a second placing adds nothing", async () => {
      const b = await box();

      await placeAcceptedCopyAtStart(b.args);

      expect(JSON.parse(readFileSync(b.preparation, "utf8"))).toEqual({
        version: 1,
        revisions: [REVISION],
      });
      const merged = readFileSync(b.preparation, "utf8");
      const opened = await openVenueDatabase(b.venueDir);
      await opened.close();

      await placeAcceptedCopyAtStart(b.args);

      expect(readFileSync(b.preparation, "utf8")).toBe(merged);
    });

    it("an indicator with no selections writes no file", async () => {
      const b = await box({ withRevision: false });

      await placeAcceptedCopyAtStart(b.args);

      expect(existsSync(b.preparation)).toBe(false);
    });

    function expectNothingChanged(b: Awaited<ReturnType<typeof box>>, old: string): void {
      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.note)).toBe(true);
      expect(existsSync(b.accepted)).toBe(true);
      expect(existsSync(b.litestream)).toBe(true);
    }

    it("a file grown too full to take them refuses the start before anything changes", async () => {
      const b = await box();
      const old = sha(b.live);
      // Readable as it stands, and over the file's limit of 1 MiB once the old box's is added.
      const own = {
        version: 1,
        revisions: [
          {
            binding: { ...REVISION.binding, eventId: "own" },
            value: { padding: "x".repeat(1024 * 1024 - 300) },
          },
        ],
      };
      writeFileSync(b.preparation, JSON.stringify(own));
      const bytes = readFileSync(b.preparation);

      // Failing case, carrying on without the merge: this resolves, the live file is the accepted
      // copy, and a minute the old box selected could be picked again by this one.
      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({
        code: "handover.preparation_state_unusable",
      });

      expectNothingChanged(b, old);
      expect(readFileSync(b.preparation).equals(bytes)).toBe(true);
    });

    it("an unreadable file refuses the start the same way", async () => {
      const b = await box();
      const old = sha(b.live);
      writeFileSync(b.preparation, "not json");

      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({
        code: "handover.preparation_state_unusable",
      });

      expectNothingChanged(b, old);
    });

    it("a disk failure while merging stays that failure, not a statement about the file", async () => {
      const b = await box();
      const old = sha(b.live);
      const noSpace = Object.assign(new Error("no space"), { code: "ENOSPC" });

      await expect(
        placeAcceptedCopyAtStart({ ...b.args, merge: () => Promise.reject(noSpace) }),
      ).rejects.toBe(noSpace);

      expectNothingChanged(b, old);
    });
  });

  describe("refusing the start", () => {
    it("a missing accepted.db with a differing digest refuses, changing nothing", async () => {
      const b = await box();
      const old = sha(b.live);
      rmSync(b.accepted);

      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({
        code: "handover.accepted_copy_missing",
      });

      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.note)).toBe(true);
      expect(existsSync(b.preparation)).toBe(false);
    });

    it("a missing accepted.db with the digest already equal is not a refusal: the copy is in place", async () => {
      const b = await box();
      await placeAcceptedCopyAtStart(b.args);
      rmSync(b.accepted);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({
        kind: "copy_placed_owed",
        operationId: OP,
        swapped: false,
      });
    });

    it("an accepted.db that is no longer what the indicator describes refuses, changing nothing", async () => {
      const b = await box();
      const old = sha(b.live);
      writeFileSync(b.accepted, "other bytes");

      // Failing case, no digest check: this resolves and the live file holds "other bytes".
      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({
        code: "handover.copy_mismatch",
      });

      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.note)).toBe(true);
      expect(existsSync(b.preparation)).toBe(false);
    });

    it("an accepted.db that cannot be read stays that failure, not a statement that it is missing", async () => {
      const b = await box();
      const old = sha(b.live);
      rmSync(b.accepted);
      mkdirSync(b.accepted);

      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({ code: "EISDIR" });

      expect(sha(b.live)).toBe(old);
      expect(existsSync(b.note)).toBe(true);
    });

    it("a filing_assumed row with no stored indicator is a fault, and changes nothing", async () => {
      const b = await box();
      const old = sha(b.live);
      const raw = new DatabaseSync(b.nodePath);
      raw.exec(`delete from node_handover_events where kind = '${FINAL_STATE_EVENT}'`);
      raw.close();

      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toThrow(/no stored indicator/);

      expect(sha(b.live)).toBe(old);
    });

    it("a stored indicator that does not parse changes nothing", async () => {
      const b = await box();
      const old = sha(b.live);
      const raw = new DatabaseSync(b.nodePath);
      raw.exec(
        `update node_handover_events set envelope = '{"body":{}}' where kind = '${FINAL_STATE_EVENT}'`,
      );
      raw.close();

      await expect(placeAcceptedCopyAtStart(b.args)).rejects.toMatchObject({
        code: "handover.indicator_mismatch",
      });

      expect(sha(b.live)).toBe(old);
    });
  });

  describe("acting only on a mirror", () => {
    it("another box's mirror row does not make this box a mirror", async () => {
      const b = await box({ mode: null, anotherBoxIsAMirror: true });
      const old = sha(b.live);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({
        kind: "left_alone",
        operationId: OP,
      });
      expect(sha(b.live)).toBe(old);
    });

    it.each([
      ["a selling box", "primary" as const],
      ["a box with no mode row, which reads as a sole primary", null],
    ])("leaves %s alone and logs it", async (_name, mode) => {
      const b = await box({ mode });
      const old = sha(b.live);

      const answer = await placeAcceptedCopyAtStart(b.args);

      // Failing case, placing anyway: `swapped: true`, and this digest is the replaced database's.
      expect(sha(b.live)).toBe(old);
      expect(answer).toEqual({ kind: "left_alone", operationId: OP });
      expect(existsSync(b.note)).toBe(true);
      expect(existsSync(b.preparation)).toBe(false);
      expect(existsSync(b.litestream)).toBe(true);
      expect(b.logged).toEqual([
        {
          level: "warn",
          message: "handover.place_copy.left_alone",
          detail: { operationId: OP, mode },
        },
      ]);
    });
  });

  describe("nothing to place", () => {
    it("no node.db: nothing, and no venue folder is made", async () => {
      const b = await box();
      const missing = join(scratch(), "not-yet");

      expect(await placeAcceptedCopyAtStart({ ...b.args, venueDir: missing })).toEqual({
        kind: "nothing",
      });
      expect(existsSync(missing)).toBe(false);
    });

    it("a node.db with no handover table: nothing", async () => {
      const b = await box();
      const old = sha(b.live);
      rmSync(b.nodePath);
      sqliteFile(b.nodePath, "unrelated");

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({ kind: "nothing" });
      expect(sha(b.live)).toBe(old);
    });

    it("an operation not yet at filing_assumed: nothing", async () => {
      const b = await box({ state: "copy_accepted" });
      const old = sha(b.live);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({ kind: "nothing" });
      expect(sha(b.live)).toBe(old);
    });

    it("another box's row: nothing", async () => {
      const b = await box();
      const old = sha(b.live);

      expect(await placeAcceptedCopyAtStart({ ...b.args, nodeId: OTHER_NODE })).toEqual({
        kind: "nothing",
      });
      expect(sha(b.live)).toBe(old);
    });

    it("a source operation: nothing", async () => {
      const b = await box();
      const old = sha(b.live);
      const raw = new DatabaseSync(b.nodePath);
      raw.exec("update node_handover_operations set role = 'source'");
      raw.close();

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({ kind: "nothing" });
      expect(sha(b.live)).toBe(old);
    });

    it("a copy_placed event of another box's or another operation's does not count as this one's", async () => {
      const b = await box();
      const raw = new DatabaseSync(b.nodePath);
      const insert = raw.prepare(
        "insert into node_handover_events (event_id, node_id, operation_id, kind, detail, recorded_at) values (?, ?, ?, ?, '{}', 1)",
      );
      insert.run("e1", OTHER_NODE, OP, COPY_PLACED_EVENT);
      insert.run("e2", NODE, SOURCE, COPY_PLACED_EVENT);
      raw.close();

      expect(await placeAcceptedCopyAtStart(b.args)).toMatchObject({ swapped: true });
    });
  });
});
