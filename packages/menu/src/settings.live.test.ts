import { expect, it } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  installChangeFeed,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import type { ResourceIdentity } from "@waitron/shared";
import { useCatalogueDb } from "../test/fixtures.js";
import { CATALOGUE_CHANGE_SOURCES } from "./classification.js";
import { saveCatalogueDefaultColor } from "./settings.js";

const fx = useCatalogueDb();

it("announces each saved default colour to live subscribers, so open screens repaint", async () => {
  await installChangeFeed(fx.db, [...CORE_CHANGE_SOURCES, ...CATALOGUE_CHANGE_SOURCES]);
  const announced: ResourceIdentity[] = [];
  const unsubscribe = subscribeToChanges((change) => {
    announced.push(...change.resources.filter(({ type }) => type === "settings.menu"));
  });
  try {
    await withTransaction(fx.db, (tx) => saveCatalogueDefaultColor(tx, "#b12525"));
    const afterFirst = announced.length;
    expect(afterFirst).toBeGreaterThan(0);
    await withTransaction(fx.db, (tx) => saveCatalogueDefaultColor(tx, "#256bb1"));
    expect(announced.length).toBeGreaterThan(afterFirst);
    for (const identity of announced) expect(identity).toEqual({ type: "settings.menu" });
  } finally {
    unsubscribe();
  }
});
