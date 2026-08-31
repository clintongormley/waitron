// Real-Postgres proof of `seedOptions` (Phase 4, Task 13): it creates the demo modifier groups
// (menu.ts's `PRODUCT_OPTION_GROUPS`) and attaches them to their named products, so the till shows a
// picker on those two dishes and a plain ring on everything else. Real Postgres, not PGlite: the
// option-group tables are under FORCE ROW LEVEL SECURITY and this runs as `app_user` (the same posture
// `seedCatalogues` proves itself under, CLAUDE.md §4) — PGlite's superuser connection would bypass that
// and prove nothing about the grants.

import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAvailableProducts } from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedOptions } from "./seed-options.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF. A distinct base (60_000_000) keeps this suite's NIFs
// from colliding with seed-catalogue's 50M and seed-sales' 80M ranges on the shared container.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
async function provisionVenue(): Promise<{ tenantId: string; locationId: string }> {
  const venue = await applyVenue(
    planVenue({
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
    }),
    { db: suite.admin },
  );
  return { tenantId: venue.tenantId, locationId: venue.locationId };
}

describe("seedOptions", () => {
  it("attaches Size+Milk to the coffee and Extras+Cooking to the steak, and leaves a plain dish alone", async () => {
    const { tenantId, locationId } = await provisionVenue();

    const products = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const { productsByImage } = await seedCatalogues(tx, { locationId, locale: LOCALE });
      await seedOptions(tx, { productsByImage, locale: LOCALE });
      return (await listAvailableProducts(tx, locationId)).products;
    });

    const coffee = products.find((p) => p.descriptions[LOCALE] === "Coffee");
    const steak = products.find((p) => p.descriptions[LOCALE] === "Sirloin in whisky sauce");
    const plain = products.find((p) => p.descriptions[LOCALE] === "Spicy potatoes");
    expect(coffee).toBeDefined();
    expect(steak).toBeDefined();
    expect(plain).toBeDefined();

    // Coffee: Size (required, 1 of 2) + Milk (required, 1 of 3), in that order.
    const coffeeGroupNames = coffee!.optionGroups.map((g) => g.name[LOCALE]);
    expect(coffeeGroupNames).toEqual(["Size", "Milk"]);
    const size = coffee!.optionGroups.find((g) => g.name[LOCALE] === "Size")!;
    expect(size.required).toBe(true);
    expect(size.minSelect).toBe(1);
    expect(size.maxSelect).toBe(1);
    expect(size.items.map((i) => i.name[LOCALE])).toEqual(["Small", "Large"]);
    expect(size.items.find((i) => i.name[LOCALE] === "Large")!.priceDelta).toBe("0.50");
    const milk = coffee!.optionGroups.find((g) => g.name[LOCALE] === "Milk")!;
    expect(milk.required).toBe(true);
    expect(milk.items.map((i) => i.name[LOCALE])).toEqual([
      "Whole milk",
      "Oat milk",
      "Semi-skimmed milk",
    ]);

    // Steak: Extras (optional, 0..3) + Cooking (required, 1 of 3), in that order.
    const steakGroupNames = steak!.optionGroups.map((g) => g.name[LOCALE]);
    expect(steakGroupNames).toEqual(["Extras", "Cooking"]);
    const extras = steak!.optionGroups.find((g) => g.name[LOCALE] === "Extras")!;
    expect(extras.required).toBe(false);
    expect(extras.minSelect).toBe(0);
    expect(extras.maxSelect).toBe(3);
    expect(extras.items.map((i) => i.name[LOCALE]).sort()).toEqual(
      ["Bacon", "Blue cheese sauce", "Fried egg"].sort(),
    );
    const cooking = steak!.optionGroups.find((g) => g.name[LOCALE] === "Cooking")!;
    expect(cooking.required).toBe(true);
    expect(cooking.items.map((i) => i.name[LOCALE])).toEqual(["Rare", "Medium", "Well done"]);

    // A plain each-priced dish gets no groups at all.
    expect(plain!.optionGroups).toEqual([]);
  });
});
