// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_START_AGAIN names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { realpathSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SPARE_SPACE_FILE, openImmutable } from "@waitron/provisioning";
import { heldSetup } from "../test/held-setup-database.js";
import { foreignHotJournal } from "../test/foreign-journal.js";
import {
  diskSnapshot,
  expectStartAgainDeleted,
  startAgainUnchanged,
} from "../test/start-again-deleted.js";
import "./testing/hour-test-clock.js";
import { loadBoxEnv } from "./box-env.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { runEntry } from "./node-entry.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";
import { SPARE_SPACE_BYTES } from "./spare-space.js";

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

// Runs after useVenueDb's own beforeAll, registered when the fixture is imported, so the suite's
// database stays off the small disk and only each case's folders land on it.
beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_START_AGAIN", 32);
  if (!opened.ok) {
    if (!REQUIRE_FULL_DISK) console.warn(`start-again-full-disk tests SKIPPED: ${opened.reason}`);
    return;
  }
  disk = opened.disk;
  vi.stubEnv("TMPDIR", realpathSync(disk.folder("tmp")));
});
afterEach(() => disk?.unfill());
afterAll(() => {
  vi.unstubAllEnvs();
  disk?.close();
});

function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

const sockets: TLSSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

const ROUTE = "https://box.test/setup-api/first-setup/resolution";

/** The folders `runEntry` hands first-setup resolution when it is given no log folder. */
const spareOption = (roots: { stateDir: string; venueDir: string }) => ({
  stateDir: roots.stateDir,
  venueDir: roots.venueDir,
  logDir: join(roots.stateDir, "logs"),
});

type Inspection = { inspectionId: string; revision: number; ownerGeneration: number };

it("in the held state, on a full disk with the box's spare file, the spare is not released, and the summary and Start again answer 507 storage.disk_full, deleting nothing", async (ctx) => {
  const small = needDisk(ctx);
  const f = await heldSetup();
  expect(realpathSync(f.roots.venueDir).startsWith(`${process.env.TMPDIR}/`)).toBe(true);
  const spare = join(f.roots.stateDir, SPARE_SPACE_FILE);
  await writeFile(spare, Buffer.alloc(SPARE_SPACE_BYTES, 1));
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    spareOption(f.roots),
  );
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  small.fill();
  expect(small.free()).toBeLessThan(65_536);
  const inspected = (await (await entry.app.request(ROUTE, {}, tls())).json()) as Inspection;
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const before = await diskSnapshot(f.roots);
  const send = (path: string) =>
    entry.app.request(
      `${ROUTE}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      },
      tls(),
    );
  for (const path of ["/start-again/summary", "/start-again"]) {
    const answer = await send(path);
    expect(answer.status, path).toBe(507);
    expect(await answer.json()).toMatchObject({ error: { code: "storage.disk_full" } });
  }
  expect(await diskSnapshot(f.roots)).toEqual(before);
  expect((await stat(spare)).size).toBe(SPARE_SPACE_BYTES);
});

describe("on a full disk, a restart", () => {
  async function restart(roots: { stateDir: string; venueDir: string }) {
    const served: Hono[] = [];
    const log = vi.fn();
    await runEntry({
      args: [],
      baseEnv: { WAITRON_ENV: "preproduction", WAITRON_HTTP_LANDING_PORT: "0" },
      stateDir: roots.stateDir,
      venueDir: roots.venueDir,
      loadBoxEnv,
      readRecoveryState,
      writeRecoveryState,
      startServer: () => Promise.reject(new Error("a held setup must not start the server")),
      serveRecovery: async (app) => {
        served.push(app);
      },
      installShutdownHandlers: () => {},
      scheduleStayedUp: () => {},
      log,
      exit: () => {},
    });
    expect(served).toHaveLength(1);
    return { app: served[0]!, events: log.mock.calls.map((call) => call[1] as string), log };
  }

  it("with the box's spare file, releases it and serves the repair page, whose summary and Start again finish", async (ctx) => {
    const small = needDisk(ctx);
    const f = await heldSetup();
    await writeRecoveryState(f.roots.stateDir, FRESH);
    await writeFile(join(f.roots.stateDir, SPARE_SPACE_FILE), Buffer.alloc(SPARE_SPACE_BYTES, 1));
    small.fill(0);
    expect(small.free()).toBeLessThan(65_536);

    const { app, events } = await restart(f.roots);

    expect(events).toContain("storage.spare_released");
    const status = await app.request("/setup-api/status", {}, tls());
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ needs: ["first-setup-resolution"] });
    const inspected = (await (await app.request(ROUTE, {}, tls())).json()) as Inspection;
    const body = JSON.stringify({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    });
    for (const path of ["/start-again/summary", "/start-again"]) {
      const answer = await app.request(
        `${ROUTE}${path}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body },
        tls(),
      );
      expect(answer.status, `${path}: ${await answer.clone().text()}`).toBe(200);
    }
    await expectStartAgainDeleted(f.roots);
    expect(
      (await readdir(f.roots.venueDir)).filter((name) => !/^venue\.(lock|holder)/.test(name)),
    ).toEqual([]);
  });

  /** A crashed setup restarted on a full disk with the box's spare file, and the repair page. */
  async function crashedOnFullDisk(
    small: SmallDisk,
    crash: NonNullable<Parameters<typeof heldSetup>[0]>["crash"],
  ) {
    const f = await heldSetup({ crash });
    await writeRecoveryState(f.roots.stateDir, FRESH);
    const spare = join(f.roots.stateDir, SPARE_SPACE_FILE);
    await writeFile(spare, Buffer.alloc(SPARE_SPACE_BYTES, 1));
    small.fill(0);
    expect(small.free()).toBeLessThan(65_536);
    const { app, events } = await restart(f.roots);
    expect(events).toContain("storage.spare_released");
    await expect(stat(spare)).rejects.toMatchObject({ code: "ENOENT" });
    const inspected = (await (await app.request(ROUTE, {}, tls())).json()) as Inspection;
    const body = JSON.stringify({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    });
    const ask = (path: string) =>
      app.request(
        `${ROUTE}${path}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body },
        tls(),
      );
    return { f, ask };
  }

  // The read needs no disk space that grows with the database: a copy of these files (about
  // 10 MiB) does not fit in the 8 MiB the spare gives back (A1379 P2-5).
  it("with the box's spare file, the summary of a crashed setup database of about 10 MiB answers and leaves its folder unchanged, and Start again finishes", async (ctx) => {
    const small = needDisk(ctx);
    const { f, ask } = await crashedOnFullDisk(small, {
      databaseBytes: 2_850_000,
      walBytes: 3_000_000,
    });
    const venue = join(f.roots.venueDir, "venue.db");
    const sizes = await Promise.all(
      ["", "-wal", "-shm"].map(async (suffix) => (await stat(`${venue}${suffix}`)).size),
    );
    expect(sizes.reduce((a, b) => a + b)).toBeGreaterThan(9.5 * 1024 * 1024);
    // Taken after the restart, which can itself write the -shm.
    const before = (await diskSnapshot(f.roots)).venue;
    const summary = await ask("/start-again/summary");
    expect(summary.status, await summary.clone().text()).toBe(200);
    expect((await diskSnapshot(f.roots)).venue).toEqual(before);
    const startAgain = await ask("/start-again");
    expect(startAgain.status, await startAgain.clone().text()).toBe(200);
    await expectStartAgainDeleted(f.roots);
    expect(
      (await readdir(f.roots.venueDir)).filter((name) => !/^venue\.(lock|holder)/.test(name)),
    ).toEqual([]);
  });

  it("with the box's spare file, refuses the summary and Start again kept-records for a crashed setup database whose invoice is only in the -wal, and its folder is unchanged afterwards", async (ctx) => {
    const small = needDisk(ctx);
    const { f, ask } = await crashedOnFullDisk(small, { walBytes: 100_000, invoices: 1 });
    const venue = join(f.roots.venueDir, "venue.db");
    const mainFileAlone = openImmutable(venue);
    try {
      expect(
        mainFileAlone.prepare("select count(*) as n from registros_facturacion").get(),
      ).toEqual({ n: 0 });
    } finally {
      mainFileAlone.close();
    }
    const before = await diskSnapshot(f.roots);
    const unchanged = await startAgainUnchanged(f.roots);
    for (const path of ["/start-again/summary", "/start-again"]) {
      const answer = await ask(path);
      expect(answer.status, path).toBe(409);
      expect(await answer.json()).toEqual({
        error: { code: "setup.start_again_refused", params: { cause: "kept-records" } },
      });
    }
    await unchanged();
    expect((await diskSnapshot(f.roots)).venue).toEqual(before.venue);
  });

  it("without a spare file, serves the full-disk recovery page and no setup routes", async (ctx) => {
    const small = needDisk(ctx);
    const f = await heldSetup();
    await writeRecoveryState(f.roots.stateDir, FRESH);
    small.fill(0);
    expect(small.free()).toBeLessThan(65_536);

    const { app, events } = await restart(f.roots);

    expect(events).not.toContain("storage.spare_released");
    expect(events).toContain("recovery.serving_disk_full");
    const page = await (await app.request("/", {}, tls())).text();
    expect(page).toContain("The box&#39;s disk is full, so Waitron cannot save anything.");
    expect((await app.request("/setup-api/status", {}, tls())).status).toBe(404);
    expect((await app.request(ROUTE, {}, tls())).status).toBe(404);
  });
});

it("in the held state, a setup database read through a private copy on a full disk answers the summary 507 storage.disk_full, deleting nothing", async (ctx) => {
  const small = needDisk(ctx);
  // A -journal beside the database sends the read through a private copy in TMPDIR, on the small
  // disk.
  const f = await heldSetup();
  foreignHotJournal(join(f.roots.venueDir, "venue.db-journal"), "rolls-back");
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    spareOption(f.roots),
  );
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  const inspected = (await (await entry.app.request(ROUTE, {}, tls())).json()) as Inspection;
  // Room for SQLite's own side files but not for the copy: with none at all the inspection's open
  // fails first, and that is already answered as a full disk.
  small.fill(1024 * 1024);
  expect(small.free()).toBeLessThan((await stat(join(f.roots.venueDir, "venue.db"))).size);
  const before = await diskSnapshot(f.roots);
  const answer = await entry.app.request(
    `${ROUTE}/start-again/summary`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionId: inspected.inspectionId,
        revision: inspected.revision,
        ownerGeneration: inspected.ownerGeneration,
      }),
    },
    tls(),
  );
  expect(answer.status, await answer.clone().text()).toBe(507);
  expect(await answer.json()).toMatchObject({ error: { code: "storage.disk_full" } });
  expect(await diskSnapshot(f.roots)).toEqual(before);
});
