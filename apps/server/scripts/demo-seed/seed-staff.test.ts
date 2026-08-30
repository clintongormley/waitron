// Real-Postgres proof of `seedStaff` (Phase 2, Task 8): it inserts the demo staff, all on `DEMO_PIN`.
// Real Postgres (not PGlite): the seed runs under RLS as `app_user` (SELECT/INSERT on `persons`,
// granted by drizzle/0001_identity_rls.sql) exactly as the demo scripts do, and PGlite's superuser
// connection would bypass FORCE ROW LEVEL SECURITY and prove nothing about those grants (CLAUDE.md
// §4). Uses the shared `manifest` template, cloned per file via `useTemplateDb`, the same pattern as
// `seed-catalogue.test.ts` / `seed-floor.test.ts`.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { hashPassword, hashPin, verifyPin, type PersonRoleValue } from "@waitron/identity";
import { seedStaff } from "./seed-staff.js";
import { DEMO_PIN } from "./staff.js";

const LOCALE = "en-GB";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same local-counter shape `seed-catalogue.test.ts`
// / `seed-floor.test.ts` use, on a fresh base (60_000_000 is already taken by `seed-floor.test.ts`).
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the tenant id the seed needs. */
async function provisionVenue(): Promise<{ tenantId: string }> {
  const venue = await applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );
  return { tenantId: venue.tenantId };
}

describe("seedStaff", () => {
  it("seeds staff across all roles, all on the demo PIN", async () => {
    const { tenantId } = await provisionVenue();

    const persons = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
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

    // At least 5 persons beyond the provisioned admin.
    const nonAdminCount = persons.filter((p) => p.role !== "admin").length;
    expect(nonAdminCount).toBeGreaterThanOrEqual(5);

    // Every one of the four `person_role` values is present (the provisioning admin covers `admin`).
    const roles = new Set(persons.map((p) => p.role));
    expect(roles).toEqual(new Set(["staff", "supervisor", "manager", "admin"]));

    // Every SEEDED (non-admin) person's PIN hash verifies against the shared demo PIN.
    for (const person of persons.filter((p) => p.role !== "admin")) {
      expect(verifyPin(DEMO_PIN, person.pin_hash)).toBe(true);
    }

    // Never plaintext, and never the un-hashed PIN string.
    for (const person of persons) {
      expect(person.pin_hash).not.toBe(DEMO_PIN);
    }
  });
});
