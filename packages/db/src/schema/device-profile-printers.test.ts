import { insertA4Printer } from "../testing/printers.js";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { restrictRefused } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, NOT_NULL_VIOLATION } from "../sql-state.js";
import { isRefusal, isUniqueViolation } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDeviceProfiles, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { deviceProfilePrinters } from "./device-profile-printers.js";

import { printers } from "./printers.js";

describe("device_profile_printers defaults", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let profile: string;
  let printer1: string;
  let printer2: string;
  let pagePrinter: string;

  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
    });
    const [made] = await seedDeviceProfiles(db, { name: "Profile", formFactor: "till" });
    profile = made!.id;
    const madePrinters = await db
      .insert(printers)
      .values(
        ["10.0.0.1", "10.0.0.2"].map((host) => ({
          name: host,
          transport: "network_tcp" as const,
          host,
          hasCashDrawer: true,
        })),
      )
      .returning({ id: printers.id });
    [printer1, printer2] = madePrinters.map((p) => p.id) as [string, string];
    const madePageId = await insertA4Printer(db, { name: "Office printer", host: "10.0.0.9" });
    pagePrinter = madePageId;
  });

  it("refuses a second default for one role of one profile", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values({
        deviceProfileId: profile,
        printerId: printer1,
        role: "receipt",
        position: 0,
        isDefault: true,
      }),
    );
    const e = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(deviceProfilePrinters).values({
          deviceProfileId: profile,
          printerId: printer2,
          role: "receipt",
          position: 1,
          isDefault: true,
        }),
      ),
    );
    expect(isUniqueViolation(e)).toBe(true);
  });

  it("one default per role, three roles on one profile, is accepted", async () => {
    const roles = ["receipt", "payment_slip", "cash_drawer"] as const;
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values(
        roles.flatMap((role) => [
          { deviceProfileId: profile, printerId: printer1, role, position: 0, isDefault: true },
          { deviceProfileId: profile, printerId: printer2, role, position: 1 },
        ]),
      ),
    );
    const rows = await suite.db
      .select()
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile));
    expect(rows).toHaveLength(6);
    expect(
      rows
        .filter((r) => r.isDefault)
        .map((r) => [r.role, r.printerId])
        .sort(),
    ).toEqual(roles.map((role) => [role, printer1]).sort());
    expect(rows.filter((r) => !r.isDefault).every((r) => r.printerId === printer2)).toBe(true);
  });

  it("stores the cash_drawer role", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values({
        deviceProfileId: profile,
        printerId: printer1,
        role: "cash_drawer",
        position: 0,
      }),
    );
    const [row] = await suite.db
      .select({ role: deviceProfilePrinters.role, isDefault: deviceProfilePrinters.isDefault })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile));
    expect(row).toEqual({ role: "cash_drawer", isDefault: false });
  });

  it("printer_id accepts an office printer and refuses an unknown id", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values({
        deviceProfileId: profile,
        printerId: pagePrinter,
        role: "invoice",
        position: 0,
      }),
    );
    const [row] = await suite.db
      .select({ printerId: deviceProfilePrinters.printerId })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile));
    expect(row!.printerId).toBe(pagePrinter);
    const e = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(deviceProfilePrinters).values({
          deviceProfileId: profile,
          printerId: "unknown-printer",
          role: "invoice",
          position: 1,
        }),
      ),
    );
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses deleting a page printer an invoice row names, as a restrict", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values({
        deviceProfileId: profile,
        printerId: pagePrinter,
        role: "invoice",
        position: 0,
      }),
    );
    const e = await captureError(() =>
      withTransaction(suite.db, (tx) => tx.delete(printers).where(eq(printers.id, pagePrinter))),
    );
    expect(restrictRefused(e)).toBe(true);
  });

  const targetRefusal = async (row: {
    printerId: string;
    role: "receipt" | "payment_slip" | "cash_drawer" | "invoice";
  }): Promise<unknown> =>
    captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(deviceProfilePrinters).values({ deviceProfileId: profile, position: 0, ...row }),
      ),
    );

  it("accepts an invoice row naming a page printer", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values({
        deviceProfileId: profile,
        printerId: pagePrinter,
        role: "invoice",
        position: 0,
        isDefault: true,
      }),
    );
    const rows = await suite.db
      .select({
        printerId: deviceProfilePrinters.printerId,
        role: deviceProfilePrinters.role,
      })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile));
    expect(rows).toEqual([{ printerId: pagePrinter, role: "invoice" }]);
  });

  it.each(["invoice", "receipt"])("requires a printer on the %s role", async (role) => {
    const error = await captureError(() =>
      suite.db.run(sql`insert into device_profile_printers
        (id, device_profile_id, role, position) values ('missing-printer', ${profile}, ${role}, 0)`),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "NOT NULL constraint failed: device_profile_printers.printer_id",
    );
  });

  it("refuses one page printer twice on a profile's invoice role", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values({
        deviceProfileId: profile,
        printerId: pagePrinter,
        role: "invoice",
        position: 0,
      }),
    );
    const e = await targetRefusal({ printerId: pagePrinter, role: "invoice" });
    expect(isUniqueViolation(e)).toBe(true);
    expect(engineErrorMessage(e)).toBe(
      "UNIQUE constraint failed: device_profile_printers.device_profile_id, device_profile_printers.role, device_profile_printers.printer_id",
    );
  });

  it("accepts a page printer and a receipt printer as two invoice rows", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfilePrinters).values([
        { deviceProfileId: profile, printerId: pagePrinter, role: "invoice", position: 0 },
        {
          deviceProfileId: profile,
          printerId: printer1,
          role: "invoice",
          position: 1,
          isDefault: true,
        },
      ]),
    );
    const rows = await suite.db
      .select({
        printerId: deviceProfilePrinters.printerId,
        isDefault: deviceProfilePrinters.isDefault,
      })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile))
      .orderBy(deviceProfilePrinters.position);
    expect(rows).toEqual([
      { printerId: pagePrinter, isDefault: false },
      { printerId: printer1, isDefault: true },
    ]);
  });
});
