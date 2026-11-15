import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, settings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import * as menuModule from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

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
        .from(settings),
    ).toEqual([
      {
        module: "menu",
        version: 1,
        revision: 1,
        doc: { defaultProductVatClass: "reduced", defaultColor: null, starterUnitsCreated: false },
      },
    ]);
    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#abcdef"));
    expect(
      await suite.db.select({ revision: settings.revision, doc: settings.doc }).from(settings),
    ).toEqual([
      {
        revision: 2,
        doc: {
          defaultProductVatClass: "reduced",
          defaultColor: "#abcdef",
          starterUnitsCreated: false,
        },
      },
    ]);
  });

  it("uses general before provisioning has stored a preset", async () => {
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
      defaultColor: null,
    });
  });

  it.each(["general", "reduced", "super_reduced", "zero"] as const)(
    "saves and reloads %s without changing an existing product",
    async (defaultProductVatClass) => {
      await seedTaxpayer(suite.db);
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
        defaultColor: null,
      });
    },
  );
});

describe("the venue's default colour", () => {
  it("keeps the VAT default and the colour apart, whichever is saved last", async () => {
    expect(
      await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#b12525")),
    ).toEqual({ defaultProductVatClass: "general", defaultColor: "#b12525" });
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
      defaultColor: "#b12525",
    });

    expect(
      await withTransaction(suite.db, (tx) =>
        menuModule.saveMenuSettings(tx, { defaultProductVatClass: "zero" }),
      ),
    ).toEqual({ defaultProductVatClass: "zero", defaultColor: "#b12525" });
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "zero",
      defaultColor: "#b12525",
    });

    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#25b125"));
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "zero",
      defaultColor: "#25b125",
    });
  });

  it("clears the colour when saved as null", async () => {
    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, "#b12525"));
    await withTransaction(suite.db, (tx) => menuModule.saveMenuDefaultColor(tx, null));
    expect(await menuModule.readMenuSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
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
        defaultColor: "#b12525",
      });
    },
  );
});

const menuDoc = {
  defaultProductVatClass: "general",
  defaultColor: null,
  starterUnitsCreated: false,
};
it.each([
  [null, "doc"],
  [[], "doc"],
  [{}, "defaultProductVatClass"],
  [{ ...menuDoc, defaultProductVatClass: "standard" }, "defaultProductVatClass"],
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
    defaultColor: "#abcdef",
    starterUnitsCreated: true,
  };
  expect(menuModule.MENU_SETTINGS.parse(doc)).toEqual({ ok: true, doc });
});
