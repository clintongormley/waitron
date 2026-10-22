import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { invoiceSeries, locations, printers } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandLocationId } from "@waitron/shared";
import { collectBoxHealth, type BoxHealthReaders } from "./box-health.js";
import { createStaffNoticeLog } from "./staff-notices.js";

const NOW = new Date("2026-10-22T10:00:00.000Z");

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => set.name !== "payments"),
    null,
  ),
});

function stubReaders(paymentsEnabled: boolean): BoxHealthReaders {
  return {
    now: () => NOW,
    notices: {
      sources: [],
      clock: {
        now: () => ({
          instant: NOW,
          offsetMinutes: 0,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
      },
      filing: () => false,
      log: createStaffNoticeLog(() => {}),
    },
    stream: () => ({ state: "off" }),
    authorityClock: () => ({ state: "unknown" }),
    timeHealth: async () => ({ synced: false, source: "unavailable", warn: false }),
    disk: { since: () => null },
    space: { current: () => ({ freeBytes: null, readAt: null, lowSince: null }) },
    usage: async () => ({
      freeBytes: null,
      totalBytes: null,
      databaseBytes: null,
      backupsBytes: null,
      logBytes: null,
      otherBytes: null,
    }),
    free: async () => null,
    leftovers: async () => ({ bytes: 0, backupRunning: false }),
    paymentsEnabled,
    canFree: () => true,
  };
}

async function seedVenue(): Promise<string> {
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  const node = await seedNode(suite.db, brandLocationId(location!.id));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: node, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  await suite.db.run(
    sql`insert into sales (id, source, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values ('00000000-0000-4000-8000-000000000001', 'operator_script', ${node}, ${series!.id}, 1, '2026-10-21T12:00:00.000Z', 120, 100, '[]', 'es-ES', '["es-ES"]', 'verifactu', 'recorded')`,
  );
  const [printer] = await suite.db
    .insert(printers)
    .values({ locationId: location!.id, name: "Bar", transport: "network_tcp", host: "10.0.0.1" })
    .returning({ id: printers.id });
  return printer!.id;
}

describe("collectBoxHealth on a box without the payments module", () => {
  it("a box with card payments off answers, with no readers", async () => {
    const printer = await seedVenue();
    const health = await collectBoxHealth(suite.db, stubReaders(false));
    expect(health.readers).toBeNull();
    expect(health.printers).toEqual([{ id: printer, name: "Bar" }]);
    expect(health.sales.lastAt).toBe("2026-10-21T12:00:00.000Z");
  });

  it("reading the readers there fails, as the table is not there", async () => {
    await seedVenue();
    await expect(collectBoxHealth(suite.db, stubReaders(true))).rejects.toThrow(
      /no such table: card_readers/,
    );
  });
});
