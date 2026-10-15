import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { pagePrinters } from "./page-printers.js";
import { printers } from "./printers.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the column mapping and the location foreign key.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const KDS_PROFILE_A = "eeeeeeee-0000-4000-8000-000000000001";
const KDS_PROFILE_B = "eeeeeeee-0000-4000-8000-000000000002";
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
const RECEIPT_PRINTER = "11111111-0000-4000-8000-0000000000a1";
const PAGE_PRINTER = "11111111-0000-4000-8000-0000000000a2";
const GHOST_PRINTER = "11111111-0000-4000-8000-0000000000ff";
const TOKEN_HASH = "scrypt$00$00";

describe("devices schema (columns, FKs, unique)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  // beforeEach, not beforeAll: `useVenueDb` empties every data table after each test by default, so
  // rows seeded once would be gone and every foreign key below would fire for the wrong reason.
  beforeEach(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      {
        id: LOCATION_B,
        name: "Loc B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    await db.insert(deviceProfiles).values([
      { id: KDS_PROFILE_A, name: "KDS A", formFactor: "kds" },
      { id: KDS_PROFILE_B, name: "KDS B", formFactor: "kds" },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  async function seedDevice(
    label: string,
    location: string = LOCATION_A,
    profile: string = KDS_PROFILE_A,
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({
          locationId: location,
          deviceProfileId: profile,
          label,
          tokenHash: TOKEN_HASH,
        })
        .returning({ id: devices.id });
      return row!.id;
    });
  }

  it("devices: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedDevice("Kitchen screen");
    await inTx((tx) =>
      tx.update(devices).set({ lastSeenAt: new Date().toISOString() }).where(eq(devices.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(devices).where(eq(devices.id, id)));
    expect(row!.deviceProfileId).toBe(KDS_PROFILE_A);
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.label).toBe("Kitchen screen");
    expect(row!.active).toBe(true);
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("devices: carries no station_id or watcher_id column", () => {
    const columns = suite.db
      .all<{ name: string }>(sql`select name from pragma_table_info('devices')`)
      .map((row) => row.name);
    expect(columns).toContain("device_profile_id");
    expect(columns).not.toContain("station_id");
    expect(columns).not.toContain("watcher_id");
  });

  it("devices: carries a nullable deleted_at that reads back, null by default", async () => {
    const columns = suite.db.all<{ name: string; notnull: number }>(
      sql`select name, "notnull" from pragma_table_info('devices')`,
    );
    expect(columns.find((c) => c.name === "deleted_at")).toEqual({
      name: "deleted_at",
      notnull: 0,
    });
    const id = await seedDevice("Till 1");
    const [fresh] = suite.db.all<{ deleted_at: string | null }>(
      sql`select deleted_at from devices where id = ${id}`,
    );
    expect(fresh!.deleted_at).toBeNull();
    await inTx((tx) =>
      tx.update(devices).set({ deletedAt: "2026-10-10T10:00:00.000Z" }).where(eq(devices.id, id)),
    );
    const [typed] = await inTx((tx) =>
      tx.select({ deletedAt: devices.deletedAt }).from(devices).where(eq(devices.id, id)),
    );
    expect(typed!.deletedAt).toBe("2026-10-10T10:00:00.000Z");
  });

  it("devices: a deleted device frees its name, as a disabled one does", async () => {
    const first = await seedDevice("Till 1");
    await inTx(async (tx) => {
      await tx.execute(
        sql`update devices set active = 0, deleted_at = '2026-10-10T10:00:00.000Z' where id = ${first}`,
      );
    });
    const second = await seedDevice("Till 1");
    expect(second).not.toBe(first);
  });

  it("devices: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    // Positive control first, so the rejection below is the location FK and not a malformed row.
    await seedDevice("Real location", LOCATION_B);
    const e = await captureError(() => seedDevice("Ghost location", GHOST_LOCATION));
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  describe("the invoice printer choice", () => {
    beforeEach(async () => {
      await suite.db.insert(printers).values({
        id: RECEIPT_PRINTER,
        locationId: LOCATION_A,
        name: "Receipt printer",
        transport: "cloud_poll",
        pollId: "poll-a",
      });
      await suite.db.insert(pagePrinters).values({
        id: PAGE_PRINTER,
        locationId: LOCATION_A,
        name: "Office printer",
        host: "10.0.0.9",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
      });
    });

    async function setChoice(
      id: string,
      choice: { invoicePrinterId?: string; invoicePagePrinterId?: string },
    ): Promise<void> {
      await inTx((tx) => tx.update(devices).set(choice).where(eq(devices.id, id)));
    }

    it("invoice_printer_id accepts a receipt printer and refuses an unknown id", async () => {
      const id = await seedDevice("Till 1");
      await setChoice(id, { invoicePrinterId: RECEIPT_PRINTER });
      const [row] = await inTx((tx) =>
        tx
          .select({ invoicePrinterId: devices.invoicePrinterId })
          .from(devices)
          .where(eq(devices.id, id)),
      );
      expect(row!.invoicePrinterId).toBe(RECEIPT_PRINTER);
      const e = await captureError(() => setChoice(id, { invoicePrinterId: GHOST_PRINTER }));
      expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it("invoice_page_printer_id accepts a page printer and refuses an unknown id", async () => {
      const id = await seedDevice("Till 1");
      await setChoice(id, { invoicePagePrinterId: PAGE_PRINTER });
      const [row] = await inTx((tx) =>
        tx
          .select({ invoicePagePrinterId: devices.invoicePagePrinterId })
          .from(devices)
          .where(eq(devices.id, id)),
      );
      expect(row!.invoicePagePrinterId).toBe(PAGE_PRINTER);
      const e = await captureError(() => setChoice(id, { invoicePagePrinterId: RECEIPT_PRINTER }));
      expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
    });
  });
});
