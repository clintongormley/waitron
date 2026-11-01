import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { isUniqueViolation } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { deviceProfiles } from "./device-profiles.js";
import { printerHolders } from "./printer-holders.js";
import { printers } from "./printers.js";
import { venueLocationId } from "../venue.js";

describe("printer_holders", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let deviceA: string;
  let deviceB: string;
  let printer1: string;
  let printer2: string;

  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    const locationId = await venueLocationId(db);
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name: "Profile", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    ({ deviceId: deviceA } = await seedDevice(db, { profileId: profile!.id, label: "Till A" }));
    ({ deviceId: deviceB } = await seedDevice(db, { profileId: profile!.id, label: "Till B" }));
    const madePrinters = await db
      .insert(printers)
      .values(
        ["10.0.0.1", "10.0.0.2"].map((host) => ({
          locationId,
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
