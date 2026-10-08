import { expect, it } from "vitest";
import { installChangeFeed, subscribeToChanges, withTransaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { CATALOGUE_CHANGE_SOURCES } from "./classification.js";
import { saveCatalogueDefaultColor } from "./settings.js";

const fx = useCatalogueDb();

it("announces each saved default colour to live subscribers, so open screens repaint", async () => {
  await installChangeFeed(fx.db, CATALOGUE_CHANGE_SOURCES);
  let announced = 0;
  const unsubscribe = subscribeToChanges((change) => {
    announced += change.resources.filter(({ type }) => type === "catalogue_settings").length;
  });
  try {
    await withTransaction(fx.db, (tx) => saveCatalogueDefaultColor(tx, "#b12525"));
    const afterFirst = announced;
    expect(afterFirst).toBeGreaterThan(0);
    await withTransaction(fx.db, (tx) => saveCatalogueDefaultColor(tx, "#256bb1"));
    expect(announced).toBeGreaterThan(afterFirst);
  } finally {
    unsubscribe();
  }
});
