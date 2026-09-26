import { afterEach, expect, it } from "vitest";
import { installChangeFeed, subscribeToChanges, withTransaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { CATALOGUE_CHANGE_SOURCES } from "./classification.js";
import { previewMenu, publishMenu } from "./menu-publication.js";

// A file of its own: the triggers `installChangeFeed` puts on the suite's database stay there for
// every later test in the file.
const fx = useCatalogueDb();

let unsubscribe = (): void => {};
afterEach(() => unsubscribe());

it("announces a publish to live subscribers, so another tab's menu status refreshes", async () => {
  const f = await menusFixture(fx.db);
  await installChangeFeed(fx.db, CATALOGUE_CHANGE_SOURCES);
  const types = new Set<string>();
  unsubscribe = subscribeToChanges((change) => {
    for (const resource of change.resources) types.add(resource.type);
  });
  const { hash } = await withTransaction(fx.db, (tx) => previewMenu(tx, f.lunch));
  expect(types).toEqual(new Set());
  await withTransaction(fx.db, (tx) => publishMenu(tx, f.lunch, hash, "person-1"));
  expect(types).toContain("menu_publications");
  expect(types).toContain("menu_versions");
});
