/** The staff seed, end to end. */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { verifyPin, type PersonRoleValue } from "@waitron/identity";
import { seedStaff } from "./seed-staff.js";
import { DEMO_ADMIN_EMAIL, DEMO_PIN, DEMO_STAFF } from "./staff.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE = "en-GB";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 70_000_000,
  invoiceLocale: LOCALE,
  adminEmail: DEMO_ADMIN_EMAIL,
});

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
      expect(await verifyPin(DEMO_PIN, person.pin_hash)).toBe(true);
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
