import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { floorZones, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { getCountryPack } from "@waitron/country-packs";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fitSetMenus, placeInOrder, setMenuCopyOf } from "@waitron/shared";
import { listZoneOffers } from "@waitron/venue-service";
import { listCourses } from "../../src/kitchen.js";
import { seedDemoRestaurant } from "./seed.js";
import { CASA_DELGADO_ES } from "./testing/data.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 90_000_920,
  nifFormat: "calculated",
  invoiceLocale: "es-ES",
  staffLanguage: "en",
});

it.each(["en", "es"] as const)("publishes the two lunch set menus in %s", async (locale) => {
  const venue = await provisionVenue();
  const dataSet = CASA_DELGADO_ES;
  const holderName = dataSet.menus.setMenuHolderName[locale];
  const [dailyName, specialName] = dataSet.menus.setMenus.map(({ name }) => name[locale]);
  await seedDemoRestaurant(suite.db, {
    venue,
    locale,
    dataSet,
    departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
    salesDays: 0,
  });
  await withTransaction(suite.db, async (tx) => {
    const dining = dataSet.floor.zones.find(({ key }) => key === "dining")!.name[locale];
    const [zone] = await tx
      .select({ id: floorZones.id })
      .from(floorZones)
      .where(eq(floorZones.name, dining));
    const lunch = await listZoneOffers(tx, zone!.id, { at: new Date("2026-11-25T13:00:00Z") });
    const dinner = await listZoneOffers(tx, zone!.id, { at: new Date("2026-11-25T20:00:00Z") });
    const holder = lunch.menus.find(({ name }) => name === holderName);
    expect(lunch.setMenus.map(({ name }) => name).sort()).toEqual([dailyName, specialName].sort());
    expect(holder?.orderable).toBe(true);
    expect(holder?.structure.members.map(({ kind }) => kind).sort()).toEqual([
      "product",
      "section",
      "set_menu",
      "set_menu",
    ]);
    const drinks = holder!.structure.members.find((member) => member.kind === "section");
    expect(drinks?.includedMenu?.name).toBe(dataSet.menus.drinksName[locale]);
    const negroni = holder!.structure.members.find((member) => member.kind === "product");
    expect(lunch.offers.find(({ id }) => id === negroni?.menuItemId)).toMatchObject({
      name: locale === "en" ? "House Negroni" : "Negroni de la casa",
      unitPrice: "9.00",
    });
    expect(dinner.setMenus.map(({ orderable, newestOnSale }) => [orderable, newestOnSale])).toEqual(
      [
        [false, false],
        [false, false],
      ],
    );
    const courseNames = new Map((await listCourses(tx)).map(({ id, name }) => [id, name]));
    const daily = lunch.setMenus.find(({ name }) => name === dailyName)!;
    const special = lunch.setMenus.find(({ name }) => name === specialName)!;
    for (const [copy, price, secondLine] of [
      [daily, "14.00", ["Mains"]],
      [special, "20.00", ["Starters", "Mains"]],
    ] as const) {
      expect(copy).toMatchObject({
        orderable: true,
        newestOnSale: true,
        versionIds: [holder!.versionId],
      });
      expect(copy.terms).toMatchObject({
        price,
        vatClass: "reduced",
        takeawayVatClass: "reduced",
      });
      expect(
        copy.terms.lines.map(({ count, courseIds }) => [
          count,
          courseIds.map((id) => courseNames.get(id)),
        ]),
      ).toEqual([
        [1, ["Starters"]],
        [1, secondLine],
        [1, ["Desserts", "Coffee"]],
        [1, ["Bread"]],
        [1, ["Drinks"]],
      ]);
    }
    const products = [dataSet.menus.restaurant, dataSet.menus.lunch].flatMap(({ categories }) =>
      categories.flatMap(({ products }) => products),
    );
    const nameOf = (image: string) => {
      const product = products.find((product) => product.image === image + ".png")!;
      return (product.staffName ?? product.customerName)[locale];
    };
    const dish = (copy: typeof daily, image: string) =>
      copy.offers.find(({ name }) => name === nameOf(image))!;
    expect(daily.offers).toHaveLength(14);
    expect(special.offers).toHaveLength(19);
    expect(dish(daily, "solomillo").unitPrice).toBe("5.00");
    expect(dish(special, "solomillo").unitPrice).toBe("0.00");
    expect(dish(daily, "cafe-solo").variants).toHaveLength(1);
    expect(dish(special, "cafe-solo").variants).toHaveLength(2);
    const bravas = dish(special, "patatas-bravas");
    expect(courseNames.get(bravas.countsAsCourseId!)).toBe("Starters");
    expect(bravas.courseId).toBe(bravas.countsAsCourseId);
    expect(dish(daily, "solomillo").offeredModifiers.map(({ kind }) => kind)).toContain("options");
    expect(dish(daily, "pollo-asado").offeredModifiers.map(({ kind }) => kind)).toContain("extras");

    const copies = [daily, special].map((copy) => setMenuCopyOf(copy, holder!.versionId));
    const [day, extra] = copies;
    const state = {
      copies,
      recorded: {},
      dishes: [],
      setMenus: [
        { lineId: "daily-1", copyId: day!.id, lineNo: 1 },
        { lineId: "daily-2", copyId: day!.id, lineNo: 2 },
        { lineId: "special-1", copyId: extra!.id, lineNo: 3 },
        { lineId: "special-2", copyId: extra!.id, lineNo: 4 },
      ],
    };
    const orderedDishes = [
      "gazpacho",
      "gazpacho",
      "gazpacho",
      "gazpacho",
      "bacalao",
      "solomillo",
      "solomillo",
      "merluza-rebozada",
    ].map((image, index) => ({
      id: String(index),
      productId: dish(special, image).productId,
      variantId: null,
      reserved: null,
    }));
    const placed = placeInOrder(state, orderedDishes);
    expect(placed.unplaced).toEqual([]);
    expect(
      placed.placed.slice(4).map(({ setMenuLineId, priceCents }) => [setMenuLineId, priceCents]),
    ).toEqual([
      ["special-1", 0],
      ["special-2", 0],
      ["daily-1", 500],
      ["daily-2", 0],
    ]);
    const codLater = [
      ...orderedDishes.slice(0, 4),
      ...orderedDishes.slice(5, 7),
      orderedDishes[4]!,
      orderedDishes[7]!,
    ];
    expect(placeInOrder(state, codLater).unplaced).toEqual([orderedDishes[4]!.id]);
    expect(
      fitSetMenus({
        offers: copies,
        dishes: codLater.map(({ id, productId, variantId }) => ({
          id,
          productId,
          variantId,
          pinnedTo: null,
        })),
        setMenus: state.setMenus.map(({ lineId, copyId }) => ({
          id: lineId,
          fixedOfferId: copyId,
        })),
        previous: null,
      }),
    ).toMatchObject({ kind: "fitted", totalCents: 7300 });
  });
});
