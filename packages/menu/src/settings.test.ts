import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, settings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer, seedVenueSettings } from "@waitron/db/testing/seed.js";
import * as menuModule from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
// The effective takeaway default is read from the area: the taxpayer's country with the venue's
// fiscal territory.
beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedVenueSettings(suite.db);
});

describe("the venue's new-product defaults", () => {
  it("saves product defaults in the menu document with advancing revisions", async () => {
    await withTransaction(suite.db, (tx) =>
      menuModule.saveMenuSettings(tx, { defaultProductVatClass: "reduced" }),
    );
    expect(
      await suite.db
        .select({
          module: settings.module,
          version: settings.version,
          revision: settings.revision,
          doc: settings.doc,
        })
        .from(settings)
        .where(eq(settings.module, "menu")),
    ).toEqual([
      {
        module: "menu",
        version: 1,
        revision: 1,
        doc: {
          defaultProductVatClass: "reduced",
          defaultTakeawayVatRate: null,
          defaultColor: null,
          starterUnitsCreated: false,
        },
      },
    ]);
    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#abcdef"));
    expect(
      await suite.db
        .select({ revision: settings.revision, doc: settings.doc })
        .from(settings)
        .where(eq(settings.module, "menu")),
    ).toEqual([
      {
        revision: 2,
        doc: {
          defaultProductVatClass: "reduced",
          defaultTakeawayVatRate: null,
          defaultColor: "#abcdef",
          starterUnitsCreated: false,
        },
      },
    ]);
  });

  it("uses general before provisioning has stored a preset", async () => {
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
      defaultTakeawayVatRate: "10.00",
      defaultColor: null,
    });
  });

  it.each(["general", "reduced", "super_reduced", "zero"] as const)(
    "saves and reloads %s without changing an existing product",
    async (defaultProductVatClass) => {
      const [product] = await suite.db
        .insert(products)
        .values({
          name: "Lemonade",

          unitPrice: 100,
          vatClass: "reduced",
        })
        .returning();
      await withTransaction(suite.db, (tx) =>
        menuModule.saveMenuSettings(tx, { defaultProductVatClass }),
      );
      expect(await menuModule.readMenuSettings(suite.db)).toEqual({
        defaultProductVatClass,
        defaultTakeawayVatRate: "10.00",
        defaultColor: null,
      });
      expect(
        await suite.db
          .select({ vatClass: products.vatClass })
          .from(products)
          .where(eq(products.id, product!.id)),
      ).toEqual([{ vatClass: "reduced" }]);
    },
  );

  it.each([undefined, null, {}, [], ["reduced"], "", "unknown", 10, true])(
    "refuses an invalid default %j without changing the stored setting",
    async (value) => {
      await withTransaction(suite.db, (tx) =>
        menuModule.saveMenuSettings(tx, { defaultProductVatClass: "zero" }),
      );
      await expect(
        withTransaction(suite.db, (tx) =>
          menuModule.saveMenuSettings(tx, { defaultProductVatClass: value }),
        ),
      ).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "defaultProductVatClass" },
      });
      expect(await menuModule.readMenuSettings(suite.db)).toEqual({
        defaultProductVatClass: "zero",
        defaultTakeawayVatRate: "10.00",
        defaultColor: null,
      });
    },
  );
});

describe("the venue's default takeaway rate for new products", () => {
  const water = {
    categoryId: null,
    name: "Water",
    pricingUnit: "each",
    unitPrice: "2",
    vatClass: "general",
  } as const;
  const storedRate = async () =>
    (
      await suite.db.select({ doc: settings.doc }).from(settings).where(eq(settings.module, "menu"))
    )[0]?.doc as { defaultTakeawayVatRate?: unknown } | undefined;

  it("reads the area's default while nothing is saved", async () => {
    expect((await menuModule.readMenuSettings(suite.db)).defaultTakeawayVatRate).toBe("10.00");
  });

  it("saves a pickable rate, answers it, and a new product starts at it", async () => {
    const saved = await withTransaction(suite.db, (tx) =>
      menuModule.saveMenuDefaultTakeawayVatRate(tx, "4.00", null),
    );
    expect(saved).toEqual({
      defaultProductVatClass: "general",
      defaultTakeawayVatRate: "4.00",
      defaultColor: null,
    });
    expect((await storedRate())?.defaultTakeawayVatRate).toBe("4.00");
    expect((await menuModule.readMenuSettings(suite.db)).defaultTakeawayVatRate).toBe("4.00");
    const schedules = await withTransaction(suite.db, async (tx) => {
      const product = await menuModule.createProduct(tx, water);
      const chosen = await menuModule.createProduct(tx, {
        ...water,
        name: "Cola",
        takeawayVatRate: "21.00",
      });
      const rates = await menuModule.readTakeawayVatSchedules(tx, [product.id, chosen.id]);
      return [rates.get(product.id), rates.get(chosen.id)];
    });
    expect(schedules).toEqual([[{ from: null, rate: "4.00" }], [{ from: null, rate: "21.00" }]]);
  });

  it("keeps the colour and the VAT class when it saves the rate", async () => {
    await withTransaction(suite.db, async (tx) => {
      await menuModule.saveMenuSettings(tx, { defaultProductVatClass: "zero" });
      await menuModule.saveMenuDefaultColor(tx, "#abcdef");
      await menuModule.saveMenuDefaultTakeawayVatRate(tx, "21.00", null);
    });
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "zero",
      defaultTakeawayVatRate: "21.00",
      defaultColor: "#abcdef",
    });
  });

  it.each(["5.00", "3.00", "2.00", "7.50", "4", "4.0", "", null, 4, undefined, ["4.00"]])(
    "refuses %j without changing the stored rate",
    async (value) => {
      await withTransaction(suite.db, (tx) =>
        menuModule.saveMenuDefaultTakeawayVatRate(tx, "21.00", null),
      );
      await expect(
        withTransaction(suite.db, (tx) =>
          menuModule.saveMenuDefaultTakeawayVatRate(tx, value, null),
        ),
      ).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "defaultTakeawayVatRate" },
      });
      expect((await storedRate())?.defaultTakeawayVatRate).toBe("21.00");
    },
  );
});

describe("the venue's default colour", () => {
  it("keeps the VAT default and the colour apart, whichever is saved last", async () => {
    expect(
      await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#b12525")),
    ).toEqual({
      defaultProductVatClass: "general",
      defaultTakeawayVatRate: "10.00",
      defaultColor: "#b12525",
    });
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
      defaultTakeawayVatRate: "10.00",
      defaultColor: "#b12525",
    });

    expect(
      await withTransaction(suite.db, (tx) =>
        menuModule.saveMenuSettings(tx, { defaultProductVatClass: "zero" }),
      ),
    ).toEqual({
      defaultProductVatClass: "zero",
      defaultTakeawayVatRate: "10.00",
      defaultColor: "#b12525",
    });
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "zero",
      defaultTakeawayVatRate: "10.00",
      defaultColor: "#b12525",
    });

    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#25b125"));
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "zero",
      defaultTakeawayVatRate: "10.00",
      defaultColor: "#25b125",
    });
  });

  it("clears the colour when saved as null", async () => {
    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#b12525"));
    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, null));
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
      defaultTakeawayVatRate: "10.00",
      defaultColor: null,
    });
  });

  it.each(["#ABCDEF", "#abc", "red", 123, {}, undefined])(
    "refuses %j without changing the stored colour",
    async (value) => {
      await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#b12525"));
      await expect(
        withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, value)),
      ).rejects.toMatchObject({ code: "category.invalid", params: { field: "color" } });
      expect(await menuModule.readMenuSettings(suite.db)).toEqual({
        defaultProductVatClass: "general",
        defaultTakeawayVatRate: "10.00",
        defaultColor: "#b12525",
      });
    },
  );
});

const menuDoc = {
  defaultProductVatClass: "general",
  defaultTakeawayVatRate: null,
  defaultColor: null,
  starterUnitsCreated: false,
};
it.each([
  [null, "doc"],
  [[], "doc"],
  [{}, "defaultProductVatClass"],
  [{ ...menuDoc, defaultProductVatClass: "standard" }, "defaultProductVatClass"],
  [
    { defaultProductVatClass: "general", defaultColor: null, starterUnitsCreated: false },
    "defaultTakeawayVatRate",
  ],
  [{ ...menuDoc, defaultTakeawayVatRate: 4 }, "defaultTakeawayVatRate"],
  [{ ...menuDoc, defaultTakeawayVatRate: "4" }, "defaultTakeawayVatRate"],
  [{ ...menuDoc, defaultTakeawayVatRate: "" }, "defaultTakeawayVatRate"],
  [{ ...menuDoc, defaultColor: "red" }, "defaultColor"],
  [{ ...menuDoc, defaultColor: "#ABCDEF" }, "defaultColor"],
  [{ ...menuDoc, starterUnitsCreated: 1 }, "starterUnitsCreated"],
  [{ ...menuDoc, x: true }, "x"],
])("names the bad menu document field in %j", (doc, field) => {
  expect(menuModule.MENU_SETTINGS.parse(doc)).toEqual({ ok: false, field });
});
it("accepts a complete menu document", () => {
  const doc = {
    defaultProductVatClass: "zero",
    defaultTakeawayVatRate: "4.00",
    defaultColor: "#abcdef",
    starterUnitsCreated: true,
  };
  expect(menuModule.MENU_SETTINGS.parse(doc)).toEqual({ ok: true, doc });
});
