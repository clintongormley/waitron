import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, incidents, invoiceSeries, locations, printers } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import type { TrustedReading } from "@waitron/fiscal";
import { hashPin, IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import { cardReaders, DEMO_READER_ID, PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import {
  collectBoxHealth,
  misdatedHandledCountQuery,
  misdatedHandledQuery,
  misdatedOpenQuery,
  readMisdatedHandled,
  type BoxHealthReaders,
  type ClockStopView,
} from "./box-health.js";
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
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, PAYMENTS_MIGRATIONS],
});

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
      clockCheckWaiting: null,
      misdatedOpen: [],
      misdatedHandledCount: 0,
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
    const view = { proof: "none" } as ClockStopView;
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

  it("passes the waiting check reader's answer through, asking it with the database, and is null without one", async () => {
    const asked: unknown[] = [];
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({
        clockCheckWaiting: async (db) => {
          asked.push(db);
          return { since: "2026-10-22T09:00:00.000Z" };
        },
      }),
    );
    expect(health.clockCheckWaiting).toEqual({ since: "2026-10-22T09:00:00.000Z" });
    expect(asked).toEqual([suite.db]);
    expect((await collectBoxHealth(suite.db, stubReaders())).clockCheckWaiting).toBeNull();
  });

  it("lists each open wrongly-dated-sales alert's params with its incident id, oldest first, and counts the handled one without listing it", async () => {
    const params = (confirmationId: string) => ({
      confirmationId,
      count: 2,
      from: "2026-10-22T08:00:00.000Z",
      fromOffsetMinutes: 120,
      to: "2026-10-22T08:30:00.000Z",
      toOffsetMinutes: 120,
      partial: false,
      unconfirmed: false,
    });
    const ids = await suite.db
      .insert(incidents)
      .values([
        {
          source: "dashboard",
          code: "clock.records_misdated",
          params: params("later"),
          severity: "error",
          detectedAt: "2026-10-22T09:30:00.000Z",
        },
        {
          source: "fiscal_filing",
          code: "clock.records_misdated",
          params: params("earlier"),
          severity: "error",
          detectedAt: "2026-10-22T09:00:00.000Z",
        },
        {
          source: "payment_check",
          code: "clock.records_misdated",
          params: params("handled"),
          severity: "error",
          detectedAt: "2026-10-22T08:00:00.000Z",
          acknowledgedAt: "2026-10-22T09:45:00.000Z",
        },
        {
          source: "dashboard",
          code: "clock.behind_chain_restarted",
          params: params("other code"),
          severity: "warning",
          detectedAt: "2026-10-22T08:00:00.000Z",
        },
      ])
      .returning({ id: incidents.id });

    const health = await collectBoxHealth(suite.db, stubReaders());

    expect(health.misdatedOpen).toEqual([
      { incidentId: ids[1]!.id, ...params("earlier") },
      { incidentId: ids[0]!.id, ...params("later") },
    ]);
    expect(health.misdatedHandledCount).toBe(1);
  });

  it("reads the handled wrongly-dated-sales alerts newest first, each with who handled it", async () => {
    const params = (confirmationId: string) => ({
      confirmationId,
      count: 0,
      from: "2026-10-22T08:00:00.000Z",
      fromOffsetMinutes: 0,
      partial: true,
      unconfirmed: true,
    });
    const [rosa] = await suite.db
      .insert(persons)
      .values({ displayName: "Rosa Handler", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const ids = await suite.db
      .insert(incidents)
      .values([
        {
          source: "dashboard",
          code: "clock.records_misdated",
          params: params("by the box"),
          severity: "error",
          detectedAt: "2026-10-22T08:00:00.000Z",
          acknowledgedAt: "2026-10-22T11:00:00.000Z",
        },
        {
          source: "fiscal_filing",
          code: "clock.records_misdated",
          params: params("by Rosa"),
          severity: "error",
          detectedAt: "2026-10-22T09:30:00.000Z",
          acknowledgedAt: "2026-10-22T09:45:00.000Z",
          acknowledgedBy: rosa!.id,
        },
        {
          source: "payment_check",
          code: "clock.records_misdated",
          params: params("by nobody known"),
          severity: "error",
          detectedAt: "2026-10-22T09:00:00.000Z",
          acknowledgedAt: "2026-10-22T10:00:00.000Z",
          acknowledgedBy: "99999999-9999-4999-8999-999999999999",
        },
        {
          source: "dashboard",
          code: "clock.records_misdated",
          params: params("open"),
          severity: "error",
          detectedAt: "2026-10-22T10:00:00.000Z",
        },
        {
          source: "dashboard",
          code: "clock.behind_chain_restarted",
          params: params("other code"),
          severity: "warning",
          detectedAt: "2026-10-22T10:30:00.000Z",
          acknowledgedAt: "2026-10-22T10:45:00.000Z",
        },
      ])
      .returning({ id: incidents.id });

    expect(await suite.db.withWriteLock(() => readMisdatedHandled(suite.db))).toEqual([
      {
        incidentId: ids[1]!.id,
        ...params("by Rosa"),
        handledAt: "2026-10-22T09:45:00.000Z",
        handledBy: { kind: "person", name: "Rosa Handler" },
      },
      {
        incidentId: ids[2]!.id,
        ...params("by nobody known"),
        handledAt: "2026-10-22T10:00:00.000Z",
        handledBy: { kind: "person", name: null },
      },
      {
        incidentId: ids[0]!.id,
        ...params("by the box"),
        handledAt: "2026-10-22T11:00:00.000Z",
        handledBy: { kind: "box" },
      },
    ]);
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

function replayEmitted(emitted: { sql: string; params: unknown[] }, prefix: string) {
  const parts = emitted.sql.split("?");
  expect(parts).toHaveLength(emitted.params.length + 1);
  const statement = sql.raw(`${prefix}${parts[0]}`);
  for (let i = 0; i < emitted.params.length; i++) {
    statement.append(sql`${emitted.params[i]}`);
    statement.append(sql.raw(parts[i + 1]!));
  }
  return statement;
}

describe("the wrongly dated sales reads", () => {
  it.each([
    ["open", () => misdatedOpenQuery(suite.db).toSQL()],
    ["handled", () => misdatedHandledQuery(suite.db).toSQL()],
    ["handled count", () => misdatedHandledCountQuery(suite.db).toSQL()],
  ])("plans the %s read on the code and detection index, not a scan", async (_name, emit) => {
    const plan = await suite.db.execute<{ detail: string }>(
      replayEmitted(emit(), "explain query plan "),
    );
    const details = plan.rows.map((row) => row.detail);
    expect(details.some((d) => d.includes("USING INDEX incidents_code_detected_idx"))).toBe(true);
    expect(details.some((d) => d.includes("SCAN incidents"))).toBe(false);
  });

  it("stores and reads back a handled incident's note", async () => {
    const [row] = await suite.db
      .insert(incidents)
      .values({
        source: "dashboard",
        code: "clock.records_misdated",
        severity: "error",
        detectedAt: "2026-10-22T08:00:00.000Z",
        acknowledgedAt: "2026-10-22T11:00:00.000Z",
        acknowledgedNote: "Checked with the accountant",
      })
      .returning({ id: incidents.id });
    const [read] = await suite.db
      .select({ note: incidents.acknowledgedNote })
      .from(incidents)
      .where(eq(incidents.id, row!.id));
    expect(read).toEqual({ note: "Checked with the accountant" });
  });
});
