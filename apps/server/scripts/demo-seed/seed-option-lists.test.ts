// `seedOptionLists`: the demo seed creates the cooking options list `Punto` and attaches it to the
// steak. This file stops at `offeredModifiers`, the field a till draws from; it does not establish
// that a till asks the list.

import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAvailableProducts, listOptionLists, readProductModifiers } from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedOptionLists } from "./seed-option-lists.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One NIF per provisioned venue.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(52_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function provisionVenue(): Promise<{ locationId: string }> {
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  return { locationId: venue.locationId };
}

describe("seedOptionLists", () => {
  it("creates the Punto list with three different names at both levels and attaches it to the steak", async () => {
    const { locationId } = await provisionVenue();

    const { lists, steakId, coffeeId, attachments, available } = await withTransaction(
      suite.db,
      async (tx) => {
        const { productsByImage } = await seedCatalogues(tx, {
          locationId,
          locale: LOCALE,
        });
        await seedOptionLists(tx, { productsByImage, locale: LOCALE });
        const steak = productsByImage.get("solomillo.png")!;
        const coffee = productsByImage.get("cafe-solo.png")!;
        return {
          lists: await listOptionLists(tx),
          steakId: steak,
          coffeeId: coffee,
          attachments: await readProductModifiers(tx, [steak, coffee]),
          available: (await listAvailableProducts(tx, locationId)).products,
        };
      },
    );

    // ONE options list in the demo catalogue, and it is the cooking question.
    expect(lists.map((list) => list.name)).toEqual(["Punto"]);
    const cooked = lists[0]!;
    expect(cooked).toMatchObject({
      name: "Punto",
      customerName: { en: "How would you like it cooked?", es: "¿Cómo la quiere hecha?" },
      kitchenName: "PUNTO CARNE",
      active: true,
    });

    // The three texts differ so a seed that writes one into the wrong column fails here. This
    // checks the names as STORED; a surface reading the wrong one of the three is caught in
    // `apps/server/src/kitchen-print.test.ts`, not here.
    expect(cooked.labels.map((label) => label.name)).toEqual(["Poco", "Punto medio", "Muy"]);
    expect(cooked.labels.map((label) => label.customerName)).toEqual([
      { en: "Rare, red in the middle", es: "Poco hecho, rojo por dentro" },
      { en: "Medium, pink in the middle", es: "Al punto, rosado por dentro" },
      { en: "Well done, cooked through", es: "Muy hecho, sin nada de rosa" },
    ]);
    expect(cooked.labels.map((label) => label.kitchenName)).toEqual([
      "POCO HECHO",
      "AL PUNTO",
      "MUY HECHO",
    ]);
    expect(cooked.labels.every((label) => label.available)).toBe(true);

    // Stored as that label's id — not its position and not its name.
    const medium = cooked.labels.find((label) => label.name === "Punto medio")!;
    expect(cooked.defaultLabelId).toBe(medium.id);

    // Attached to the steak, and to nothing else.
    expect(attachments.get(steakId)).toEqual([{ kind: "options", id: cooked.id }]);
    expect(attachments.get(coffeeId)).toBeUndefined();

    // The list reaches the field a till reads. It is the ONLY thing the steak offers — the demo
    // seeds no extras list and nothing else attaches to this dish.
    const steak = available.find((product) => product.name === "Solomillo")!;
    expect(steak.offeredModifiers).toHaveLength(1);
    expect(steak.offeredModifiers[0]).toMatchObject({
      kind: "options",
      id: cooked.id,
      name: "Punto",
      defaultLabelId: medium.id,
    });
    expect(available.find((product) => product.name === "Café")!.offeredModifiers).toEqual([]);
  });
});
