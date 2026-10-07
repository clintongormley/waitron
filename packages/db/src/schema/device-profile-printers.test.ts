import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { isUniqueViolation } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { deviceProfilePrinters } from "./device-profile-printers.js";
import { deviceProfiles } from "./device-profiles.js";
import { printers } from "./printers.js";
import { locations, tenants } from "./tenants.js";

describe("device_profile_printers defaults", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let profile: string;
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
    const [made] = await db
      .insert(deviceProfiles)
      .values({ name: "Profile", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    profile = made!.id;
    const madePrinters = await db
      .insert(printers)
      .values(
        ["10.0.0.1", "10.0.0.2"].map((host) => ({
          locationId: location!.id,
          name: host,
          transport: "network_tcp" as const,
          host,
          hasCashDrawer: true,
        })),
      )
      .returning({ id: printers.id });
    [printer1, printer2] = madePrinters.map((p) => p.id) as [string, string];
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
});
