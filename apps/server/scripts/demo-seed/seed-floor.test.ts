// Real-Postgres proof of `seedFloor` (Phase 2, Task 7): it stands up the three floor-plan zones,
// ~16 placed tables, and the four service statuses. Real Postgres (not PGlite): the seed runs under
// RLS as `app_user` (SELECT/INSERT on `floor_zones`/`dining_tables`/`table_service_statuses`) exactly
// as the demo scripts do, and PGlite's superuser connection would bypass FORCE ROW LEVEL SECURITY and
// prove nothing about those grants (CLAUDE.md §4). Uses the shared `manifest` template, cloned per
// file via `useTemplateDb`, the same pattern as `seed-catalogue.test.ts`.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { seedFloor } from "./seed-floor.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF — the same local-counter shape
// `seed-catalogue.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
async function provisionVenue(): Promise<{ tenantId: string; locationId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  return { tenantId: venue.tenantId, locationId: venue.locationId };
}

describe("seedFloor", () => {
  it("creates the three zones, ~16 placed tables, and the four service statuses", async () => {
    const { tenantId, locationId } = await provisionVenue();

    const res = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      await seedFloor(tx, { tenantId, locationId, locale: LOCALE });

      const { rows: zones } = await tx.execute<{ name: string; active: boolean }>(
        sql`select name, active from floor_zones where location_id = ${locationId} order by display_order`,
      );
      const { rows: tables } = await tx.execute<{
        label: string;
        zone_id: string | null;
        capacity: number | null;
        pos_x: number | null;
        pos_y: number | null;
        shape: string | null;
      }>(
        sql`select label, zone_id, capacity, pos_x, pos_y, shape from dining_tables where location_id = ${locationId} order by label`,
      );
      const { rows: statuses } = await tx.execute<{ label: string; color: string }>(
        sql`select label, color from table_service_statuses order by display_order`,
      );
      return { zones, tables, statuses };
    });

    // Three active zones, in the authored order.
    expect(res.zones.map((z) => z.name)).toEqual(["Comedor", "Terraza", "Barra"]);
    expect(res.zones.every((z) => z.active)).toBe(true);

    // ~16 tables, each placed (a live zone, a capacity, and a full spatial placement).
    expect(res.tables.length).toBe(16);
    for (const table of res.tables) {
      expect(table.zone_id).not.toBeNull();
      expect(table.capacity).not.toBeNull();
      expect(table.pos_x).not.toBeNull();
      expect(table.pos_y).not.toBeNull();
      expect(table.shape).not.toBeNull();
    }

    // Four statuses, in the authored order, each with its own colour.
    expect(res.statuses.map((s) => s.label)).toEqual([
      "Free",
      "Occupied",
      "Reserved",
      "Bill requested",
    ]);
    expect(new Set(res.statuses.map((s) => s.color)).size).toBe(4);
  });
});
