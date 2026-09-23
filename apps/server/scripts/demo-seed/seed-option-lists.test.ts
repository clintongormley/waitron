// `seedOptionLists`: the demo seed creates the cooking options list `Punto` — the
// generic replacement for the deleted built-in `doneness` field — and attaches it to the steak, so
// the demo data still carries the question "how do you want it cooked?".
//
// What this does NOT establish is that a TILL asks it. What is asserted is the seed and three reads
// of what it stored: `listOptionLists` (the list, its three names and its labels),
// `readProductModifiers` (the attachment row on the steak and none on the coffee), and
// `listAvailableProducts` — whose `offeredModifiers` is the field a till draws from
// (`readOfferedModifiers`, `packages/catalogue/src/offered-modifiers.ts`). Reaching that field is
// as far as this file goes. The screen that draws it is
// `apps/till/src/widgets/modifier-picker.ts`, which draws one group per entry.
// THREE doors open that screen, and only one of them turns on `offeredModifiers` alone:
// `apps/till/src/widgets/product-grid.ts` and `apps/till/src/widgets/tender-pay.ts` both gate on
// `needsModifierPicker` (`apps/till/src/state/order-line.ts`), which answers true on an available
// variant BEFORE it looks at `offeredModifiers`, and `apps/till/src/widgets/basket.ts` has its own
// narrower gate on the offered lists. None of the three is exercised from here.
//
// The target is a real migrated venue database, for the seed path's sake rather than for any
// grant: every `seed-*.test.ts` beside this one applies the whole manifest through `useVenueDb`,
// and — like all of them — this file calls `applyVenue`, so the seed runs over real provisioning
// rather than a hand-built fixture. Matching the siblings is the point; a lighter target would
// prove the seed against a database no venue ever has.
//
// SQLite has no roles, and every call below runs on the one handle. Nothing here checks who
// may write an option list.

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

// One NIF per provisioned venue. `useVenueDb`'s per-test reset empties every data table, so the
// counter no longer keeps two tests apart; it keeps two `provisionVenue` calls within a test apart.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(52_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
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

    // The three labels in the order they are offered, each carrying three DIFFERENT texts.
    // What that buys, stated narrowly because the wider version was measured and disproved: this
    // file checks the names as STORED, so it fails if the seed puts the wrong text in a column. It
    // does NOT catch a surface that reads the wrong one of the three — a review seat made the
    // kitchen renderer use staff names and this suite stayed green, while
    // `apps/server/src/kitchen-print.test.ts` went red. That is where the wrong-surface property is
    // tested, and it does not read this seed at all: it hand-writes its own six-name fixture. So
    // the three texts here differ for a narrower reason — a seed that wrote one of them into the
    // wrong column fails the assertions below (CLAUDE.md §3).
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

    // The house default is medium, and it is stored as that label's id — not its position and not
    // its name. A default that did not line up would not read back `null` here: `parseOptionListInput`
    // REFUSES one naming no label of the same body, `options.invalid` with `field: "defaultLabelId"`
    // (`option-contract.ts:139`), and only drops to null a default naming a label that exists but is
    // unavailable (`:145-147`). So a misaligned seed default fails the whole seed, loudly.
    const medium = cooked.labels.find((label) => label.name === "Punto medio")!;
    expect(cooked.defaultLabelId).toBe(medium.id);

    // Attached to the steak through the new `product_modifiers` rows, and to nothing else.
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
