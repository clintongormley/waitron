/**
 * `seedCatalogues`: the three demo menus, each category routed to its preparation station, the
 * default menu, and the image→product map the media and sales steps read.
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import {
  listAccessibleCatalogues,
  listAvailableProducts,
  listMenuOffers,
  listSections,
  readContentLanguages,
  readMenuStructure,
} from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";

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
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
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

describe("seedCatalogues", () => {
  it("builds each menu's top level from library sections named after its categories", async () => {
    const { locationId } = await provisionVenue();
    const read = await withTransaction(suite.db, async (tx) => {
      const { menuIds, productsByImage } = await seedCatalogues(tx, { locationId, locale: LOCALE });
      const library = new Map((await listSections(tx)).map((row) => [row.id, row.internalName]));
      const topLevel = async (menuId: string) =>
        (await readMenuStructure(tx, menuId)).nodes.map(({ ref }) =>
          ref.kind === "section" ? library.get(ref.sectionId) : ref.productId,
        );
      const negroni = productsByImage.get("negroni.png")!;
      const lunchNegroni = (await listMenuOffers(tx, [menuIds.lunch])).find(
        (offer) => offer.productId === negroni,
      );
      return {
        negroni,
        restaurant: await topLevel(menuIds.restaurant),
        lunch: await topLevel(menuIds.lunch),
        deli: await topLevel(menuIds.deli),
        lunchNegroni,
      };
    });
    expect(read.restaurant).toEqual(["Tapas", "Sharing plates", "Mains", "Desserts", "Drinks"]);
    expect(read.lunch).toEqual(["Starters", "Mains", read.negroni]);
    expect(read.deli).toEqual(["Charcuterie", "Cheeses", "Conserves"]);
    expect(read.lunchNegroni).toMatchObject({ grossPrice: "9.00", placements: [[]] });
  });

  it("creates restaurant, lunch and deli menus and routes each category to its preparation station", async () => {
    const { locationId } = await provisionVenue();

    const res = await withTransaction(suite.db, async (tx) => {
      const out = await seedCatalogues(tx, { locationId, locale: LOCALE });
      const menus = await listAccessibleCatalogues(tx, locationId);
      const { products } = await listAvailableProducts(tx, locationId);
      const contentLanguages = await readContentLanguages(tx, LOCALE);
      const { rows: stationRows } = await tx.execute<{ name: string; is_default: number }>(sql`
        select name, is_default from kitchen_stations where location_id = ${locationId}`);
      const stations = stationRows.map((row) => ({
        name: row.name,
        is_default: row.is_default === 1,
      }));
      const { rows: drinksRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        left join kitchen_stations ks on ks.id = c.station_id
        where c.name->>'en' = 'Drinks'`);
      const { rows: charcuterieRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        left join kitchen_stations ks on ks.id = c.station_id
        where c.name->>'en' = 'Charcuterie'`);
      const { rows: editorDemoRaw } = await tx.execute<{
        description: string | null;
        kitchen_name: string | null;
        dietary_declarations: string;
        primary_category: string;
        variant_prices: string;
        menu_overrides: number;
      }>(sql`
        select p.description, p.kitchen_name, p.dietary_declarations,
          c.name->>'en' as primary_category,
          -- unit_price counts whole cents, so these are counts, not amounts. Each ELEMENT is cast
          -- to text while the ORDER BY stays on the uncast column: element-wise text ordering would
          -- put 1400 before 210, and this keeps the ordering numeric with text elements.
          json_group_array(distinct cast(v.unit_price as text) order by v.unit_price) as variant_prices,
          (select cast(count(*) as integer) from menu_item_variant_overrides o
            where o.product_id = p.id) as menu_overrides
        from products p
        join categories c on c.id = p.category_id
        join products v on v.parent_id = p.id
        where p.name = 'Café' and p.parent_id is null
        group by p.id, c.name`);
      // Two labels that overlap on some drinks, and one that crosses into a soft drink: the demo
      // shows a label is independent of the category tree and of other labels.
      const { rows: labelled } = await tx.execute<{ label: string; product: string }>(sql`
        select l.name as label, p.name as product
        from labels l
        join product_labels pl on pl.label_id = l.id
        join products p on p.id = pl.product_id
        order by l.name, p.name`);
      const { rows: coffeeVariants } = await tx.execute<{
        name: string;
        customer_en: string | null;
        kitchen_name: string | null;
      }>(sql`
        select v.name, v.customer_name->>'en' as customer_en, v.kitchen_name
        from products v
        join products p on p.id = v.parent_id
        where p.name = 'Café'
        order by v.variant_order`);
      const editorDemo = editorDemoRaw.map((row) => ({
        ...row,
        description:
          row.description === null ? null : (JSON.parse(row.description) as Record<string, string>),
        dietary_declarations: JSON.parse(row.dietary_declarations) as string[],
        variant_prices: JSON.parse(row.variant_prices) as string[],
      }));
      // The demo exists to show WHICH name each screen reads, so it has to seed products whose three
      // names are three different strings. A seed that derives them all from one authored map cannot
      // tell a correct screen from an incorrect one.
      const { rows: threeNames } = await tx.execute<{
        name: string;
        customer_en: string | null;
        kitchen_name: string | null;
      }>(sql`
        select p.name, p.customer_name->>'en' as customer_en, p.kitchen_name
        from products p
        where p.name = 'Bravas'`);
      const { rows: distinctNames } = await tx.execute<{
        differing: number;
        with_kitchen: number;
      }>(sql`
        select
          cast(count(*) filter (
            where p.customer_name is not null and p.name <> (p.customer_name->>'en')
          ) as integer) as differing,
          cast(count(*) filter (where p.kitchen_name is not null) as integer) as with_kitchen
        from products p`);
      const { rows: customUnitRaw } = await tx.execute<{
        precision: number;
        name: string;
        abbreviation: string;
      }>(sql`
        select u.precision, u.name, u.abbreviation from units u
        join product_units pu on pu.unit_id = u.id
        join products p on p.id = pu.product_id
        where p.name = 'Mixed salad'`);
      const customUnit = customUnitRaw.map((row) => ({
        precision: row.precision,
        name: JSON.parse(row.name) as Record<string, string>,
        abbreviation: JSON.parse(row.abbreviation) as Record<string, string>,
      }));
      return {
        out,
        menus,
        products,
        contentLanguages,
        stations,
        drinksRoute,
        charcuterieRoute,
        editorDemo,
        labelled,
        coffeeVariants,
        threeNames,
        distinctNames,
        customUnit,
      };
    });

    expect(res.menus.map((m) => m.name)).toEqual(["Casa Delgado", "Deli takeaway", "Menú del Día"]);
    expect(res.menus.find((m) => m.name === "Casa Delgado")!.isDefault).toBe(true);
    expect(res.menus.find((m) => m.name === "Menú del Día")!.isDefault).toBe(false);
    expect(res.contentLanguages).toEqual({
      defaultLanguage: "en",
      languages: ["en", "es"],
    });

    expect(res.products.length).toBeGreaterThan(35);
    const menuNames = new Set(res.products.map((p) => p.catalogueName));
    expect(menuNames).toEqual(new Set(["Casa Delgado", "Menú del Día", "Deli takeaway"]));

    expect(res.products.some((p) => p.name === "Sliced Iberian ham (per kg)")).toBe(true);
    expect(res.products.some((p) => p.name === "Mixed salad")).toBe(true);

    const cocina = res.stations.find((s) => s.name === "Kitchen");
    const downstairsBar = res.stations.find((s) => s.name === "Downstairs bar");
    const upstairsBar = res.stations.find((s) => s.name === "Upstairs bar");
    const deli = res.stations.find((s) => s.name === "Deli counter");
    expect(cocina?.is_default).toBe(true);
    expect(downstairsBar?.is_default).toBe(false);
    expect(upstairsBar?.is_default).toBe(false);
    expect(deli?.is_default).toBe(false);

    expect(res.drinksRoute[0]?.station_name).toBe("Downstairs bar");
    expect(res.charcuterieRoute[0]?.station_name).toBe("Deli counter");

    // One product's three names in full, then a floor across the whole seed — so flattening the names
    // back onto one authored string fails here rather than quietly producing an unusable demo.
    expect(res.threeNames).toEqual([
      { name: "Bravas", customer_en: "Spicy potatoes", kitchen_name: "BRAVAS" },
    ]);
    expect(res.distinctNames[0]!.differing).toBeGreaterThanOrEqual(10);
    expect(res.distinctNames[0]!.with_kitchen).toBeGreaterThanOrEqual(5);

    expect(res.editorDemo).toEqual([
      {
        description: {
          en: "Freshly ground espresso from the downstairs bar",
          es: "Espresso recién molido de la barra de abajo",
        },
        kitchen_name: "COFFEE · DOWNSTAIRS BAR",
        dietary_declarations: ["vegetarian", "halal"],
        primary_category: "Drinks",
        variant_prices: ["140", "210"],
        // The menu overrides nothing, so each variant sells at its own price there.
        menu_overrides: 0,
      },
    ]);
    expect(res.labelled).toEqual([
      { label: "Alcoholic", product: "Caña" },
      { label: "Alcoholic", product: "Negroni" },
      { label: "Alcoholic", product: "Tinto casa" },
      { label: "Happy hour drinks", product: "Caña" },
      { label: "Happy hour drinks", product: "Cola soft drink" },
      { label: "Happy hour drinks", product: "Tinto casa" },
    ]);
    expect(res.coffeeVariants).toEqual([
      { name: "Café solo", customer_en: "Espresso", kitchen_name: "ESPRESSO" },
      { name: "Café doble", customer_en: "Double espresso", kitchen_name: null },
    ]);
    expect(res.customUnit).toEqual([
      {
        precision: 2,
        name: { en: "serving", es: "ración" },
        abbreviation: { en: "srv", es: "rac" },
      },
    ]);

    expect(res.out.productsByImage.size).toBe(res.products.length);
    const hamId = res.out.productsByImage.get("jamon-iberico.png");
    expect(hamId).toBeDefined();
    expect(res.products.some((p) => p.id === hamId)).toBe(true);
  });
});
