import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, printers, withTransaction } from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import type { TrustedReading } from "@waitron/fiscal";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import { cardReaders, PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { sql } from "drizzle-orm";
import { collectBoxHealth, type BoxHealthReaders } from "./box-health.js";
import { deviceNoticeSources } from "./box-staff-notices.js";
import { createStaffNoticeLog } from "./staff-notices.js";

const NOW = new Date("2026-10-22T10:00:00.000Z");
const READING: TrustedReading = {
  instant: NOW,
  offsetMinutes: 120,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
};

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
});

function stubReaders(over: Partial<BoxHealthReaders> = {}): BoxHealthReaders {
  return {
    now: () => NOW,
    notices: {
      sources: () => [],
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

async function seedFixtureVenue(): Promise<void> {
  await seedVenue(suite.db, {
    name: "Counter",
    invoiceLocales: ["es-ES"],
  });
}

async function seedSales(issued: { id: string; at: string; corrects?: string }[]): Promise<void> {
  await seedFixtureVenue();
  const node = await seedNode(suite.db);
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

async function seedPrinter(name: string, over: object = {}): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({ name, transport: "network_tcp", host: "10.0.0.1", ...over })
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
      stubReaders({
        notices: { ...stubReaders().notices, filing: () => false },
        stream: () => ({ state: "off", pruneBlockedSince: "2026-10-22T09:00:00Z" }),
      }),
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
    });
  });

  it("answers a waiting start with the box's time, the devices agreeing and whether its host answers", async () => {
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({
        startClock: () => ({ agreed: 1, hostAnswers: false, cause: "clock_jumped" }),
      }),
    );
    expect(health.clock.waiting).toEqual({
      boxAt: NOW.toISOString(),
      agreed: 1,
      hostAnswers: false,
      cause: "clock_jumped",
    });
  });

  it("leaves the wait out once the start is confirmed", async () => {
    const health = await collectBoxHealth(suite.db, stubReaders({ startClock: () => null }));
    expect(health.clock).not.toHaveProperty("waiting");
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
    await seedFixtureVenue();
    const active = await seedPrinter("Bar");
    await withTransaction(suite.db, insertA4Printer);
    await seedPrinter("Off", { active: false });
    await seedPrinter("Gone", { active: false, deletedAt: "2026-10-01T00:00:00.000Z" });
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.printers).toEqual([{ id: active, name: "Bar" }]);
  });

  it("lists printers by name", async () => {
    await seedFixtureVenue();
    const second = await seedPrinter("Kitchen");
    const first = await seedPrinter("Bar");
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.printers).toEqual([
      { id: first, name: "Bar" },
      { id: second, name: "Kitchen" },
    ]);
  });

  it("lists only card readers that are switched on, not deleted", async () => {
    const active = await seedReader("Counter");
    await seedReader("Off", { disabledAt: "2026-11-01T00:00:00.000Z" });
    await seedReader("Gone", { deletedAt: "2026-10-01T00:00:00.000Z" });
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

  it("reads the disk for a noted full-disk stop without holding the write lock", async () => {
    let markAsked!: () => void;
    const asked = new Promise<void>((resolve) => (markAsked = resolve));
    let answer!: (full: boolean) => void;
    const answered = new Promise<boolean>((resolve) => (answer = resolve));
    const disk = {
      since: () => NOW,
      full: () => {
        markAsked();
        return answered;
      },
    };
    const space = { current: () => ({ freeBytes: null, readAt: null, lowSince: null }) };
    const health = collectBoxHealth(
      suite.db,
      stubReaders({
        notices: { ...stubReaders().notices, sources: deviceNoticeSources({ disk, space }, []) },
      }),
    );
    const events: string[] = [];
    await asked;
    const write = suite.db.withWriteLock(() => {
      events.push("wrote");
      return Promise.resolve();
    });
    // A free lock runs the write in this turn's microtasks; one held by the read cannot.
    await new Promise((resolve) => setImmediate(resolve));
    events.push("disk answered");
    answer(true);
    await write;
    expect(events).toEqual(["wrote", "disk answered"]);
    expect((await health).notices.map(({ key, owner }) => ({ key, owner }))).toEqual([
      { key: "storage.disk_full", owner: "box" },
    ]);
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
      stubReaders({ notices: { ...stubReaders().notices, sources: () => sources } }),
    );
    expect(health.notices).toEqual([
      { owner: "storage", key: "disk", code: "storage.disk_full", severity: "error", params: {} },
    ]);
    expect(health.noticesUnavailable).toEqual(["printing"]);
  });

  it("counts a source that writes a row as unavailable, and its row does not stay", async () => {
    await seedFixtureVenue();
    const sources: OwnedStaffNoticeSource[] = [
      {
        owner: "writer",
        source: {
          read: async ({ tx }) => {
            await tx.insert(printers).values({ name: "Sneaky", transport: "network_tcp" });
            return [];
          },
        },
      },
    ];
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({ notices: { ...stubReaders().notices, sources: () => sources } }),
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
      sources: () => sources,
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
    const readers = stubReaders({
      notices: { ...stubReaders().notices, sources: () => sources, log },
    });
    await collectBoxHealth(suite.db, readers);
    fail = false;
    await collectBoxHealth(suite.db, readers);
    expect(lines).toEqual(["staff_notice.source_unavailable", "staff_notice.source_recovered"]);
  });
  it("includes the cached spare view without reading a peer", async () => {
    const spare = {
      peerNodeId: "spare",
      generation: null,
      state: "unknown" as const,
      appliedTXID: null,
      uploadedTXID: null,
      lagMs: null,
      lastAppliedAt: null,
      clockAt: null,
    };
    expect(
      (await collectBoxHealth(suite.db, stubReaders({ spare: async () => spare }))).spare,
    ).toEqual(spare);
  });
});
