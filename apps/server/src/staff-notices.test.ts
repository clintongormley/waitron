import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { locations, withTransaction, type Database, type Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, recordIncident } from "@waitron/core";
import { enabledModules, parseModuleOverrides } from "@waitron/module";
import type { StaffNotice, StaffNoticeContext, StaffNoticeSource } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import {
  AppError,
  deviceOrigin,
  locationId as brandLocationId,
  type DeviceId,
} from "@waitron/shared";
import { ALL_MODULES, enabledStaffNoticeSources } from "./modules.js";
import { readStaffNotices } from "./staff-notices.js";
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
      name: "Sala",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const { deviceId } = await seedDevice(db, {
    locationId: brandLocationId(location!.id),
    label: "Caja 1",
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
    const seen: StaffNoticeContext[] = [];
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
