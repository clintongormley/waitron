import { expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { updateProduct } from "./operations.js";
import { productDeclarationValues, readProductDeclarationValues } from "./product-declarations.js";

const fx = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

it("reads each product's values now, a variant inheriting its parent's, past one batch of ids", async () => {
  const f = await menusFixture(fx.db);
  const row = {
    allergens: { milk: {} },
    dietOverride: { vegetarian: "yes" as const },
    dietaryDeclarations: ["vegetarian" as const],
  };
  await app(async (tx) => {
    await updateProduct(tx, f.lemonade, row);
    await updateProduct(tx, f.soup, { allergens: { fish: {} } });
  });
  const unknown = Array.from({ length: 1000 }, () => crypto.randomUUID());
  const values = await app((tx) =>
    readProductDeclarationValues(tx, [f.large, ...unknown, f.soup, f.soup]),
  );
  expect(values).toEqual(
    new Map([
      [f.large, productDeclarationValues(row)],
      [
        f.soup,
        productDeclarationValues({
          allergens: { fish: {} },
          dietOverride: null,
          dietaryDeclarations: [],
        }),
      ],
    ]),
  );
});
