// Real-Postgres proof of `seedOptionLists`: the demo seed creates the cooking options list `Punto` — the
// generic replacement for the deleted built-in `doneness` field — and attaches it to the steak, so
// the demo data still carries the question "how do you want it cooked?".
//
// What this does NOT establish is that a TILL asks it. `listAvailableProducts`, the read the till
// uses, resolves the LEGACY attachments (it calls `readLegacyProductModifiers`,
// packages/catalogue/src/operations.ts:1477); only `listProducts` (:1054) reads the
// `product_modifiers` rows this seed writes, and that is the read asserted below. Wiring the till
// to the new mechanism is a separate task.
//
// Real Postgres, not PGlite, and NOT because of the grants. The reason first given here — that
// PGlite cannot check them — is false, and CLAUDE.md §4 says so plainly: grants ARE enforced once
// the session assumes the role, which is what `asAppUser` does. A review seat measured it rather
// than reading it, driving PGlite through `SET ROLE app_user`: a granted insert succeeded and an
// ungranted delete was refused `42501`.
// The real reason is the seed path itself. Every `seed-*.test.ts` beside this one clones the shared
// `manifest` template through `useTemplateDb`, so the seed runs against the same migrated schema a
// provisioned venue gets, and — like all of them — this file calls `applyVenue`, so the seed runs
// over real provisioning rather than a hand-built fixture. Matching the siblings is the point; a
// lighter target here would prove the seed against a database no venue ever has.

import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAvailableProducts, listOptionLists, readProductModifiers } from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedOptions } from "./seed-options.js";
import { seedOptionLists } from "./seed-option-lists.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF. A base of 52_000_000 keeps this suite's NIFs
// clear of every other base in the tree — `grep -rn "_000_000 +" apps packages --include="*.ts"` on
// 2026-09-20 lists 10M, 20M, 40M, 50M, 51M, 60M, 61M, 64M, 70M, 72M–76M, 78M, 80M, 81M, 83M, 90M,
// 95M and 100M, and no 52M.
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
    { db: suite.admin, modules: ALL_MODULES },
  );
  return { locationId: venue.locationId };
}

describe("seedOptionLists", () => {
  it("creates the Punto list with three different names at both levels and attaches it to the steak", async () => {
    const { locationId } = await provisionVenue();

    const { lists, steakId, coffeeId, attachments, available } = await withTransaction(
      suite.admin,
      async (tx) => {
        await asAppUser(tx);
        const { productsByImage, menuItemsByProduct } = await seedCatalogues(tx, {
          locationId,
          locale: LOCALE,
        });
        // Both seeds run, in the order the orchestrator runs them: the legacy groups are left in
        // place and the new list is added beside them.
        await seedOptions(tx, { productsByImage, menuItemsByProduct, locale: LOCALE });
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

    // The legacy option groups are untouched: the new list is added BESIDE them, not in place of
    // them, and they are deleted with their tables in a later task.
    const steak = available.find((product) => product.name === "Solomillo")!;
    expect(steak.optionGroups.map((group) => group.name[LOCALE])).toEqual(["Extras", "Cooking"]);
  });
});
