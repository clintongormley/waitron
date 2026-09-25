/** The staff seed, end to end. */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin, verifyPin, type PersonRoleValue } from "@waitron/identity";
import { seedStaff } from "./seed-staff.js";
import { DEMO_ADMIN_EMAIL, DEMO_PIN, DEMO_STAFF } from "./staff.js";

const LOCALE = "en-GB";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One NIF per provisioned venue.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function provisionVenue(): Promise<void> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: DEMO_ADMIN_EMAIL,
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
}

describe("seedStaff", () => {
  it("seeds staff across all roles, all on the demo PIN", async () => {
    await provisionVenue();

    const persons = await withTransaction(suite.db, async (tx) => {
      await seedStaff(tx);

      const { rows } = await tx.execute<{
        display_name: string;
        role: PersonRoleValue;
        pin_hash: string;
      }>(sql`select display_name, role, pin_hash from persons order by created_at`);
      return rows;
    });

    // The provisioning admin plus this seed's five people.
    expect(persons.length).toBe(6);

    const nonAdminCount = persons.filter((p) => p.role !== "admin").length;
    expect(nonAdminCount).toBeGreaterThanOrEqual(5);

    // Every one of the four `person_role` values is present (the provisioning admin covers `admin`).
    const roles = new Set(persons.map((p) => p.role));
    expect(roles).toEqual(new Set(["staff", "supervisor", "manager", "admin"]));

    for (const person of persons.filter((p) => p.role !== "admin")) {
      expect(verifyPin(DEMO_PIN, person.pin_hash)).toBe(true);
    }

    // Never plaintext, and never the un-hashed PIN string.
    for (const person of persons) {
      expect(person.pin_hash).not.toBe(DEMO_PIN);
    }
  });

  it("gives every person an email while preserving which demo accounts have preset passwords", async () => {
    await provisionVenue();

    const rows = await withTransaction(suite.db, async (tx) => {
      await seedStaff(tx);

      const { rows } = await tx.execute<{
        display_name: string;
        role: PersonRoleValue;
        email: string | null;
        password_hash: string | null;
      }>(sql`select display_name, role, email, password_hash from persons order by created_at`);
      return rows;
    });

    const admin = rows.find((p) => p.role === "admin");
    expect(admin?.email).toBe(DEMO_ADMIN_EMAIL);
    expect(admin?.email).toMatch(/@/);
    expect(admin?.password_hash).not.toBeNull();

    const manager = rows.find((p) => p.role === "manager");
    expect(manager?.email).toBe("manager@demo.waitron.local");
    expect(manager?.email).toMatch(/@/);
    expect(manager?.email).not.toBe(admin?.email);
    expect(manager?.password_hash).not.toBeNull();

    for (const person of rows.filter((p) => p.role === "supervisor" || p.role === "staff")) {
      expect(person.email).toBe(
        DEMO_STAFF.find((seeded) => seeded.displayName === person.display_name)!.email,
      );
      expect(person.password_hash).toBeNull();
    }
  });
});
