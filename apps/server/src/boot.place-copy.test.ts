import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { assertNotAhead } from "./node-entry.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  ACCEPTED_VERSION,
  copyPlacedEvents,
  OLD_VERSION,
  PLACE_COPY_MIGRATIONS,
  placeCopyBoxes,
  sha,
  userVersion,
  type Box,
  type StartResult,
} from "./testing/place-copy-box.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
const { beforeServerStarts, startServer } = ephemeralServerFixture();

const PLACED_LINE = "handover.place_copy.placed";
const SEEN_AFTER_PLACING = "written_after_placing";

const suite = useVenueDb({ migrations: PLACE_COPY_MIGRATIONS });
const { buildBox, entryStart, startSeams, cleanUp } = placeCopyBoxes({
  suite,
  beforeServerStarts,
  startServer,
});
const logged: string[] = [];
const realWrite = process.stdout.write.bind(process.stdout);

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanUp();
});

/** Every line boot's logger writes, which is where this file reads what a start did. */
function watchLog(): void {
  logged.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    logged.push(String(chunk));
    return realWrite(chunk);
  }) as typeof process.stdout.write);
}
const loggedLines = (word: string) => logged.filter((line) => line.includes(word)).length;

const KILL_CHILD = fileURLToPath(new URL("./testing/place-copy-kill-child.ts", import.meta.url));

function killedPlacing(b: Box, at: string): Promise<NodeJS.Signals | null> {
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), KILL_CHILD, b.venueDir, b.stateDir, b.nodeId, at],
    { stdio: "ignore" },
  );
  return new Promise((resolve) => child.once("close", (_code, signal) => resolve(signal)));
}

function withoutNodeId(b: Box): Record<string, string> {
  return Object.fromEntries(Object.entries(b.env).filter(([key]) => key !== "WAITRON_NODE_ID"));
}

function writeToPlacedDatabase(b: Box): void {
  const raw = new DatabaseSync(b.live);
  raw.exec(`create table ${SEEN_AFTER_PLACING}(a)`);
  raw.close();
}

function hasTable(path: string, name: string): boolean {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return raw.prepare("select 1 from sqlite_master where name = ?").get(name) !== undefined;
  } finally {
    raw.close();
  }
}

describe("a spare's real start at filing_assumed", () => {
  it("places the copy once, records one event and removes accepted.db; the next start places nothing", async () => {
    const b = await buildBox();
    watchLog();
    const lockFile = statSync(join(b.venueDir, "venue.lock")).ino;

    const first = await entryStart(b);
    expect(first.thrown).toBeUndefined();
    await first.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(1);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(hasTable(b.live, "old_mirror_row_in_wal")).toBe(false);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
    expect(existsSync(b.note)).toBe(false);
    expect(existsSync(join(b.venueDir, ".venue.db-litestream"))).toBe(false);
    expect(existsSync(`${b.live}.incoming`)).toBe(false);
    expect(statSync(join(b.venueDir, "venue.lock")).ino).toBe(lockFile);

    writeToPlacedDatabase(b);
    logged.length = 0;
    const second = await entryStart(b);
    expect(second.thrown).toBeUndefined();
    await second.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(0);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(hasTable(b.live, SEEN_AFTER_PLACING)).toBe(true);
    expect(statSync(join(b.venueDir, "venue.lock")).ino).toBe(lockFile);
  }, 120_000);

  // After a kill the only start is production's entry, which clears set-aside folders and opens the
  // database before the server: a `startServer` test cannot show what those do to a half-done swap.
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
    "answered",
  ])(
    "killed at %s, a real entry start finishes the placing with one event",
    async (at) => {
      const b = await buildBox();
      const acceptedBytes = sha(b.accepted);

      expect(await killedPlacing(b, at)).toBe("SIGKILL");
      expect(existsSync(b.live)).toBe(true);
      expect(sha(b.accepted)).toBe(acceptedBytes);
      expect(copyPlacedEvents(b)).toBe(0);

      const start = await entryStart(b);
      expect(start.page).toBeUndefined();
      expect(start.thrown).toBeUndefined();
      await start.started!.close();

      expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
      expect(hasTable(b.live, "old_mirror_row_in_wal")).toBe(false);
      expect(copyPlacedEvents(b)).toBe(1);
      expect(existsSync(b.accepted)).toBe(false);
      expect(existsSync(`${b.live}.incoming`)).toBe(false);
    },
    120_000,
  );

  it("swapped with no open in between: not placed again, and the event is recorded", async () => {
    const b = await buildBox();
    expect(await killedPlacing(b, "answered")).toBe("SIGKILL");
    const placedBytes = sha(b.accepted);
    expect(sha(b.live)).toBe(placedBytes);
    watchLog();

    const server = await startServer(b.env, b.env, startSeams());
    await server.close();

    expect(loggedLines(PLACED_LINE)).toBe(0);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
  }, 120_000);

  it("swapped, then opened by entry's ahead check: placed again from the kept file, one event", async () => {
    const b = await buildBox();
    expect(await killedPlacing(b, "answered")).toBe("SIGKILL");
    watchLog();

    const start = await entryStart(b);
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(1);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
  }, 120_000);

  it("the event recorded and accepted.db still there: not placed again", async () => {
    const b = await buildBox();
    const first = await entryStart(b);
    await first.started!.close();
    writeToPlacedDatabase(b);
    mkdirSync(dirname(b.accepted), { recursive: true });
    writeFileSync(b.accepted, "a leftover nothing reads");
    watchLog();

    const second = await entryStart(b);
    expect(second.thrown).toBeUndefined();
    await second.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(0);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(hasTable(b.live, SEEN_AFTER_PLACING)).toBe(true);
  }, 120_000);

  it("placing leaves no folder behind", async () => {
    const b = await buildBox();
    const start = await entryStart(b);
    expect(start.thrown).toBeUndefined();
    await start.started!.close();
    // Failing case, removing the file alone: `true`, one empty folder per handover.
    expect(existsSync(dirname(b.accepted))).toBe(false);
  }, 120_000);

  it("any later start removes a leftover accepted.db and its folder", async () => {
    const b = await buildBox();
    const first = await entryStart(b);
    await first.started!.close();
    mkdirSync(dirname(b.accepted), { recursive: true });
    writeFileSync(b.accepted, "a leftover nothing reads");

    const second = await entryStart(b);
    expect(second.thrown).toBeUndefined();
    await second.started!.close();

    // Failing case, no sweep at start: a whole venue's copy stays on the disk.
    expect(existsSync(b.accepted)).toBe(false);
    expect(existsSync(dirname(b.accepted))).toBe(false);
  }, 120_000);

  it("a leftover that cannot be removed is logged, and the start goes on", async () => {
    const b = await buildBox();
    const first = await entryStart(b);
    await first.started!.close();
    mkdirSync(join(b.accepted, "inside"), { recursive: true });
    watchLog();

    const second = await entryStart(b);
    expect(second.thrown).toBeUndefined();
    expect(second.started).toBeDefined();
    await second.started!.close();

    expect(loggedLines("handover.place_copy.remove_failed")).toBe(1);
  }, 120_000);

  it("the ahead check runs on the old file, and its close drains the old -wal, before placing", async () => {
    const b = await buildBox();
    const oldBytes = sha(b.live);
    const seen: { before?: string; walAfter?: boolean; drained?: boolean } = {};

    const start = await entryStart(b, {
      assertNotAhead: async (venueDir, migrationsRoot) => {
        seen.before = sha(b.live);
        await assertNotAhead(venueDir, migrationsRoot);
        seen.walAfter = existsSync(`${b.live}-wal`);
        seen.drained = hasTable(b.live, "old_mirror_row_in_wal");
      },
    });
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    // Placing ahead of the check prints the accepted copy's digest here.
    expect(seen.before).toBe(oldBytes);
    expect(seen.walAfter).toBe(false);
    expect(seen.drained).toBe(true);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
  }, 120_000);

  it("a box that is not a mirror is left alone: its database is not replaced", async () => {
    const b = await buildBox({ mode: "primary" });
    watchLog();
    const asked: string[] = [];

    const start = await entryStart(b, { restart: () => asked.push("restart") });
    expect(start.thrown).toBeUndefined();
    // Long enough for a first pass, which would ask at once.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await start.started!.close();

    expect(asked).toEqual([]);
    expect(userVersion(b.live)).toBe(OLD_VERSION);
    expect(existsSync(b.accepted)).toBe(true);
    expect(copyPlacedEvents(b)).toBe(0);
    expect(loggedLines("handover.place_copy.left_alone")).toBe(1);
    // The duty did not start: this is the one line a box off mirror logs instead.
    expect(loggedLines("handover-destination.not_a_mirror")).toBe(1);
    expect(loggedLines("handover-destination.")).toBe(1);
  }, 120_000);

  it("the box's identity held only in its trading file still places", async () => {
    const b = await buildBox();
    writeFileSync(join(b.stateDir, "trading.env"), `WAITRON_NODE_ID=${b.nodeId}\n`);
    const env = withoutNodeId(b);

    const start = await entryStart(b, { env });
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
  }, 120_000);

  it("a box with no identity at all reads no operation: it starts and nothing is replaced", async () => {
    const b = await buildBox();
    const env = withoutNodeId(b);

    const start = await entryStart(b, { env });
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(userVersion(b.live)).toBe(OLD_VERSION);
    expect(existsSync(b.accepted)).toBe(true);
    expect(copyPlacedEvents(b)).toBe(0);
  }, 120_000);

  it("a copy that cannot be put in place refuses the start with its own page, keeps the copy, and places on a later start", async () => {
    const b = await buildBox();
    const acceptedBytes = sha(b.accepted);
    // A folder at the incoming name: `copyFile` itself fails, on the real path a start takes.
    mkdirSync(`${b.live}.incoming`);

    let start: StartResult = {};
    for (let attempt = 0; attempt < 5 && start.page === undefined; attempt += 1) {
      start = await entryStart(b);
      if (start.page === undefined) {
        expect(start.thrown?.code).toBe("handover.placement_failed");
      }
      expect((await readRecoveryState(b.stateDir)).lastErrorCode).toBe("handover.placement_failed");
    }
    expect(start.page).toContain(
      "This box could not put the copy of the venue it accepted in place.",
    );
    expect(existsSync(b.live)).toBe(true);
    expect(sha(b.accepted)).toBe(acceptedBytes);
    expect(copyPlacedEvents(b)).toBe(0);

    rmSync(`${b.live}.incoming`, { recursive: true });
    await writeRecoveryState(b.stateDir, {
      ...(await readRecoveryState(b.stateDir)),
      level: "normal",
      failures: 0,
    });
    const later = await entryStart(b);
    expect(later.thrown).toBeUndefined();
    await later.started!.close();
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
  }, 240_000);
});

describe("a spare that takes over filing", () => {
  it("asks to restart after filing_assumed is stored, and the real start after it places the copy", async () => {
    const b = await buildBox({ state: "copy_accepted" });
    const nodeState = () => {
      const raw = new DatabaseSync(join(b.venueDir, "node.db"), { readOnly: true });
      try {
        return (
          raw.prepare("select state from node_handover_operations").get() as { state: string }
        ).state;
      } finally {
        raw.close();
      }
    };
    const restarts: string[] = [];

    const first = await entryStart(b, { restart: () => restarts.push(nodeState()) });
    expect(first.thrown).toBeUndefined();
    await vi.waitFor(() => expect(restarts[0]).toBe("filing_assumed"), { timeout: 20_000 });
    expect(b.old.posts).toHaveLength(1);
    expect(userVersion(b.live)).not.toBe(ACCEPTED_VERSION);
    await first.started!.close();

    const second = await entryStart(b, { restart: () => restarts.push("a second restart") });
    expect(second.thrown).toBeUndefined();
    // Long enough for the duty's first pass, which must find no work at filing_assumed.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await second.started!.close();

    expect(restarts).not.toContain("a second restart");
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
  }, 180_000);

  it("a restart lost as a signal is lost is asked for again on the real start's own tick", async () => {
    const b = await buildBox({ state: "copy_accepted" });
    let asked = 0;

    const start = await entryStart(b, { restart: () => (asked += 1) });
    expect(start.thrown).toBeUndefined();
    // Failing case, the review's: `asked` stays at 1 and the box sits on its old file for good.
    await vi.waitFor(() => expect(asked).toBeGreaterThanOrEqual(2), { timeout: 20_000 });
    await start.started!.close();

    expect(userVersion(b.live)).toBe(OLD_VERSION);
    expect(copyPlacedEvents(b)).toBe(0);
    expect(b.old.posts).toHaveLength(1);
  }, 120_000);

  it("whenever the old box answers, an ask comes after the shutdown handlers are in", async () => {
    const b = await buildBox({ state: "copy_accepted" });
    const order: string[] = [];

    const start = await entryStart(b, {
      restart: () => order.push("asked"),
      installShutdownHandlers: () => order.push("handlers in"),
    });
    expect(start.thrown).toBeUndefined();
    await vi.waitFor(
      () => expect(order.lastIndexOf("asked")).toBeGreaterThan(order.indexOf("handlers in")),
      { timeout: 20_000 },
    );
    expect(order).toContain("handlers in");
    await start.started!.close();
  }, 120_000);
});
