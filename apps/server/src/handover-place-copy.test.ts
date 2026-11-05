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
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  lockVenueDatabase,
  openVenueDatabase,
  withNodeTransaction,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { signIndicator, type HandoverBinding, type NodeLocalItem } from "@waitron/handover";
import { generateNodeKeyPair } from "@waitron/membership";
import {
  appendHandoverEventTx,
  NODE_MIGRATIONS,
  readHandoverEvent,
  readHandoverOperation,
  setNodeModeTx,
} from "@waitron/node-db";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { FINAL_STATE_EVENT } from "./handover-capture.js";
import { classifyStartFailure } from "./boot-failure.js";
import {
  COPY_PLACED_EVENT,
  placeAcceptedCopyAtStart,
  placeAcceptedCopyForStart,
  recordCopyPlaced,
  removePlacedCopies,
  type PlacementSteps,
} from "./handover-place-copy.js";
import { advanceHandover, beginHandover, waitHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";

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

/** The chart's table as the real migration has the columns placing reads, holding `document`. */
function holdChart(databasePath: string, document: unknown): void {
  const raw = new DatabaseSync(databasePath);
  try {
    raw.exec("create table if not exists node_membership(id integer primary key, document text)");
    raw
      .prepare("insert or replace into node_membership(id, document) values (1, ?)")
      .run(typeof document === "string" ? document : JSON.stringify(document));
  } finally {
    raw.close();
  }
}

const chartWith = (term: number, standing: string, others: object[] = []) => ({
  body: {
    term,
    nodes: [
      { nodeId: SOURCE, contactUrl: "https://old.example", standing },
      { nodeId: NODE, contactUrl: "https://spare.example", standing: "serving-secondary" },
      ...others,
    ],
  },
  signerNodeId: SOURCE,
  signature: "s",
  endorsements: [],
});
const THIRD = {
  nodeId: OTHER_NODE,
  contactUrl: "https://third.example",
  standing: "serving-primary",
};
const NAMES_OLD_BOX = chartWith(3, "serving-primary");
const MOVED_ON = chartWith(4, "sell-only", [THIRD]);

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

  async function recordIndicator(
    sha256: string,
    bytes: number,
    withRevision: boolean,
  ): Promise<void> {
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
        snapshot: { sha256, bytes, schema: [], modules: [] },
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
      /** The chart the accepted copy holds. */
      acceptedChart?: unknown;
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
    if (options.acceptedChart !== undefined) holdChart(accepted, options.acceptedChart);
    const live = join(venueDir, "venue.db");
    sqliteFile(live, "old_mirror");
    writeFileSync(`${live}-wal`, "stale wal");
    writeFileSync(`${live}-shm`, "stale shm");
    mkdirSync(join(venueDir, ".venue.db-litestream"));
    writeFileSync(join(venueDir, ".venue.db-litestream", "generation"), "old");
    writeFileSync(join(stateDir, NOTE), "{}");

    const { mode = "mirror", state = "filing_assumed", withRevision = true } = options;
    await beginHandover(storeDeps(), BINDING, "destination");
    await recordIndicator(sha(accepted), statSync(accepted).size, withRevision);
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

  describe("as a start runs it", () => {
    const failing = (code: string) => Object.assign(new Error("refused"), { code });

    it("a failed file step becomes handover.placement_failed, naming the failure in the log", async () => {
      const b = await box();

      await expect(
        placeAcceptedCopyForStart({
          ...b.args,
          fs: { rename: () => Promise.reject(failing("EIO")) },
        }),
      ).rejects.toMatchObject({ code: "handover.placement_failed", params: { errno: "EIO" } });

      expect(b.logged).toContainEqual({
        level: "error",
        message: "handover.place_copy.failed",
        detail: { errno: "EIO", reason: "refused" },
      });
      expect(existsSync(b.accepted)).toBe(true);
    });

    it("a folder at the incoming name reports the copy's own failure, not the failed tidy-up", async () => {
      const b = await box();
      mkdirSync(b.incoming);

      const error = await placeAcceptedCopyForStart(b.args).catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({
        code: "handover.placement_failed",
        params: { errno: "EISDIR" },
      });
      expect((error as { reason?: string }).reason).toContain("copyfile");
      expect(existsSync(b.accepted)).toBe(true);
    });

    it.each([
      ["copying", { fs: { copyFile: () => Promise.reject(failing("ENOSPC")) } }],
      ["merging the selections", { merge: () => Promise.reject(failing("ENOSPC")) }],
    ])(
      "ENOSPC while %s refuses with handover.placement_no_room, naming the bytes, whatever the disk reads after",
      async (_step, change) => {
        const b = await box();

        const error = await placeAcceptedCopyForStart({ ...b.args, ...change }).catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({
          code: "handover.placement_no_room",
          params: { neededBytes: statSync(b.accepted).size },
        });
        // Failing case: `unknown` on the second, whose disk has room once the partial copy is gone.
        expect(classifyStartFailure(error, 1024)).toBe("handover.placement_no_room");
        expect(classifyStartFailure(error, 20 * 1024 * 1024)).toBe("handover.placement_no_room");
        expect(b.logged).toContainEqual({
          level: "error",
          message: "handover.place_copy.no_room",
          detail: { neededBytes: statSync(b.accepted).size },
        });
        expect(existsSync(b.accepted)).toBe(true);
      },
    );

    it("ENOSPC with no copy to make stays itself, for the start's own check of a full disk", async () => {
      const b = await box();
      copyFileSync(b.accepted, b.live);

      const error = await placeAcceptedCopyForStart({
        ...b.args,
        fs: { reachDisk: () => Promise.reject(failing("ENOSPC")) },
      }).catch((caught: unknown) => caught);

      // Failing case, every ENOSPC converted: `handover.placement_no_room`, for no copy at all.
      expect(classifyStartFailure(error, 1024)).toBe("storage.disk_full");
    });

    it("a node.db that cannot be read stays that failure: no copy was reached", async () => {
      const b = await box();
      writeFileSync(b.nodePath, "this is not a database, and is long enough to be read as one");

      const error = await placeAcceptedCopyForStart(b.args).catch((caught: unknown) => caught);

      expect((error as { code?: string }).code).toBe("ERR_SQLITE_ERROR");
      expect(existsSync(b.accepted)).toBe(true);
    });

    it("a coded refusal stays itself", async () => {
      const b = await box();
      rmSync(b.accepted);

      await expect(placeAcceptedCopyForStart(b.args)).rejects.toMatchObject({
        code: "handover.accepted_copy_missing",
      });
    });

    it("recording writes the event with the writer's own shape, then removes accepted.db", async () => {
      const b = await box();
      const answer = await placeAcceptedCopyForStart(b.args);
      expect(answer).toMatchObject({ kind: "copy_placed_owed" });

      await recordCopyPlaced({
        node: suite.node,
        nodeId: NODE,
        stateDir: b.stateDir,
        operationId: OP,
        log: b.args.log,
      });

      expect(await readHandoverEvent(suite.node, NODE, OP, COPY_PLACED_EVENT)).toMatchObject({
        detail: {},
        envelope: null,
      });
      expect(existsSync(b.accepted)).toBe(false);
    });

    it("an event that cannot be written leaves accepted.db, which a repeat places from", async () => {
      const b = await box();

      await expect(
        recordCopyPlaced({
          node: {} as NodeDatabase,
          nodeId: NODE,
          stateDir: b.stateDir,
          operationId: OP,
          log: b.args.log,
        }),
      ).rejects.toThrow();

      expect(existsSync(b.accepted)).toBe(true);
    });

    it("an accepted.db already gone is no failure", async () => {
      const b = await box();
      rmSync(b.accepted);

      await recordCopyPlaced({
        node: suite.node,
        nodeId: NODE,
        stateDir: b.stateDir,
        operationId: OP,
        log: b.args.log,
      });

      expect(b.logged).toEqual([]);
      expect(await readHandoverEvent(suite.node, NODE, OP, COPY_PLACED_EVENT)).not.toBeNull();
    });

    it("a removal that fails is logged and the start goes on, with the event recorded", async () => {
      const b = await box();
      // A folder with something in it is what `rm` without `recursive` refuses, as root too.
      rmSync(b.accepted);
      mkdirSync(join(b.accepted, "inside"), { recursive: true });

      await recordCopyPlaced({
        node: suite.node,
        nodeId: NODE,
        stateDir: b.stateDir,
        operationId: OP,
        log: b.args.log,
      });

      expect(b.logged.map((line) => line.message)).toEqual(["handover.place_copy.remove_failed"]);
      expect(await readHandoverEvent(suite.node, NODE, OP, COPY_PLACED_EVENT)).not.toBeNull();
    });
  });

  describe("what placing leaves behind", () => {
    const record = (b: Awaited<ReturnType<typeof box>>) =>
      recordCopyPlaced({
        node: suite.node,
        nodeId: NODE,
        stateDir: b.stateDir,
        operationId: OP,
        log: b.args.log,
      });
    const sweep = (b: { stateDir: string; args: { log: Logger } }, node = suite.node) =>
      removePlacedCopies({ node, nodeId: NODE, stateDir: b.stateDir, log: b.args.log });
    const folderOf = (b: { accepted: string }) => dirname(b.accepted);
    const recordEventOnly = () =>
      withNodeTransaction(suite.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP,
          kind: COPY_PLACED_EVENT,
          detail: {},
          envelope: null,
        }),
      );

    it("recording removes the operation's folder along with accepted.db", async () => {
      const b = await box();
      await record(b);
      // Failing case, removing the file alone: an empty folder per handover, for ever.
      expect(existsSync(folderOf(b))).toBe(false);
      expect(b.logged).toEqual([]);
    });

    it("a crash after the event leaves a copy the next start removes, folder and all", async () => {
      const b = await box();
      await recordEventOnly();

      await sweep(b);

      // Failing case, no sweep: a whole venue's copy on the disk, with nothing to remove it.
      expect(existsSync(b.accepted)).toBe(false);
      expect(existsSync(folderOf(b))).toBe(false);
      expect(b.logged).toEqual([]);
    });

    it("finds the event at any later state of the operation", async () => {
      const b = await box();
      await recordEventOnly();
      await advanceHandover(storeDeps(), OP, "activated", {});

      await sweep(b);

      expect(existsSync(folderOf(b))).toBe(false);
    });

    it("an operation not yet placed keeps its copy", async () => {
      const b = await box();

      await sweep(b);

      // Failing case, not reading the event: the copy a repeat of placing needs is gone.
      expect(existsSync(b.accepted)).toBe(true);
      expect(b.logged).toEqual([]);
    });

    it("a file that is not the copy keeps its folder and is left alone, with nothing logged", async () => {
      const b = await box();
      await recordEventOnly();
      const other = join(folderOf(b), "return-1.json");
      writeFileSync(other, "{}");

      await sweep(b);

      expect(existsSync(b.accepted)).toBe(false);
      expect(readFileSync(other, "utf8")).toBe("{}");
      expect(b.logged).toEqual([]);
    });

    it("a folder this box's source role keeps, or that no operation names, is left alone", async () => {
      const stateDir = scratch();
      const source = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      await beginHandover(storeDeps(), { ...BINDING, operationId: source }, "source");
      await withNodeTransaction(suite.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: source,
          kind: COPY_PLACED_EVENT,
          detail: {},
          envelope: null,
        }),
      );
      const logged: unknown[] = [];
      const kept = [source, "not-an-operation"].map((name) => join(stateDir, "handover", name));
      for (const folder of kept) mkdirSync(folder, { recursive: true });

      await sweep({ stateDir, args: { log: (...line) => logged.push(line) } });

      expect(kept.map((folder) => existsSync(folder))).toEqual([true, true]);
      expect(logged).toEqual([]);
    });

    it("no handover folder at all is no failure", async () => {
      const logged: unknown[] = [];
      await sweep({ stateDir: scratch(), args: { log: (...line) => logged.push(line) } });
      expect(logged).toEqual([]);
    });

    it("a removal that fails is logged and does not stop the start", async () => {
      const b = await box();
      await recordEventOnly();
      rmSync(b.accepted);
      mkdirSync(join(b.accepted, "inside"), { recursive: true });

      await sweep(b);

      expect(b.logged).toEqual([
        expect.objectContaining({
          level: "error",
          message: "handover.place_copy.remove_failed",
          detail: expect.objectContaining({ operationId: OP }) as unknown,
        }),
      ]);
    });

    it("a node.db that cannot answer is logged and does not stop the start", async () => {
      const b = await box();
      const closed = await openVenueDatabase(b.venueDir);
      await closed.close();

      await sweep(b, closed.node);

      expect(b.logged.map((line) => line.message)).toEqual(["handover.place_copy.sweep_failed"]);
      expect(existsSync(b.accepted)).toBe(true);
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

  describe("a chart the old file holds", () => {
    const UNREADABLE = "handover.place_copy.old_chart_unreadable";
    const SWAPPED = { kind: "copy_placed_owed", operationId: OP, swapped: true };
    const REFUSED = { kind: "source_no_longer_main", operationId: OP };

    function everyFile(b: Awaited<ReturnType<typeof box>>) {
      return {
        live: sha(b.live),
        wal: existsSync(`${b.live}-wal`) ? sha(`${b.live}-wal`) : null,
        accepted: sha(b.accepted),
        note: existsSync(b.note),
        litestream: existsSync(b.litestream),
        preparation: existsSync(b.preparation),
        incoming: existsSync(b.incoming),
        node: sha(b.nodePath),
      };
    }

    it.each([
      ["the old box sell-only and a third box main", MOVED_ON],
      ["the old box evicted", chartWith(4, "evicted", [THIRD])],
      [
        "the old box gone from it",
        { ...MOVED_ON, body: { term: 4, nodes: MOVED_ON.body.nodes.slice(1) } },
      ],
    ])("%s: refused, with nothing written", async (_name, chart) => {
      const b = await box({ acceptedChart: NAMES_OLD_BOX });
      holdChart(b.live, chart);
      const before = everyFile(b);

      // Failing case, the check deleted: `swapped: true`, and this chart is gone for good.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);

      expect(everyFile(b)).toEqual(before);
      expect(b.logged).toEqual([
        {
          level: "warn",
          message: "handover.place_copy.source_no_longer_main",
          detail: { operationId: OP },
        },
      ]);
    });

    it("sees a chart held only in the old file's -wal, and leaves that -wal as it found it", async () => {
      const b = await box();
      holdChart(b.live, NAMES_OLD_BOX);
      realOldWal(
        b.live,
        `update node_membership set document = '${JSON.stringify(MOVED_ON)}' where id = 1`,
      );
      const before = everyFile(b);
      expect(readFileSync(b.live).includes("sell-only")).toBe(false);

      // Failing case, reading the main file alone: `swapped: true`, as the chart is not in it.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);
      expect(everyFile(b)).toEqual(before);
    });

    it("sees it too with no -shm beside the -wal", async () => {
      const b = await box();
      holdChart(b.live, NAMES_OLD_BOX);
      realOldWal(
        b.live,
        `update node_membership set document = '${JSON.stringify(MOVED_ON)}' where id = 1`,
      );
      rmSync(`${b.live}-shm`);
      const wal = sha(`${b.live}-wal`);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);
      expect(sha(`${b.live}-wal`)).toBe(wal);
    });

    it("a box that is not a mirror is left alone, whatever its chart says", async () => {
      const b = await box({ mode: "primary" });
      holdChart(b.live, MOVED_ON);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual({
        kind: "left_alone",
        operationId: OP,
      });
    });

    it("a repeat answers the same, with no copy left to read as well", async () => {
      const b = await box();
      holdChart(b.live, MOVED_ON);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);
      rmSync(b.accepted);
      // Failing case, looking for the copy first: refuses the start `accepted_copy_missing`.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);
    });

    it("a selection the old box kept is not merged, and the backup-room note stays", async () => {
      const b = await box();
      holdChart(b.live, MOVED_ON);
      let merged = 0;

      await placeAcceptedCopyAtStart({
        ...b.args,
        merge: async () => {
          merged += 1;
        },
      });

      expect(merged).toBe(0);
      expect(existsSync(b.note)).toBe(true);
    });

    it.each([
      "copy",
      "chmod",
      "flush-incoming",
      "litestream",
      "wal",
      "shm",
      "flush-before-rename",
      "rename",
      "flush-after-rename",
    ])("a kill set for %s is never reached: no file step runs", async (step) => {
      const b = await box();
      holdChart(b.live, MOVED_ON);
      const before = everyFile(b);

      const ran = await killedPlacing(b, step);

      // Failing case, a step run before the check: `SIGKILL`.
      expect(ran.signal, ran.output).toBeNull();
      expect(everyFile(b)).toEqual(before);
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(REFUSED);
    });

    it("a newer chart still naming the old box the main box places", async () => {
      const b = await box();
      holdChart(b.live, chartWith(9, "serving-primary"));

      // Failing case, judging by term: refused, where the rule is the standing.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(b.logged.filter((line) => line.level !== "info")).toEqual([]);
    });

    it("no chart table, as a database never given one has none: places, with no warning", async () => {
      const b = await box();

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(b.logged.filter((line) => line.level !== "info")).toEqual([]);
    });

    it.each([
      ["no row", "delete from node_membership"],
      ["a row holding the JSON value null", "update node_membership set document = 'null'"],
    ])("%s: places, with no warning", async (_name, change) => {
      const b = await box();
      holdChart(b.live, NAMES_OLD_BOX);
      const raw = new DatabaseSync(b.live);
      raw.exec(change);
      raw.close();

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(b.logged.filter((line) => line.level !== "info")).toEqual([]);
    });

    it("no old file at all: places, with no warning", async () => {
      const b = await box();
      rmSync(b.live);

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(b.logged.filter((line) => line.level !== "info")).toEqual([]);
    });

    it.each([
      ["text that is not JSON", "not json"],
      ["JSON that is no chart", '{"body":1}'],
      ["a chart whose list is broken", '{"body":{"term":4,"nodes":[{"nodeId":1}]}}'],
    ])("%s: places, and says so in the log", async (_name, document) => {
      const b = await box();
      holdChart(b.live, document);

      // Failing case, letting the read's failure out: the start stops with the old box stopped too.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(b.logged.map((line) => line.message)).toContain(UNREADABLE);
    });

    it("an old file that is not a database: places, and says so in the log", async () => {
      const b = await box();
      writeFileSync(b.live, "not a database, and long enough to have a header to read at all");

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(b.logged.map((line) => line.message)).toContain(UNREADABLE);
      expect(tableNames(b.live)).toContain("placed");
    });

    it("after a crash and an open, the placed file's own chart is not a moved-on chart", async () => {
      const b = await box({ acceptedChart: MOVED_ON });
      holdChart(b.live, NAMES_OLD_BOX);
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      // Any open changes the bytes, as entry's ahead check does.
      const raw = new DatabaseSync(b.live);
      raw.exec("create table written_by_an_open(a)");
      raw.close();
      expect(sha(b.live)).not.toBe(sha(b.accepted));

      // Failing case, judging the chart alone: refused, on a file this box already placed.
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(sha(b.live)).toBe(sha(b.accepted));
    });

    it("the same after a crash when the copy's chart names the old box: placed again", async () => {
      const b = await box({ acceptedChart: NAMES_OLD_BOX });
      holdChart(b.live, NAMES_OLD_BOX);
      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      const raw = new DatabaseSync(b.live);
      raw.exec("create table written_by_an_open(a)");
      raw.close();

      expect(await placeAcceptedCopyAtStart(b.args)).toEqual(SWAPPED);
      expect(sha(b.live)).toBe(sha(b.accepted));
    });

    it("recording copy_placed clears a wait left from before", async () => {
      const b = await box();
      await waitHandover(storeDeps(), OP, "handover.source_no_longer_main");
      const accepted = b.args.stateDir;

      await recordCopyPlaced({
        node: suite.node,
        nodeId: NODE,
        stateDir: accepted,
        operationId: OP,
        log: b.args.log,
      });

      const row = await readHandoverOperation(suite.node, NODE, OP);
      // Failing case, recording the event alone: the old reason stays beside a placed copy.
      expect(row).toMatchObject({ state: "filing_assumed", waitingReason: null });
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
