import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { restrictRefused } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDeviceProfiles, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";

import { devices } from "./devices.js";
import { pagePrinters } from "./page-printers.js";
import { printers } from "./printers.js";
import { locations } from "./tenants.js";

const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const KDS_PROFILE_A = "eeeeeeee-0000-4000-8000-000000000001";
const KDS_PROFILE_B = "eeeeeeee-0000-4000-8000-000000000002";
const RECEIPT_PRINTER = "11111111-0000-4000-8000-0000000000a1";
const PAGE_PRINTER = "11111111-0000-4000-8000-0000000000a2";
const GHOST_PRINTER = "11111111-0000-4000-8000-0000000000ff";
const TOKEN_HASH = "scrypt$00$00";

describe("device labels without a location", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("two active devices cannot share a label, and an inactive one can", async () => {
    await seedDeviceProfiles(suite.db, {
      id: KDS_PROFILE_A,
      name: "Till profile",
      formFactor: "till",
    });
    const insert = (id: string, active: number) =>
      suite.db.run(sql`insert into devices
        (id, device_profile_id, label, token_hash, active, enrolled_at, created_at)
        values (${id}, ${KDS_PROFILE_A}, 'Till', 'hash', ${active}, '2026-11-11', '2026-11-11')`);
    await insert("active", 1);
    await insert("inactive", 0);
    const error = await captureError(() => insert("duplicate", 1));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("UNIQUE constraint failed: devices.label");
    expect(suite.db.all(sql`select id from devices order by id`)).toEqual([
      { id: "active" },
      { id: "inactive" },
    ]);
  });
});

describe("devices schema (columns, FKs, unique)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  // beforeEach, not beforeAll: `useVenueDb` empties every data table after each test by default, so
  // rows seeded once would be gone and every foreign key below would fire for the wrong reason.
  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(locations).values({
      id: LOCATION_B,
    });
    await seedVenueSettings(db, {
      name: "Loc B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await seedBusinessDay(db, {});
    await seedDeviceProfiles(db, [
      { id: KDS_PROFILE_A, name: "KDS A", formFactor: "kds" },
      { id: KDS_PROFILE_B, name: "KDS B", formFactor: "kds" },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  async function seedDevice(label: string, profile: string = KDS_PROFILE_A): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({
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

  describe("the invoice printer choice", () => {
    beforeEach(async () => {
      await suite.db.insert(printers).values({
        id: RECEIPT_PRINTER,
        name: "Receipt printer",
        transport: "cloud_poll",
        pollId: "poll-a",
      });
      await suite.db.insert(pagePrinters).values({
        id: PAGE_PRINTER,
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

    it("refuses deleting a printer either invoice column names, as a restrict", async () => {
      const receiptChoice = await seedDevice("Till 1");
      const pageChoice = await seedDevice("Till 2");
      await setChoice(receiptChoice, { invoicePrinterId: RECEIPT_PRINTER });
      await setChoice(pageChoice, { invoicePagePrinterId: PAGE_PRINTER });
      const receipt = await captureError(() =>
        inTx((tx) => tx.delete(printers).where(eq(printers.id, RECEIPT_PRINTER))),
      );
      expect(restrictRefused(receipt)).toBe(true);
      const page = await captureError(() =>
        inTx((tx) => tx.delete(pagePrinters).where(eq(pagePrinters.id, PAGE_PRINTER))),
      );
      expect(restrictRefused(page)).toBe(true);
    });
  });
});
