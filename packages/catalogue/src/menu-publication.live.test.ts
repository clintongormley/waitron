import { afterEach, expect, it } from "vitest";
import { installChangeFeed, subscribeToChanges, withTransaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { CATALOGUE_CHANGE_SOURCES } from "./classification.js";
import { previewMenu, publishMenu } from "./menu-publication.js";
import { activateDueMenuPublications, queueMenuPublication } from "./menu-schedule.js";
import { updateProduct } from "./operations.js";

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

it("announces an activation to live subscribers, so a menu that went live by schedule refreshes", async () => {
  const f = await menusFixture(fx.db);
  await installChangeFeed(fx.db, CATALOGUE_CHANGE_SOURCES);
  const queuedAt = new Date("2026-10-07T08:00:00.000Z");
  const activatesAt = new Date("2026-10-08T06:00:00.000Z");
  const first = await withTransaction(fx.db, (tx) => previewMenu(tx, f.lunch));
  await withTransaction(fx.db, (tx) =>
    publishMenu(tx, f.lunch, first.hash, "person-1", { at: queuedAt }),
  );
  await withTransaction(fx.db, (tx) => updateProduct(tx, f.soup, { unitPrice: "5.50" }));
  const second = await withTransaction(fx.db, (tx) => previewMenu(tx, f.lunch));
  await withTransaction(fx.db, (tx) =>
    queueMenuPublication(tx, f.lunch, second.hash, activatesAt, "manager-ana", { at: queuedAt }),
  );
  const types = new Set<string>();
  unsubscribe = subscribeToChanges((change) => {
    for (const resource of change.resources) types.add(resource.type);
  });
  await withTransaction(fx.db, (tx) => activateDueMenuPublications(tx, activatesAt));
  expect(types).toEqual(new Set(["menu_publications", "menu_scheduled_publications"]));
});
