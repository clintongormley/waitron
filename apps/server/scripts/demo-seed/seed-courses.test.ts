import { expect, it } from "vitest";
import { products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { getCountryPack } from "@waitron/country-packs";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  departments,
  listDepartmentCourseSettings,
  STARTER_COURSE_NAMES,
} from "@waitron/venue-service";
import { listCourses } from "../../src/kitchen.js";
import { seedDemoRestaurant } from "./seed.js";
import { CASA_DELGADO_ES } from "./testing/data.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

it.each([
  ["es", "en"],
  ["es", "es"],
  ["en", "es"],
] as const)(
  "uses the %s setup course names for a demo seeded in %s",
  async (staffLanguage, locale) => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 90_000_900,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
      staffLanguage,
    })();
    const starter = (name: keyof typeof STARTER_COURSE_NAMES) =>
      staffLanguage === "en" ? name : STARTER_COURSE_NAMES[name].es;
    const dataSet = CASA_DELGADO_ES;
    const [coffee, drinks, bread] = dataSet.courses.flatMap((course) =>
      "name" in course ? [course.name[staffLanguage]] : [],
    );
    await seedDemoRestaurant(suite.db, {
      venue,
      locale,
      dataSet,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      salesDays: 0,
    });

    await withTransaction(suite.db, async (tx) => {
      const courses = await listCourses(tx);
      expect(courses.map(({ name }) => name)).toEqual([
        starter("Sharing plates"),
        starter("Starters"),
        starter("Mains"),
        starter("Desserts"),
        coffee,
        drinks,
        bread,
      ]);
      const ids = new Map(courses.map(({ name, id }) => [name, id]));
      const settings = await listDepartmentCourseSettings(tx);
      const rows = await tx.select().from(departments);
      expect(rows.map(({ name }) => name).sort()).toEqual(
        Object.values(dataSet.floor.departmentNames)
          .map((name) => name[locale])
          .sort(),
      );
      for (const { id, name } of rows) {
        expect(
          settings[id]!.filter(({ heldUntilFired }) => !heldUntilFired).map(
            ({ courseId }) => courseId,
          ),
          name,
        ).toEqual([
          ids.get(starter("Sharing plates")),
          ids.get(starter("Starters")),
          ids.get(drinks!),
          ids.get(bread!),
        ]);
        expect(
          settings[id]!.some(({ courseId }) => courseId === ids.get(coffee!)),
          name,
        ).toBe(false);
      }
      const seededProducts = await tx
        .select({ name: products.name, courseId: products.courseId })
        .from(products);
      const demoProducts = [dataSet.menus.restaurant, dataSet.menus.deli].flatMap((menu) =>
        menu.categories.flatMap(({ products }) => products),
      );
      for (const [image, courseId] of [
        ["solomillo.png", ids.get(starter("Mains"))],
        ["pan-de-la-casa.png", ids.get(bread!)],
        ["manchego-curado.png", null],
      ] as const) {
        const product = demoProducts.find((product) => product.image === image)!;
        const name = (product.staffName ?? product.customerName)[locale];
        expect(seededProducts.find((row) => row.name === name)?.courseId, image).toBe(courseId);
      }
    });
  },
);
