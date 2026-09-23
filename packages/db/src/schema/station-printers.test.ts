import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { stationPrinters } from "./station-printers.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the column mapping and the composite primary key.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("station_printers schema (KDS-4 mapping — PK + FKs)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // The Drizzle builder rather than raw SQL throughout: `id` and `created_at` on both parent tables
  // are `$defaultFn` columns applied CLIENT-side, so a raw `insert` reaches neither.
  async function seedStation(name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(kitchenStations)
        .values({ locationId: LOCATION_A, name })
        .returning({ id: kitchenStations.id });
      return row!.id;
    });
  }

  // A cloud_poll printer (needs only poll_id — no agent, so no print_agents fixture) satisfies the
  // printers transport CHECK, keeping this suite to the two tables the mapping actually references.
  async function seedPrinter(name: string, pollId: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(printers)
        .values({ locationId: LOCATION_A, name, transport: "cloud_poll", pollId })
        .returning({ id: printers.id });
      return row!.id;
    });
  }

  async function seedMapping(station: string, printer: string): Promise<void> {
    await inTx((tx) =>
      tx.insert(stationPrinters).values({ stationId: station, printerId: printer }),
    );
  }

  it("maps every column through the Drizzle export and detaches by DELETE … RETURNING", async () => {
    const station = await seedStation("Cocina");
    const printer = await seedPrinter("Impresora Cocina", "poll-control");
    await seedMapping(station, printer);
    const [row] = await inTx((tx) =>
      tx.select().from(stationPrinters).where(eq(stationPrinters.stationId, station)),
    );
    expect(row!.stationId).toBe(station);
    expect(row!.printerId).toBe(printer);
    // A mapping row is REMOVED via DELETE — detach in §3a.
    const deleted = await inTx((tx) =>
      tx
        .delete(stationPrinters)
        .where(and(eq(stationPrinters.stationId, station), eq(stationPrinters.printerId, printer)))
        .returning({ printerId: stationPrinters.printerId }),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.printerId).toBe(printer);
  });

  it("the primary key rejects a duplicate (station_id, printer_id) mapping", async () => {
    const station = await seedStation("Barra");
    const printer = await seedPrinter("Impresora Barra", "poll-dup");
    await seedMapping(station, printer);
    const e = await captureError(() => seedMapping(station, printer));
    expect(isRefusal(e, UNIQUE_VIOLATION)).toBe(true);
  });
});
