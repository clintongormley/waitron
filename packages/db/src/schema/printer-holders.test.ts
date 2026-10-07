import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { isUniqueViolation } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { printerHolders } from "./printer-holders.js";
import { printers } from "./printers.js";
import { locations, tenants } from "./tenants.js";

describe("printer_holders", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let deviceA: string;
  let deviceB: string;
  let printer1: string;
  let printer2: string;

  beforeEach(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" })
      .onConflictDoNothing({ target: tenants.id });
    const [location] = await db
      .insert(locations)
      .values({ name: "Loc A", invoiceLocales: ["es"], operationDescription: "Hostelería" })
      .returning({ id: locations.id });
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name: "Profile", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    const made = await db
      .insert(devices)
      .values(
        ["Till A", "Till B"].map((label) => ({
          locationId: location!.id,
          deviceProfileId: profile!.id,
          label,
          tokenHash: "scrypt$00$00",
        })),
      )
      .returning({ id: devices.id });
    [deviceA, deviceB] = made.map((d) => d.id) as [string, string];
    const madePrinters = await db
      .insert(printers)
      .values(
        ["10.0.0.1", "10.0.0.2"].map((host) => ({
          locationId: location!.id,
          name: host,
          transport: "network_tcp" as const,
          host,
        })),
      )
      .returning({ id: printers.id });
    [printer1, printer2] = madePrinters.map((p) => p.id) as [string, string];
  });

  it("refuses a second holder for one printer", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(printerHolders).values({ printerId: printer1, deviceId: deviceA }),
    );
    const e = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(printerHolders).values({ printerId: printer1, deviceId: deviceB }),
      ),
    );
    expect(isUniqueViolation(e)).toBe(true);
  });

  it("two printers may each have a holder, one device may hold both", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(printerHolders).values([
        { printerId: printer1, deviceId: deviceA },
        { printerId: printer2, deviceId: deviceA },
      ]),
    );
    const rows = await suite.db.select().from(printerHolders);
    expect(rows.map((r) => [r.printerId, r.deviceId]).sort()).toEqual(
      [
        [printer1, deviceA],
        [printer2, deviceA],
      ].sort(),
    );
    expect(rows.every((r) => typeof r.heldAt === "string")).toBe(true);
  });
});
