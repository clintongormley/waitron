import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { ensureBoxSecrets } from "./box-secrets.js";
import { loadBoxEnv } from "./box-env.js";
import { runEntry, serveRecovery, type RecoveryServeOptions } from "./node-entry.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { escapeHtml } from "./recovery-surface.js";
import { freePorts } from "./testing/free-ports.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";

const FLOOR = 8 * 1024 * 1024;
const TITLE = escapeHtml("The box's disk is full, so Waitron cannot save anything.");
const DELETED = escapeHtml(
  "The box has deleted what it could make again, and that was not enough.",
);

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

beforeAll(() => {
  opened = openSmallDisk();
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK) console.warn(`start-full-disk tests SKIPPED: ${opened.reason}`);
});
afterEach(() => disk?.unfill());
afterAll(() => disk?.close());

/** The small disk, or the case is skipped (or fails where the disk is required). */
function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

type StartServer = (env: NodeJS.ProcessEnv) => Promise<{ close(): Promise<void> }>;

function entryDeps(stateDir: string, over: Partial<Parameters<typeof runEntry>[0]> = {}) {
  const venueDir = join(stateDir, "venue");
  return {
    args: [] as readonly string[],
    baseEnv: { WAITRON_HTTP_LANDING_PORT: "0" } as NodeJS.ProcessEnv,
    stateDir,
    venueDir,
    assertNotAhead: (dir: string) => openVenueDatabase(dir).then((store) => store.close()),
    loadBoxEnv,
    readRecoveryState,
    writeRecoveryState,
    // Proof the database is usable: a table created and a row written.
    startServer: vi.fn<StartServer>(async () => {
      const store = await openVenueDatabase(venueDir);
      try {
        store.venue.run(sql`create table if not exists start_probe (id integer primary key)`);
        store.venue.run(sql`insert into start_probe default values`);
      } finally {
        await store.close();
      }
      return { close: () => Promise.resolve() };
    }),
    serveRecovery: vi.fn<(app: Hono, opts: RecoveryServeOptions) => Promise<unknown>>(() =>
      Promise.resolve(),
    ),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    exit: vi.fn(),
    freeSpaceFloor: FLOOR,
    ...over,
  };
}

/** A state folder on the small disk that one earlier start with room has used. */
async function startedBefore(small: SmallDisk, name: string): Promise<string> {
  const stateDir = realpathSync(small.folder(name));
  mkdirSync(join(stateDir, "venue"));
  await writeRecoveryState(stateDir, FRESH);
  const setup = entryDeps(stateDir);
  await runEntry(setup);
  expect(setup.startServer).toHaveBeenCalledTimes(1);
  return stateDir;
}

const inodeOf = (path: string) => statSync(path).ino;

function pageOver(port: number, ca: Buffer): Promise<{ status?: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpsGet({ host: "127.0.0.1", port, path: "/", ca, servername: "localhost" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

describe("a start on a real full disk", () => {
  it("a start whose leftovers free enough counts itself and boots", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "leftovers");
    const logs = join(stateDir, "logs");
    for (let i = 1; i <= 5; i += 1)
      writeFileSync(join(logs, `waitron.log.${i}`), Buffer.alloc(512 * 1024, 65));
    mkdirSync(join(logs, "crash-reports"));
    const crash = join(logs, "crash-reports", "holder-frozen-old.json");
    writeFileSync(crash, "{}");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(crash, eightDaysAgo, eightDaysAgo);
    mkdirSync(join(stateDir, "backup-staging"));
    writeFileSync(join(stateDir, "backup-staging", "x.dump"), Buffer.alloc(2 * 1024 * 1024, 66));
    const recoveryLock = join(stateDir, "recovery.lock");
    const venueLock = join(stateDir, "venue", "venue.lock");
    const inodes = [inodeOf(recoveryLock), inodeOf(venueLock)];

    small.fill();
    expect(small.free()).toBeLessThan(65_536);

    const d = entryDeps(stateDir);
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(d.serveRecovery).not.toHaveBeenCalled();
    for (let i = 2; i <= 5; i += 1)
      expect(() => statSync(join(logs, `waitron.log.${i}`))).toThrow();
    expect(() => statSync(crash)).toThrow();
    expect(() => statSync(join(stateDir, "backup-staging", "x.dump"))).toThrow();
    expect(statSync(join(logs, "waitron.log.1")).size).toBe(512 * 1024);
    // The setup start counted one, and its stayed-up clear is a stub that never fires.
    expect((await readRecoveryState(stateDir)).failures).toBe(2);
    expect([inodeOf(recoveryLock), inodeOf(venueLock)]).toEqual(inodes);
  });

  let nothingDir: string | undefined;

  it("a start with nothing to delete serves the recovery page at once", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "nothing");
    nothingDir = stateDir;
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    const ca = readFileSync(join(stateDir, "tls", "ca.crt"));
    const recoveryLock = join(stateDir, "recovery.lock");
    const venueLock = join(stateDir, "venue", "venue.lock");
    const inodes = [inodeOf(recoveryLock), inodeOf(venueLock)];
    small.fill();
    expect(small.free()).toBeLessThan(65_536);
    const stateBytes = readFileSync(join(stateDir, "recovery.json"));

    const [port] = await freePorts(1);
    let served: Awaited<ReturnType<typeof serveRecovery>> | undefined;
    const d = entryDeps(stateDir, {
      baseEnv: { WAITRON_HTTP_LANDING_PORT: "0", WAITRON_HTTP_PORT: String(port) },
      serveRecovery: vi.fn(async (app: Hono, opts: RecoveryServeOptions) => {
        served = await serveRecovery(app, opts);
        return served;
      }),
    });
    try {
      await runEntry(d);
      expect(d.startServer).not.toHaveBeenCalled();
      expect(served).toBeDefined();
      const page = await pageOver(port!, ca);
      expect(page.status).toBe(200);
      expect(page.body).toContain(TITLE);
      expect(page.body).toContain(DELETED);
      expect(page.body).toContain("Free space on the box&#39;s disk: 0 MB.");
      expect(readFileSync(join(stateDir, "recovery.json"))).toEqual(stateBytes);
      expect([inodeOf(recoveryLock), inodeOf(venueLock)]).toEqual(inodes);
    } finally {
      const server = served;
      if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("…and the same folder boots once there is room", async (ctx) => {
    const small = needDisk(ctx);
    expect(nothingDir).toBeDefined();
    small.unfill();
    const d = entryDeps(nothingDir!);
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
  });
});
