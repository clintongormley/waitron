import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, locations, printers } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import type { TrustedReading } from "@waitron/fiscal";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import { cardReaders, DEMO_READER_ID, PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { collectBoxHealth, type BoxHealthReaders, type ClockStopView } from "./box-health.js";
import { createStaffNoticeLog } from "./staff-notices.js";

const NOW = new Date("2026-10-22T10:00:00.000Z");
const READING: TrustedReading = {
  instant: NOW,
  offsetMinutes: 120,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
};

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

function stubReaders(over: Partial<BoxHealthReaders> = {}): BoxHealthReaders {
  return {
    now: () => NOW,
    notices: {
      sources: [],
      clock: { now: () => READING },
      filing: () => true,
      log: createStaffNoticeLog(() => {}),
    },
    stream: () => ({ state: "off" }),
    authorityClock: () => ({ state: "ok", driftSeconds: 2, measuredAt: "2026-10-22T09:00:00Z" }),
    timeHealth: async () => ({ synced: true, source: "timedatectl", warn: false }),
    disk: { since: () => null },
    space: { current: () => ({ freeBytes: null, readAt: null, lowSince: null }) },
    usage: async () => ({
      freeBytes: 1,
      totalBytes: 100_000,
      databaseBytes: 10,
      backupsBytes: 20,
      logBytes: 30,
      otherBytes: 40,
    }),
    free: async () => 5_000,
    leftovers: async () => ({ bytes: 700_000, backupRunning: false }),
    paymentsEnabled: true,
    canFree: () => true,
    ...over,
  };
}

async function seedLocation(): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  return row!.id;
}

async function seedSales(issued: { id: string; at: string; corrects?: string }[]): Promise<void> {
  const location = await seedLocation();
  const node = await seedNode(suite.db, brandLocationId(location));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: node, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  for (const [index, sale] of issued.entries()) {
    await suite.db.run(
      sql`insert into sales (id, source, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, corrects_sale_id) values (${sale.id}, 'operator_script', ${node}, ${series!.id}, ${index + 1}, ${sale.at}, 120, ${sale.corrects === undefined ? 100 : -100}, '[]', 'es-ES', '["es-ES"]', 'verifactu', 'recorded', ${sale.corrects ?? null})`,
    );
  }
}

async function seedPrinter(locationId: string, name: string, over: object = {}): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({ locationId, name, transport: "network_tcp", host: "10.0.0.1", ...over })
    .returning({ id: printers.id });
  return row!.id;
}

async function seedReader(name: string, over: object = {}): Promise<string> {
  const [row] = await suite.db
    .insert(cardReaders)
    .values({ provider: "stub", providerRef: `ref-${name}`, name, ...over })
    .returning({ id: cardReaders.id });
  return row!.id;
}

describe("collectBoxHealth", () => {
  it("answers an empty venue with nothing read and the stubs' values passed through", async () => {
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({ notices: { ...stubReaders().notices, filing: () => false } }),
    );
    expect(health).toEqual({
      at: NOW.toISOString(),
      sales: { lastAt: null },
      notices: [],
      noticesUnavailable: [],
      filing: false,
      outbox: null,
      stream: { state: "off" },
      clock: {
        authority: { state: "ok", driftSeconds: 2, measuredAt: "2026-10-22T09:00:00Z" },
        sync: { synced: true, source: "timedatectl", warn: false },
      },
      printers: [],
      readers: [],
      canFree: true,
      disk: {
        freeBytes: 5_000,
        totalBytes: 100_000,
        databaseBytes: 10,
        backupsBytes: 20,
        logBytes: 30,
        otherBytes: 40,
        stoppedSince: null,
        lowSince: null,
        reclaimable: { bytes: 700_000, backupRunning: false },
      },
      clockStop: null,
    });
  });

  it("reports the latest sale by when it was issued, not by its id", async () => {
    await seedSales([
      { id: "00000000-0000-4000-8000-000000000003", at: "2026-10-20T12:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000001", at: "2026-10-22T12:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000002", at: "2026-10-21T12:00:00.000Z" },
    ]);
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.sales.lastAt).toBe("2026-10-22T12:00:00.000Z");
  });

  it("counts a correction as the last sale when it is the latest", async () => {
    const original = "00000000-0000-4000-8000-000000000001";
    await seedSales([
      { id: original, at: "2026-10-21T12:00:00.000Z" },
      {
        id: "00000000-0000-4000-8000-000000000002",
        at: "2026-10-22T09:00:00.000Z",
        corrects: original,
      },
    ]);
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.sales.lastAt).toBe("2026-10-22T09:00:00.000Z");
  });

  it("lists only printers that are switched on and not deleted", async () => {
    const location = await seedLocation();
    const active = await seedPrinter(location, "Bar");
    await seedPrinter(location, "Off", { active: false });
    await seedPrinter(location, "Gone", { active: true, deletedAt: "2026-10-01T00:00:00.000Z" });
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.printers).toEqual([{ id: active, name: "Bar" }]);
  });

  it("lists printers by name", async () => {
    const location = await seedLocation();
    const second = await seedPrinter(location, "Kitchen");
    const first = await seedPrinter(location, "Bar");
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.printers).toEqual([
      { id: first, name: "Bar" },
      { id: second, name: "Kitchen" },
    ]);
  });

  it("lists only card readers that are switched on, not deleted and not the demo reader", async () => {
    const active = await seedReader("Counter");
    await seedReader("Off", { active: false });
    await seedReader("Gone", { deletedAt: "2026-10-01T00:00:00.000Z" });
    await seedReader("Demo", { id: DEMO_READER_ID });
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.readers).toEqual([{ id: active, name: "Counter" }]);
  });

  it("lists card readers by name", async () => {
    const second = await seedReader("Terrace");
    const first = await seedReader("Bar");
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.readers).toEqual([
      { id: first, name: "Bar" },
      { id: second, name: "Terrace" },
    ]);
  });

  it("gives when writing stopped and when space ran low as ISO times", async () => {
    const stopped = new Date("2026-10-21T08:00:00.000Z");
    const low = new Date("2026-10-20T08:00:00.000Z");
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({
        disk: { since: () => stopped },
        space: { current: () => ({ freeBytes: 10, readAt: NOW, lowSince: low }) },
      }),
    );
    expect(health.disk.stoppedSince).toBe("2026-10-21T08:00:00.000Z");
    expect(health.disk.lowSince).toBe("2026-10-20T08:00:00.000Z");
  });

  it("keeps an answering source's notices with their owner and names a failing source's owner", async () => {
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "storage",
        source: {
          read: async () => [
            { key: "disk", code: "storage.disk_full", severity: "error", params: {} },
          ],
        },
      },
      {
        owner: "printing",
        source: {
          read: async () => {
            throw new Error("boom");
          },
        },
      },
    ];
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({ notices: { ...stubReaders().notices, sources } }),
    );
    expect(health.notices).toEqual([
      { owner: "storage", key: "disk", code: "storage.disk_full", severity: "error", params: {} },
    ]);
    expect(health.noticesUnavailable).toEqual(["printing"]);
  });

  it("counts a source that writes a row as unavailable, and its row does not stay", async () => {
    const location = await seedLocation();
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "writer",
        source: {
          read: async ({ tx }) => {
            await tx
              .insert(printers)
              .values({ locationId: location, name: "Sneaky", transport: "network_tcp" });
            return [];
          },
        },
      },
    ];
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({ notices: { ...stubReaders().notices, sources } }),
    );
    expect(health.noticesUnavailable).toEqual(["writer"]);
    expect(await suite.db.select().from(printers)).toEqual([]);
  });

  it("tells each source whether the box files", async () => {
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "fiscal",
        source: {
          read: async (ctx) =>
            ctx.filing?.enabled === true
              ? [{ key: "f", code: "fiscal.pending", severity: "warning", params: {} }]
              : [],
        },
      },
    ];
    const notices = (filing: boolean) => ({
      ...stubReaders().notices,
      sources,
      filing: () => filing,
    });
    const on = await collectBoxHealth(suite.db, stubReaders({ notices: notices(true) }));
    expect(on.notices.map((n) => n.key)).toEqual(["f"]);
    expect(on.filing).toBe(true);
    const off = await collectBoxHealth(suite.db, stubReaders({ notices: notices(false) }));
    expect(off.notices).toEqual([]);
    expect(off.filing).toBe(false);
  });

  it("reads the database in a write-lock turn, waiting for the turn already taken", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = suite.db.withWriteLock(() => held);
    let done = false;
    const reading = collectBoxHealth(suite.db, stubReaders()).then(() => {
      done = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(done).toBe(false);
    } finally {
      // Released even when the check fails, or the suite's reset waits on the held turn forever.
      release();
      await holder;
    }
    await vi.waitFor(() => expect(done).toBe(true));
    await reading;
  });

  it("passes whether a free-space deletion may run through", async () => {
    expect((await collectBoxHealth(suite.db, stubReaders({ canFree: () => true }))).canFree).toBe(
      true,
    );
    expect((await collectBoxHealth(suite.db, stubReaders({ canFree: () => false }))).canFree).toBe(
      false,
    );
  });

  it("takes the free space from the fresh reading, not the usage's", async () => {
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({
        usage: async () => ({
          freeBytes: 999,
          totalBytes: 1_000,
          databaseBytes: 1,
          backupsBytes: 1,
          logBytes: 1,
          otherBytes: 1,
        }),
        free: async () => 123,
      }),
    );
    expect(health.disk.freeBytes).toBe(123);
    expect(health.disk.totalBytes).toBe(1_000);
  });

  it("passes the clock stop reader's answer through, asking it with the database", async () => {
    const view = { offer: "no_proof" } as ClockStopView;
    const asked: unknown[] = [];
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({
        clockStop: async (db) => {
          asked.push(db);
          return view;
        },
      }),
    );
    expect(health.clockStop).toBe(view);
    expect(asked).toEqual([suite.db]);
  });

  it("settles the notice log, so an owner that stops failing is logged as recovered", async () => {
    const lines: string[] = [];
    const log = createStaffNoticeLog((_level, event) => lines.push(event));
    let fail = true;
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "flaky",
        source: {
          read: async () => {
            if (fail) throw new Error("boom");
            return [];
          },
        },
      },
    ];
    const readers = stubReaders({ notices: { ...stubReaders().notices, sources, log } });
    await collectBoxHealth(suite.db, readers);
    fail = false;
    await collectBoxHealth(suite.db, readers);
    expect(lines).toEqual(["staff_notice.source_unavailable", "staff_notice.source_recovered"]);
  });
});
