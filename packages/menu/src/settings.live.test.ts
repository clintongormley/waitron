import { expect, it } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  installChangeFeed,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import type { ResourceIdentity } from "@waitron/shared";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { MENU_CHANGE_SOURCES } from "./classification.js";
import { saveMenuDefaultColor } from "./settings.js";

const fx = useMenuDb();

it("announces each saved default colour to live subscribers, so open screens repaint", async () => {
  // A save answers the effective takeaway default, which the venue's area names.
  await seedVenue(fx.db);
  await installChangeFeed(fx.db, [...CORE_CHANGE_SOURCES, ...MENU_CHANGE_SOURCES]);
  const announced: ResourceIdentity[] = [];
  const unsubscribe = subscribeToChanges((change) => {
    announced.push(...change.resources.filter(({ type }) => type === "settings.menu"));
  });
  try {
    await withTransaction(fx.db, (tx) => saveMenuDefaultColor(tx, "#b12525"));
    const afterFirst = announced.length;
    expect(afterFirst).toBeGreaterThan(0);
    await withTransaction(fx.db, (tx) => saveMenuDefaultColor(tx, "#256bb1"));
    expect(announced.length).toBeGreaterThan(afterFirst);
    for (const identity of announced) expect(identity).toEqual({ type: "settings.menu" });
  } finally {
    unsubscribe();
  }
});
