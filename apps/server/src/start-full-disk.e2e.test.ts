// Needs a filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR names, or on macOS a disk
// image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case is reported
// SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md, "The
// full-disk start tests run on a small filesystem").
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { devices, locations, openVenueDatabase } from "@waitron/db";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { hashSecret } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandLocationId } from "@waitron/shared";
import { openVenueStore } from "@waitron/store";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { dumpFileName } from "./backup-keys.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { loadBoxEnv } from "./box-env.js";
import { deviceNoticeSources } from "./box-staff-notices.js";
import { mountDeviceApi } from "./device-api.js";
import { createDiskFullState, watchForDiskFull } from "./disk-full-state.js";
import { createFreeSpaceState } from "./free-space-watch.js";
import { runEntry, serveRecovery, type RecoveryServeOptions } from "./node-entry.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { createPairingMode } from "./pairing-mode.js";
import { escapeHtml } from "./recovery-surface.js";
import { readStaffNoticesInTurns, type OwnedStaffNoticeSource } from "./staff-notices.js";
import { provisionBillVenue } from "./testing/bill-venue.js";
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
  const venueDir = over.venueDir ?? join(stateDir, "venue");
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

/** Each layer of an error's cause chain that carries a `code` or an `errcode`. */
function causeCodes(error: unknown): { code?: unknown; errcode?: unknown }[] {
  const layers: { code?: unknown; errcode?: unknown }[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 10 && typeof current === "object" && current !== null; depth += 1) {
    const layer = current as { code?: unknown; errcode?: unknown; cause?: unknown };
    layers.push({ code: layer.code, errcode: layer.errcode });
    current = layer.cause;
  }
  return layers;
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
    const dump = join(stateDir, "backup-staging", dumpFileName(new Date("2026-10-20T00:00:00Z")));
    writeFileSync(dump, Buffer.alloc(2 * 1024 * 1024, 66));
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
    expect(() => statSync(dump)).toThrow();
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

  it("a box whose first setup finished gets the full-disk page, not first-setup resolution", async (ctx) => {
    const small = needDisk(ctx);
    const f = await firstFiscalFixture(realpathSync(small.folder("finished")));
    try {
      let state = (await f.store.read())!;
      for (const change of [
        { kind: "activation-started" },
        { kind: "committed", result: {} },
        { kind: "publication" },
        { kind: "complete" },
      ] as const)
        state = await f.store.update(state.frozen.attemptId, state.revision, change);
      const db = new DatabaseSync(join(f.venueDir, "venue.db"));
      try {
        db.exec("pragma journal_mode = wal");
        db.exec("create table tenants (country text, tax_id text)");
        db.exec("create table locations (id text)");
        db.exec("insert into tenants values ('ES', 'B00000000')");
        db.exec("insert into locations values ('loc-1')");
      } finally {
        db.close();
      }

      small.fill();
      const full = entryDeps(f.stateDir, { venueDir: f.venueDir });
      await runEntry(full);
      expect(full.startServer).not.toHaveBeenCalled();
      expect(full.serveRecovery).toHaveBeenCalledTimes(1);
      const app = vi.mocked(full.serveRecovery).mock.calls[0]![0];
      expect(await (await app.request("/")).text()).toContain(TITLE);
      expect((await app.request("/setup-api/status")).status).toBe(404);

      small.unfill();
      const room = entryDeps(f.stateDir, { venueDir: f.venueDir });
      await runEntry(room);
      expect(room.startServer).toHaveBeenCalledTimes(1);
    } finally {
      await f.dispose();
    }
  });

  it.for([8192, 16384])(
    "a database refused on a nearly full disk is recorded as a full disk (%i bytes left)",
    async (leave, ctx) => {
      const small = needDisk(ctx);
      const venueDir = realpathSync(small.folder(`refused-${leave}`));
      const store = await openVenueDatabase(venueDir);
      await store.close();
      const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "wt-full-disk-state-")));
      try {
        const logDir = join(stateDir, "logs");
        small.fill(leave);
        const full = entryDeps(stateDir, { venueDir, logDir });
        const error = await runEntry(full).then(
          () => expect.unreachable("the start resolved"),
          (rejection: unknown) => rejection,
        );
        expect((await readRecoveryState(stateDir)).lastErrorCode).toBe("storage.disk_full");
        const layers = causeCodes(error);
        const errcodes = layers.flatMap((l) => (typeof l.errcode === "number" ? [l.errcode] : []));
        expect(errcodes).not.toContain(13);
        expect(
          layers.some((l) => l.code === "ENOSPC") ||
            errcodes.some((code) => [10, 14].includes(code & 0xff)),
          JSON.stringify(layers),
        ).toBe(true);

        small.unfill();
        const room = entryDeps(stateDir, { venueDir, logDir });
        await runEntry(room);
        expect(room.startServer).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    },
  );

  it("a commit on a real full disk is refused whole, and the next one is served once there is room", async (ctx) => {
    const small = needDisk(ctx);
    const store = await openVenueStore({
      directory: realpathSync(small.folder("commit")),
      venueSchema: {},
      nodeSchema: {},
    });
    try {
      const db = store.venue;
      db.run(sql`create table sale (id integer primary key, body text, pad blob)`);
      await store.withWriteLock(async () => {
        db.run(sql`insert into sale (body) values ('committed before')`);
      });
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(16384);

      let statementRan = false;
      await expect(
        store.withWriteLock(async () => {
          db.run(sql`insert into sale (body, pad) values ('in transaction', zeroblob(65536))`);
          statementRan = true;
        }),
      ).rejects.toMatchObject({ code: "storage.disk_full" });
      expect(statementRan).toBe(true);
      const bodies = () =>
        db.all<{ body: string }>(sql`select body from sale order by id`).map((row) => row.body);
      expect(bodies()).toEqual(["committed before"]);

      small.unfill();
      await store.withWriteLock(async () => {
        db.run(sql`insert into sale (body) values ('after freeing')`);
      });
      expect(bodies()).toEqual(["committed before", "after freeing"]);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  it("the equipment read answers on a full disk with a stamp due", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("equipment"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    try {
      await seedTenant(db);
      const [location] = await db
        .insert(locations)
        .values({ name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Sale" })
        .returning({ id: locations.id });
      const { deviceId } = await seedDevice(db, {
        locationId: brandLocationId(location!.id),
        label: "Till 1",
      });
      const token = "equipment-token";
      await db
        .update(devices)
        .set({ tokenHash: hashSecret(token) })
        .where(eq(devices.id, deviceId));
      const app = new Hono();
      mountDeviceApi(
        app,
        { db, cfg: {} as never, secureCookies: false, pairingMode: createPairingMode() },
        () => {},
      );
      const status = async () =>
        (
          await app.request("/api/device/equipment", {
            headers: { cookie: `waitron_device=${deviceId}.${token}` },
          })
        ).status;
      const lastSeen = async () => {
        const [row] = await db
          .select({ lastSeenAt: devices.lastSeenAt })
          .from(devices)
          .where(eq(devices.id, deviceId));
        return row!.lastSeenAt;
      };
      const seenWhileFull = async (lastSeenAt: string) => {
        small.unfill();
        await db.update(devices).set({ lastSeenAt }).where(eq(devices.id, deviceId));
        db.all(sql`pragma wal_checkpoint(truncate)`);
        small.fill(0);
      };

      expect(await status()).toBe(200);

      await seenWhileFull(new Date().toISOString());
      expect(await status()).toBe(200);

      const longAgo = "2020-01-01T00:00:00.000Z";
      await seenWhileFull(longAgo);
      expect(await status()).toBe(200);
      expect(await status()).toBe(200);
      expect(await lastSeen()).toBe(longAgo);

      small.unfill();
      expect(await status()).toBe(200);
      expect(await lastSeen()).not.toBe(longAgo);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  it("the till's reads answer on a full disk with a stamp due, and PIN sign-in still refuses", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("till-session"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    try {
      const venue = await provisionBillVenue(db);
      const deviceCookie = venue.cookie
        .split("; ")
        .find((part) => part.startsWith("waitron_device"))!;
      const request = (
        path: string,
        cookie: string,
        init: { method?: string; body?: unknown } = {},
      ) =>
        venue.app.request(path, {
          method: init.method ?? "GET",
          headers: { cookie, "content-type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
      const lastSeen = () =>
        db.all<{ lastSeenAt: string | null }>(
          sql`select last_seen_at as lastSeenAt from devices where id = ${venue.deviceId}`,
        )[0]!.lastSeenAt;
      const sessionCount = () =>
        db.all<{ n: number }>(sql`select count(*) as n from sessions`)[0]!.n;

      const longAgo = "2020-01-01T00:00:00.000Z";
      small.unfill();
      db.run(sql`update devices set last_seen_at = ${longAgo} where id = ${venue.deviceId}`);
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      expect((await request("/api/till", deviceCookie)).status).toBe(200);
      expect((await request("/api/working-orders", venue.cookie)).status).toBe(200);
      expect(lastSeen()).toBe(longAgo);
      const before = sessionCount();
      const signIn = await request("/api/session", deviceCookie, {
        method: "POST",
        body: { personId: venue.operatorId, pin: "5555" },
      });
      expect(signIn.status).toBe(507);
      expect(await signIn.json()).toMatchObject({ error: { code: "storage.disk_full" } });
      expect(sessionCount()).toBe(before);

      small.unfill();
      expect((await request("/api/working-orders", venue.cookie)).status).toBe(200);
      expect(lastSeen()).not.toBe(longAgo);
    } finally {
      small.unfill();
      await store.close();
    }
  });
  it("the notice reader answers on a full disk with a change waiting, and a source that writes fails alone", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("notices"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    try {
      db.run(sql`create table zz (id integer primary key, pad blob)`);
      const sources: OwnedStaffNoticeSource[] = [
        {
          owner: "box",
          source: {
            read: () =>
              Promise.resolve([
                {
                  key: "storage.disk_full",
                  code: "storage.disk_full",
                  severity: "error",
                  params: {},
                },
              ]),
          },
        },
        {
          owner: "writer",
          source: {
            read: ({ tx }) => {
              tx.run(sql`insert into zz (pad) values (zeroblob(16))`);
              return Promise.resolve([{ key: "w", code: "w.w", severity: "error", params: {} }]);
            },
          },
        },
        {
          owner: "count",
          source: {
            read: ({ tx }) => {
              const [row] = tx.all<{ n: number }>(
                sql`select count(*) as n from envios where estado in ('pendiente', 'enviando', 'detenido', 'retenido')`,
              );
              return Promise.resolve([
                { key: "unsent", code: "x.unsent", severity: "notice", params: { count: row!.n } },
              ]);
            },
          },
        },
      ];
      db.run(
        sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
      );
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      const read = () =>
        readStaffNoticesInTurns(db, sources, {
          reading: { instant: new Date(), offsetMinutes: 0 },
          log: () => {},
        });
      for (let i = 0; i < 2; i += 1) {
        const result = await read();
        expect(result.notices.map((x) => `${x.owner}:${x.key}`)).toEqual([
          "box:storage.disk_full",
          "count:unsent",
        ]);
        expect(result.unavailable).toEqual(["writer"]);
      }

      small.unfill();
      expect(db.all<{ n: number }>(sql`select count(*) as n from zz`)).toEqual([{ n: 0 }]);
      expect(db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  it("the equipment read answers with the red notice on a full disk with a change waiting", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("equipment-notices"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    const disk = createDiskFullState({ dir, now: () => new Date(), log: () => {} });
    const unwatch = watchForDiskFull(disk, [store.venue, store.node]);
    try {
      await seedTenant(db);
      const [location] = await db
        .insert(locations)
        .values({ name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Sale" })
        .returning({ id: locations.id });
      const { deviceId } = await seedDevice(db, {
        locationId: brandLocationId(location!.id),
        label: "Till 1",
      });
      const token = "equipment-notices-token";
      await db
        .update(devices)
        .set({ tokenHash: hashSecret(token), lastSeenAt: "2020-01-01T00:00:00.000Z" })
        .where(eq(devices.id, deviceId));
      db.run(sql`create table zz (id integer primary key, pad blob)`);
      const writer: OwnedStaffNoticeSource = {
        owner: "writer",
        source: {
          read: ({ tx }) => {
            tx.run(sql`insert into zz (pad) values (zeroblob(16))`);
            return Promise.resolve([]);
          },
        },
      };
      const app = new Hono();
      mountDeviceApi(
        app,
        {
          db,
          cfg: {} as never,
          secureCookies: false,
          pairingMode: createPairingMode(),
          notices: {
            sources: [
              ...deviceNoticeSources({ disk, space: createFreeSpaceState({ log: () => {} }) }, []),
              writer,
            ],
            clock: {
              now: () => ({ instant: new Date(), offsetMinutes: 0, confident: true }) as never,
            },
            filing: () => ({ enabled: false }),
          },
        },
        () => {},
      );
      db.run(
        sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
      );
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      for (let i = 0; i < 2; i += 1) {
        const res = await app.request("/api/device/equipment", {
          headers: { cookie: `waitron_device=${deviceId}.${token}` },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          roles: unknown;
          notices: { key: string; owner: string }[];
          noticesUnavailable: string[];
        };
        expect(Array.isArray(body.roles)).toBe(true);
        expect(body.notices.map(({ key, owner }) => ({ key, owner }))).toEqual([
          { key: "storage.disk_full", owner: "box" },
        ]);
        expect(body.noticesUnavailable).toEqual(["writer"]);
      }
    } finally {
      unwatch();
      small.unfill();
      await store.close();
    }
  });
});
