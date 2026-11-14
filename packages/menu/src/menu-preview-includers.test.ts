import { expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { updateProduct } from "./operations.js";
import { previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";

const fx = useCatalogueDb();
it("publishing an included menu keeps its includer's live document and pending changes", async () => {
  const f = await menusFixture(fx.db);
  const publish = async (menuId: string) =>
    withTransaction(fx.db, async (tx) => {
      const preview = await previewMenu(tx, menuId);
      return publishMenu(tx, menuId, preview.hash, "person-1");
    });
  await publish(f.drinksMenu);
  await publish(f.lunch);
  const live = (await withTransaction(fx.db, (tx) => readLiveDocuments(tx, [f.lunch]))).get(
    f.lunch,
  );
  await withTransaction(fx.db, (tx) => updateProduct(tx, f.lemonade, { name: "Fresh lemonade" }));
  const before = await withTransaction(fx.db, (tx) => previewMenu(tx, f.drinksMenu));
  const again = await withTransaction(fx.db, (tx) => previewMenu(tx, f.drinksMenu));
  expect(before.changes.length).toBeGreaterThan(0);
  expect(again.changes.map((change) => change.id)).toEqual(
    before.changes.map((change) => change.id),
  );
  await publish(f.drinksMenu);
  expect(
    (await withTransaction(fx.db, (tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch),
  ).toEqual(live);
  const parent = await withTransaction(fx.db, (tx) => previewMenu(tx, f.lunch));
  expect(parent.status.state).toBe("changed");
  expect(
    parent.changes.some(
      (change) => change.kind === "product_changed" && change.productId === f.lemonade,
    ),
  ).toBe(true);
});
