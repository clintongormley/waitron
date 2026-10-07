/**
 * `seedCatalogues`: the demo menus, each category routed to its preparation station, the
 * default menu, and the image→product map the media and sales steps read.
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  foldName,
  listAccessibleCatalogues,
  listAvailableProducts,
  listMenuOffers,
  menuPrices,
  sections as sectionsTable,
  readContentLanguages,
  readMenuStructure,
} from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 50_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
});

describe("seedCatalogues", () => {
  it("includes Drinks as a folder in both restaurant menus", async () => {
    const { locationId } = await provisionVenue();
    const read = await withTransaction(suite.db, async (tx) => {
      const { menuIds } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      const restaurant = await readMenuStructure(tx, menuIds.restaurant);
      const lunch = await readMenuStructure(tx, menuIds.lunch);
      return { restaurant, lunch, drinksId: menuIds.drinks };
    });
    for (const structure of [read.restaurant, read.lunch]) {
      const drinks = structure.nodes.find((node) => node.internalName === "Drinks");
      expect(drinks?.includedMenuId).toBe(read.drinksId);
      expect(drinks?.children?.map((node) => node.internalName)).toEqual(["Drinks"]);
    }
  });

  it("charges Drinks' beer price through the restaurant menu with its inherited source", async () => {
    const { locationId } = await provisionVenue();
    const read = await withTransaction(suite.db, async (tx) => {
      const { menuIds, productsByImage } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      const beerId = productsByImage.get("cana-cerveza.png")!;
      const { rows } = await tx.execute<{ unit_price: number }>(
        sql`select unit_price from products where id = ${beerId}`,
      );
      return {
        price: (await menuPrices(tx, menuIds.restaurant)).find((row) => row.productId === beerId),
        ownPriceCents: rows[0]?.unit_price,
        drinksId: menuIds.drinks,
      };
    });
    expect(read.ownPriceCents).toBe(280);
    expect(read.price?.override).toBeNull();
    expect(read.price?.effectivePrice).toBe("3.00");
    expect(read.price?.combined.price).toMatchObject({
      state: "decided",
      value: "3.00",
      source: { kind: "menu", menuId: read.drinksId, menuName: "Drinks", from: { kind: "own" } },
    });
  });

  it("keeps each menu's own sections beside its included Drinks folder", async () => {
    const { locationId } = await provisionVenue();
    const read = await withTransaction(suite.db, async (tx) => {
      const { menuIds, productsByImage } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      const sections = await tx.select().from(sectionsTable);
      const sectionNames = new Map(sections.map((row) => [row.id, row.internalName]));
      const topLevel = async (menuId: string) =>
        (await readMenuStructure(tx, menuId)).nodes.map(({ ref }) =>
          ref.kind === "section" ? sectionNames.get(ref.sectionId) : ref.productId,
        );
      const negroni = productsByImage.get("negroni.png")!;
      const lunchNegroni = (await listMenuOffers(tx, [menuIds.lunch])).find(
        (offer) => offer.productId === negroni,
      );
      const drinks = await readMenuStructure(tx, menuIds.drinks);
      const drinksSection = drinks.nodes[0]!.ref;
      if (drinksSection.kind !== "section") throw new Error("Drinks has no drinks section");
      return {
        drinksPath: [drinks.rootSectionId, drinksSection.sectionId],
        negroni,
        internalNames: sections.map((row) => row.internalName),
        lunchNames: sections
          .filter((row) => row.ownerMenuId === menuIds.lunch && row.role === "section")
          .map((row) => [row.internalName, row.names]),
        restaurant: await topLevel(menuIds.restaurant),
        lunch: await topLevel(menuIds.lunch),
        deli: await topLevel(menuIds.deli),
        lunchNegroni,
      };
    });
    expect(read.restaurant).toEqual(["Tapas", "Sharing plates", "Mains", "Desserts", "Drinks"]);
    expect(read.lunch).toEqual(["Starters", "Mains", "Drinks", read.negroni]);
    expect(read.internalNames.filter((name) => name === "Mains")).toHaveLength(2);
    expect(read.lunchNames).toEqual([
      ["Starters", { en: "Starters", es: "Primeros" }],
      ["Mains", { en: "Mains", es: "Segundos" }],
    ]);
    expect(read.deli).toEqual(["Charcuterie", "Cheeses", "Conserves"]);
    expect(read.lunchNegroni).toMatchObject({ grossPrice: "9.00" });
    expect(read.lunchNegroni?.placements).toContainEqual([]);
    expect(read.lunchNegroni?.placements).toContainEqual(read.drinksPath);
    expect(read.lunchNegroni?.placements).toHaveLength(2);
  });

  it("seeds no two categories with one parent, and no two Active products, sharing a name", async () => {
    const { locationId } = await provisionVenue();
    const { categories, products } = await withTransaction(suite.db, async (tx) => {
      await seedCatalogues(tx, { locationId, locale: LOCALE, dataSet: CASA_DELGADO_ES });
      const categories = await tx.execute<{ parent: string | null; name: string }>(sql`
        select d.parent_id as parent, c.name from categories c
        left join category_details d on d.category_id = c.id`);
      const products = await tx.execute<{ name: string }>(sql`
        select p.name from products p left join products parent on parent.id = p.parent_id
        where p.active and (p.parent_id is null or parent.active)`);
      return { categories: categories.rows, products: products.rows };
    });
    const repeated = (keys: string[]) => keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(categories.length).toBeGreaterThan(1);
    expect(products.length).toBeGreaterThan(1);
    expect(
      repeated(categories.map(({ parent, name }) => `${parent ?? ""}/${foldName(name)}`)),
    ).toEqual([]);
    expect(repeated(products.map(({ name }) => foldName(name)))).toEqual([]);
  });

  it("names each menu's top level after the menu, the provisioned one included", async () => {
    const { locationId } = await provisionVenue();
    const named = await withTransaction(suite.db, async (tx) => {
      const { menuIds } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      const { rows } = await tx.execute<{ menu: string; root: string }>(sql`
        select c.name as menu, s.internal_name as root
        from menu_details d
        join catalogues c on c.id = d.menu_id
        join sections s on s.id = d.root_section_id
        where d.menu_id in (${menuIds.restaurant}, ${menuIds.lunch}, ${menuIds.deli})
        order by c.name`);
      return rows;
    });
    expect(named).toEqual([
      { menu: "Casa Delgado", root: "Casa Delgado" },
      { menu: "Deli takeaway", root: "Deli takeaway" },
      { menu: "Menú del Día", root: "Menú del Día" },
    ]);
  });

  it("creates restaurant, lunch and deli menus and routes each category to its preparation station", async () => {
    const { locationId } = await provisionVenue();

    const res = await withTransaction(suite.db, async (tx) => {
      const out = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
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
        join routing_cells sc on sc.category_id = c.id and sc.zone_id is null and sc.location_id = ${locationId}
        left join kitchen_stations ks on ks.id = sc.station_id
        where c.name = 'Drinks'`);
      const { rows: charcuterieRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        join routing_cells sc on sc.category_id = c.id and sc.zone_id is null and sc.location_id = ${locationId}
        left join kitchen_stations ks on ks.id = sc.station_id
        where c.name = 'Charcuterie'`);
      const { rows: editorDemoRaw } = await tx.execute<{
        description: string | null;
        kitchen_name: string | null;
        dietary_declarations: string;
        primary_category: string;
        variant_prices: string;
        menu_overrides: number;
      }>(sql`
        select p.description, p.kitchen_name, p.dietary_declarations,
          c.name as primary_category,
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
        coffeeVariants,
        threeNames,
        distinctNames,
        customUnit,
      };
    });

    expect(res.menus.map((m) => m.name)).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Drinks",
      "Menú del Día",
    ]);
    expect(res.menus.find((m) => m.name === "Casa Delgado")!.isDefault).toBe(true);
    expect(res.menus.find((m) => m.name === "Menú del Día")!.isDefault).toBe(false);
    expect(res.contentLanguages).toEqual({
      defaultLanguage: "es",
      languages: ["es", "en"],
    });

    expect(res.products.length).toBeGreaterThan(35);
    const menuNames = new Set(res.products.map((p) => p.catalogueName));
    expect(menuNames).toEqual(new Set(["Casa Delgado", "Menú del Día", "Deli takeaway", "Drinks"]));

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

    expect(res.out.productsByImage.size).toBe(
      new Set(res.products.map((product) => product.id)).size,
    );
    const hamId = res.out.productsByImage.get("jamon-iberico.png");
    expect(hamId).toBeDefined();
    expect(res.products.some((p) => p.id === hamId)).toBe(true);
  });
});
