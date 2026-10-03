import { expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { createExtraList } from "./extras.js";
import { extraOfferUsage } from "./extra-usage.js";
import { writeProductModifiers } from "./product-modifiers.js";

const fx = useCatalogueDb();
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

it("names a product's extras lists and only menus whose working offers carry them", async () => {
  const f = await menusFixture(fx.db);
  const idle = await run((tx) =>
    createExtraList(tx, { name: "Idle lemon", items: [{ productId: f.extraLemon }] }, "en"),
  );
  await run((tx) => writeProductModifiers(tx, f.extraLemon, [{ kind: "extras", id: idle.id }]));

  const usage = await run((tx) => extraOfferUsage(tx, [f.extraLemon, f.soup]));
  expect(usage).toEqual([
    {
      productId: f.extraLemon,
      productName: "Extra lemon",
      lists: [
        {
          id: f.extrasList,
          name: "Extras",
          menus: [
            { id: f.dinner, name: "Dinner Menu" },
            { id: f.drinksMenu, name: "Drinks" },
            { id: f.lunch, name: "Lunch Menu" },
          ],
        },
        { id: idle.id, name: "Idle lemon", menus: [] },
      ],
    },
  ]);
});
