import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { locations, withTransaction, type Database, type Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, recordIncident } from "@waitron/core";
import { enabledModules, parseModuleOverrides } from "@waitron/module";
import type { StaffNotice, StaffNoticeReadContext, StaffNoticeSource } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import {
  AppError,
  deviceOrigin,
  locationId as brandLocationId,
  type DeviceId,
} from "@waitron/shared";
import { ALL_MODULES, enabledStaffNoticeSources } from "./modules.js";
import {
  createStaffNoticeLog,
  readStaffNotices,
  readStaffNoticesInTurns,
  type OwnedStaffNoticeSource,
} from "./staff-notices.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const READING = { instant: new Date("2026-10-22T10:00:00.000Z"), offsetMinutes: 120 };
const noopLog: Logger = () => {};

function n(key: string, severity: StaffNotice["severity"]): StaffNotice {
  return { key, code: "x.y", severity, params: {} };
}

async function seedVenue(): Promise<{ deviceId: DeviceId }> {
  await seedTenant(db);
  // Through the table definition: `locations.id` is a NOT NULL `$defaultFn` generator a raw insert
  // never reaches.
  const [location] = await db
    .insert(locations)
    .values({
      name: "Main room",
      invoiceLocales: ["es-ES"],
      operationDescription: "Sale on premises",
    })
    .returning({ id: locations.id });
  const { deviceId } = await seedDevice(db, {
    locationId: brandLocationId(location!.id),
    label: "Till 1",
  });
  return { deviceId };
}

function record(tx: Transaction, deviceId: DeviceId, code: string): Promise<void> {
  return recordIncident(tx, {
    origin: deviceOrigin(deviceId),
    error: new AppError(code as never, {} as never),
    severity: "warning",
    detectedAt: READING.instant,
  });
}

function failing(message: string): StaffNoticeSource {
  return {
    read: () => {
      throw new Error(message);
    },
  };
}

describe("readStaffNotices", () => {
  it("asks every source in turn with the transaction and the one reading, and orders errors, warnings, then notices", async () => {
    const order: string[] = [];
    const seen: StaffNoticeReadContext[] = [];
    const mk = (name: string, notices: StaffNotice[]): StaffNoticeSource => ({
      read: async (ctx) => {
        seen.push(ctx);
        order.push(`${name} in`);
        await ctx.tx.execute(sql`select 1`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`${name} out`);
        return notices;
      },
    });
    let outer: Transaction | undefined;
    const result = await withTransaction(db, (tx) => {
      outer = tx;
      return readStaffNotices(
        tx,
        [
          { owner: "p", source: mk("p", [n("p-notice", "notice"), n("p-error", "error")]) },
          { owner: "q", source: mk("q", [n("q-warning", "warning"), n("q-error", "error")]) },
        ],
        { reading: READING, log: noopLog },
      );
    });
    expect(order).toEqual(["p in", "p out", "q in", "q out"]);
    expect(result.notices.map((x) => x.key)).toEqual([
      "p-error",
      "q-error",
      "q-warning",
      "p-notice",
    ]);
    expect(result.notices.map((x) => x.owner)).toEqual(["p", "q", "q", "p"]);
    expect(result.unavailable).toEqual([]);
    expect(seen).toHaveLength(2);
    for (const ctx of seen) {
      expect(ctx.tx).toBe(outer);
      expect(ctx.reading).toBe(READING);
    }
  });

  it("source order beats key order and owner order within a severity", async () => {
    const result = await withTransaction(db, (tx) =>
      readStaffNotices(
        tx,
        [
          {
            owner: "zeta",
            source: {
              read: () => Promise.resolve([n("z-error", "error"), n("m-error", "error")]),
            },
          },
          { owner: "alpha", source: { read: () => Promise.resolve([n("a-error", "error")]) } },
        ],
        { reading: READING, log: noopLog },
      ),
    );
    expect(result.notices.map((x) => x.key)).toEqual(["z-error", "m-error", "a-error"]);
  });

  it("a source that writes and then fails keeps nothing; the caller's earlier write and a later source's write are kept", async () => {
    const { deviceId } = await seedVenue();
    const log = vi.fn<Logger>();
    const inside = await withTransaction(db, async (tx) => {
      await record(tx, deviceId, "test.caller");
      const out = await readStaffNotices(
        tx,
        [
          {
            owner: "w",
            source: {
              read: async (ctx) => {
                await record(ctx.tx, deviceId, "test.w");
                throw new AppError("server.internal", {});
              },
            },
          },
          {
            owner: "h",
            source: {
              read: async (ctx) => {
                await record(ctx.tx, deviceId, "test.h");
                return [n("h-1", "notice")];
              },
            },
          },
        ],
        { reading: READING, log },
      );
      const open = (await listOpenIncidents(tx)).map((i) => i.code).sort();
      return { out, open };
    });
    expect(inside.out.notices.map((x) => x.key)).toEqual(["h-1"]);
    expect(inside.out.unavailable).toEqual(["w"]);
    expect(inside.open).toEqual(["test.caller", "test.h"]);
    const committed = await withTransaction(db, async (tx) =>
      (await listOpenIncidents(tx)).map((i) => i.code).sort(),
    );
    expect(committed).toEqual(["test.caller", "test.h"]);
    expect(log).toHaveBeenCalledWith("error", "staff_notice.source_unavailable", {
      owner: "w",
      errorCode: "server.internal",
    });
  });

  it.each([
    { shape: "a null after a valid notice", bad: () => null, errorCode: "unknown" },
    {
      shape: "a notice whose key throws when read",
      bad: () => ({
        get key(): string {
          throw new AppError("server.internal", {});
        },
        code: "x.y",
        severity: "notice",
        params: {},
      }),
      errorCode: "server.internal",
    },
  ])(
    "a source that writes and answers $shape keeps no notice and none of its writes; its neighbours keep theirs",
    async ({ bad, errorCode }) => {
      const { deviceId } = await seedVenue();
      const log = vi.fn<Logger>();
      const inside = await withTransaction(db, async (tx) => {
        await record(tx, deviceId, "test.caller");
        const out = await readStaffNotices(
          tx,
          [
            {
              owner: "a",
              source: {
                read: async (ctx) => {
                  await record(ctx.tx, deviceId, "test.a");
                  return [n("a-1", "notice")];
                },
              },
            },
            {
              owner: "broken",
              source: {
                read: async (ctx) => {
                  await record(ctx.tx, deviceId, "test.broken");
                  return [n("broken-1", "error"), bad()] as unknown as StaffNotice[];
                },
              },
            },
            {
              owner: "h",
              source: {
                read: async (ctx) => {
                  await record(ctx.tx, deviceId, "test.h");
                  return [n("h-1", "warning")];
                },
              },
            },
          ],
          { reading: READING, log },
        );
        const open = (await listOpenIncidents(tx)).map((i) => i.code).sort();
        return { out, open };
      });
      expect(inside.out.notices).toEqual([
        { ...n("h-1", "warning"), owner: "h" },
        { ...n("a-1", "notice"), owner: "a" },
      ]);
      expect(inside.out.unavailable).toEqual(["broken"]);
      expect(inside.open).toEqual(["test.a", "test.caller", "test.h"]);
      const committed = await withTransaction(db, async (tx) =>
        (await listOpenIncidents(tx)).map((i) => i.code).sort(),
      );
      expect(committed).toEqual(["test.a", "test.caller", "test.h"]);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("error", "staff_notice.source_unavailable", {
        owner: "broken",
        errorCode,
      });
    },
  );

  it("a source that throws before returning a promise is reported, and the rest are asked", async () => {
    const log = vi.fn<Logger>();
    const result = await withTransaction(db, (tx) =>
      readStaffNotices(
        tx,
        [
          { owner: "s", source: failing("sync") },
          { owner: "h", source: { read: () => Promise.resolve([n("h-1", "notice")]) } },
        ],
        { reading: READING, log },
      ),
    );
    expect(result.notices).toEqual([{ ...n("h-1", "notice"), owner: "h" }]);
    expect(result.unavailable).toEqual(["s"]);
    expect(log).toHaveBeenCalledWith("error", "staff_notice.source_unavailable", {
      owner: "s",
      errorCode: "unknown",
    });
  });

  it("two failing sources of one owner list it once", async () => {
    const log = vi.fn<Logger>();
    const result = await withTransaction(db, (tx) =>
      readStaffNotices(
        tx,
        [
          { owner: "m", source: failing("one") },
          { owner: "m", source: failing("two") },
        ],
        { reading: READING, log },
      ),
    );
    expect(result.unavailable).toEqual(["m"]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, "error", "staff_notice.source_unavailable", {
      owner: "m",
      errorCode: "unknown",
    });
    expect(log).toHaveBeenNthCalledWith(2, "error", "staff_notice.source_unavailable", {
      owner: "m",
      errorCode: "unknown",
    });
  });

  it("through the real composition, the Veri*Factu module's clock notice and nothing else", async () => {
    const verifactu = enabledStaffNoticeSources(
      enabledModules(ALL_MODULES, parseModuleOverrides({ "fiscal-none": false }, ALL_MODULES)),
    );
    const none = enabledStaffNoticeSources(
      enabledModules(ALL_MODULES, parseModuleOverrides({ "fiscal-verifactu": false }, ALL_MODULES)),
    );
    const before = { instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 };
    const early = await withTransaction(db, (tx) =>
      readStaffNotices(tx, verifactu, { reading: before, log: noopLog }),
    );
    expect(early).toEqual({
      notices: [
        {
          key: "clock.unusable",
          code: "clock.unusable",
          severity: "error",
          params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
          owner: "fiscal-verifactu",
        },
      ],
      unavailable: [],
    });
    const now = await withTransaction(db, (tx) =>
      readStaffNotices(tx, verifactu, { reading: READING, log: noopLog }),
    );
    expect(now).toEqual({ notices: [], unavailable: [] });
    const control = await withTransaction(db, (tx) =>
      readStaffNotices(tx, none, { reading: before, log: noopLog }),
    );
    expect(control).toEqual({ notices: [], unavailable: [] });
  });

  it("keeps the first of two notices one owner answers under the same key, and logs the second", async () => {
    const log = vi.fn<Logger>();
    const result = await withTransaction(db, (tx) =>
      readStaffNotices(
        tx,
        [
          {
            owner: "d",
            source: {
              read: () =>
                Promise.resolve([
                  { key: "k", code: "first.code", severity: "warning", params: {} },
                ]),
            },
          },
          {
            owner: "d",
            source: {
              read: () =>
                Promise.resolve([{ key: "k", code: "second.code", severity: "error", params: {} }]),
            },
          },
        ],
        { reading: READING, log },
      ),
    );
    expect(result.notices).toEqual([
      { key: "k", code: "first.code", severity: "warning", params: {}, owner: "d" },
    ]);
    expect(result.unavailable).toEqual([]);
    expect(log).toHaveBeenCalledWith("error", "staff_notice.duplicate_key", {
      owner: "d",
      key: "k",
    });
  });
});

describe("createStaffNoticeLog", () => {
  const UNAVAILABLE = "staff_notice.source_unavailable";

  it("passes other events through unchanged", () => {
    const spy = vi.fn<Logger>();
    const { log } = createStaffNoticeLog(spy);
    log("warn", "other.event", { a: 1 });
    log("info", "other.event");
    expect(spy.mock.calls).toEqual([
      ["warn", "other.event", { a: 1 }],
      ["info", "other.event", undefined],
    ]);
  });

  it("logs an owner's failure once while it keeps failing", () => {
    const spy = vi.fn<Logger>();
    const notices = createStaffNoticeLog(spy);
    const first = notices.begin();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "first.code" });
    first.settle(["m"]);
    const second = notices.begin();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "second.code" });
    second.settle(["m"]);
    expect(spy.mock.calls).toEqual([
      ["error", UNAVAILABLE, { owner: "m", errorCode: "first.code" }],
    ]);
  });

  it("logs every failure line that names no owner, and notes no recovery for it", () => {
    const spy = vi.fn<Logger>();
    const notices = createStaffNoticeLog(spy);
    const read = notices.begin();
    notices.log("error", UNAVAILABLE, { errorCode: "first.code" });
    notices.log("error", UNAVAILABLE, { errorCode: "second.code" });
    read.settle([]);
    expect(spy.mock.calls).toEqual([
      ["error", UNAVAILABLE, { errorCode: "first.code" }],
      ["error", UNAVAILABLE, { errorCode: "second.code" }],
    ]);
  });

  it("notes the recovery once, and logs a new failure after it", () => {
    const spy = vi.fn<Logger>();
    const notices = createStaffNoticeLog(spy);
    const failed = notices.begin();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "first.code" });
    failed.settle(["m"]);
    spy.mockClear();
    notices.begin().settle([]);
    expect(spy.mock.calls).toEqual([["info", "staff_notice.source_recovered", { owner: "m" }]]);
    spy.mockClear();
    notices.begin().settle([]);
    expect(spy).not.toHaveBeenCalled();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "again.code" });
    expect(spy.mock.calls).toEqual([
      ["error", UNAVAILABLE, { owner: "m", errorCode: "again.code" }],
    ]);
  });

  it("notes the recovery only of the owners that stopped failing", () => {
    const spy = vi.fn<Logger>();
    const notices = createStaffNoticeLog(spy);
    const failed = notices.begin();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "x" });
    notices.log("error", UNAVAILABLE, { owner: "n", errorCode: "x" });
    failed.settle(["m", "n"]);
    spy.mockClear();
    notices.begin().settle(["n"]);
    expect(spy.mock.calls).toEqual([["info", "staff_notice.source_recovered", { owner: "m" }]]);
  });

  it("logs each repeated key once", () => {
    const spy = vi.fn<Logger>();
    const { log } = createStaffNoticeLog(spy);
    for (let i = 0; i < 3; i += 1) {
      log("error", "staff_notice.duplicate_key", { owner: "d", key: "k" });
    }
    log("error", "staff_notice.duplicate_key", { owner: "d", key: "j" });
    expect(spy.mock.calls).toEqual([
      ["error", "staff_notice.duplicate_key", { owner: "d", key: "k" }],
      ["error", "staff_notice.duplicate_key", { owner: "d", key: "j" }],
    ]);
  });

  it("through the reader, a source that fails on every read is logged once", async () => {
    const spy = vi.fn<Logger>();
    const notices = createStaffNoticeLog(spy);
    for (let i = 0; i < 3; i += 1) {
      const read = notices.begin();
      const result = await withTransaction(db, (tx) =>
        readStaffNotices(tx, [{ owner: "m", source: failing("boom") }], {
          reading: READING,
          log: notices.log,
        }),
      );
      read.settle(result.unavailable);
    }
    expect(spy.mock.calls.filter(([, event]) => event === UNAVAILABLE)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not note a recovery from a read that checked the source before it failed", async () => {
    const lines: string[] = [];
    const logger = createStaffNoticeLog((_level, event) => lines.push(event));
    let calls = 0;
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "m",
        source: {
          read: async () => {
            calls += 1;
            if (calls > 1) throw new Error("down");
            return [];
          },
        },
      },
      { owner: "n", source: { read: async () => [] } },
    ];
    // The two reads take turns source by source: the first checks `m` while it still answers, the
    // second sees it fail, and only then does the first finish.
    const run = async () => {
      const begun = logger.begin();
      const read = await readStaffNoticesInTurns(db, sources, {
        reading: READING,
        log: logger.log,
      });
      begun.settle(read.unavailable);
    };
    await Promise.all([run(), run()]);
    expect(lines).toEqual([UNAVAILABLE]);
  });

  it("does not note a recovery from a read begun before a repeated failure", () => {
    const spy = vi.fn<Logger>();
    const notices = createStaffNoticeLog(spy);
    const first = notices.begin();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "x" });
    first.settle(["m"]);
    const earlier = notices.begin();
    const later = notices.begin();
    notices.log("error", UNAVAILABLE, { owner: "m", errorCode: "x" });
    earlier.settle([]);
    later.settle(["m"]);
    expect(spy.mock.calls).toEqual([["error", UNAVAILABLE, { owner: "m", errorCode: "x" }]]);
  });

  it("through the reader, reads one after another note a recovery once and a new failure", async () => {
    const lines: string[] = [];
    const logger = createStaffNoticeLog((_level, event) => lines.push(event));
    let down = true;
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "m",
        source: {
          read: async () => {
            if (down) throw new Error("down");
            return [];
          },
        },
      },
    ];
    const run = async () => {
      const begun = logger.begin();
      const read = await readStaffNoticesInTurns(db, sources, {
        reading: READING,
        log: logger.log,
      });
      begun.settle(read.unavailable);
    };
    await run();
    await run();
    down = false;
    await run();
    await run();
    down = true;
    await run();
    expect(lines).toEqual([UNAVAILABLE, "staff_notice.source_recovered", UNAVAILABLE]);
  });
});

describe("readStaffNoticesInTurns", () => {
  it("orders errors, warnings, then notices, sources in the order given, one after another", async () => {
    const order: string[] = [];
    const seen: StaffNoticeReadContext[] = [];
    const mk = (name: string, notices: StaffNotice[]): StaffNoticeSource => ({
      read: async (ctx) => {
        seen.push(ctx);
        order.push(`${name} in`);
        await ctx.tx.execute(sql`select 1`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`${name} out`);
        return notices;
      },
    });
    const result = await readStaffNoticesInTurns(
      db,
      [
        { owner: "p", source: mk("p", [n("p-notice", "notice"), n("p-error", "error")]) },
        { owner: "q", source: mk("q", [n("q-warning", "warning"), n("q-error", "error")]) },
      ],
      { reading: READING, log: noopLog },
    );
    expect(order).toEqual(["p in", "p out", "q in", "q out"]);
    expect(result.notices.map((x) => x.key)).toEqual([
      "p-error",
      "q-error",
      "q-warning",
      "p-notice",
    ]);
    expect(result.notices.map((x) => x.owner)).toEqual(["p", "q", "q", "p"]);
    expect(result.unavailable).toEqual([]);
    expect(seen).toHaveLength(2);
    for (const ctx of seen) {
      expect(ctx.tx).toBe(db);
      expect(ctx.reading).toBe(READING);
    }
  });

  it("a source that changes a row fails, keeps nothing, and the rest are asked", async () => {
    const { deviceId } = await seedVenue();
    const log = vi.fn<Logger>();
    const result = await readStaffNoticesInTurns(
      db,
      [
        {
          owner: "w",
          source: {
            read: async (ctx) => {
              await record(ctx.tx, deviceId, "test.w");
              return [n("w-1", "error")];
            },
          },
        },
        { owner: "h", source: { read: () => Promise.resolve([n("h-1", "notice")]) } },
      ],
      { reading: READING, log },
    );
    expect(result.notices).toEqual([{ ...n("h-1", "notice"), owner: "h" }]);
    expect(result.unavailable).toEqual(["w"]);
    const open = await withTransaction(db, async (tx) =>
      (await listOpenIncidents(tx)).map((i) => i.code),
    );
    expect(open).toEqual([]);
    expect(log).toHaveBeenCalledWith("error", "staff_notice.source_unavailable", {
      owner: "w",
      errorCode: "staff_notice.source_wrote",
    });
  });

  it("a source that throws is reported by its code", async () => {
    const log = vi.fn<Logger>();
    const result = await readStaffNoticesInTurns(
      db,
      [
        {
          owner: "t",
          source: { read: () => Promise.reject(new AppError("server.internal", {})) },
        },
      ],
      { reading: READING, log },
    );
    expect(result).toEqual({ notices: [], unavailable: ["t"] });
    expect(log).toHaveBeenCalledWith("error", "staff_notice.source_unavailable", {
      owner: "t",
      errorCode: "server.internal",
    });
  });

  it("the duplicate rule holds across turns", async () => {
    const log = vi.fn<Logger>();
    const result = await readStaffNoticesInTurns(
      db,
      [
        {
          owner: "d",
          source: {
            read: () =>
              Promise.resolve([{ key: "k", code: "first.code", severity: "warning", params: {} }]),
          },
        },
        {
          owner: "d",
          source: {
            read: () =>
              Promise.resolve([{ key: "k", code: "second.code", severity: "error", params: {} }]),
          },
        },
      ],
      { reading: READING, log },
    );
    expect(result.notices).toEqual([
      { key: "k", code: "first.code", severity: "warning", params: {}, owner: "d" },
    ]);
    expect(result.unavailable).toEqual([]);
    expect(log).toHaveBeenCalledWith("error", "staff_notice.duplicate_key", {
      owner: "d",
      key: "k",
    });
  });

  it("drains nothing", async () => {
    db.run(sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`);
    const result = await readStaffNoticesInTurns(
      db,
      [{ owner: "h", source: { read: () => Promise.resolve([n("h-1", "notice")]) } }],
      { reading: READING, log: noopLog },
    );
    expect(result.notices.map((x) => x.key)).toEqual(["h-1"]);
    expect(db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
  });
});
