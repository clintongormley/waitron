import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import { installChangeFeed } from "./change-feed.js";
import { subscribeToChanges } from "./change-log.js";
import { CORE_CHANGE_SOURCES } from "./classification.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { menus } from "./schema/menus.js";
import * as transactions from "./tenancy.js";
import { withNodeTransaction, withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => installChangeFeed(db, CORE_CHANGE_SOURCES),
});
const unsubscribes: (() => void)[] = [];
afterEach(() => {
  while (unsubscribes.length) unsubscribes.pop()!();
});

it("waits for node before asking for venue", async () => {
  expect(transactions).toHaveProperty("withVenueAndNodeTransaction");
  let held!: () => void;
  let release!: () => void;
  const acquired = new Promise<void>((resolve) => {
    held = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = withNodeTransaction(suite.node, async () => {
    held();
    await gate;
  });
  await acquired;
  const order: string[] = [];
  const pair = transactions.withVenueAndNodeTransaction(suite.db, suite.node, () => {
    order.push("pair");
  });
  const independent = withTransaction(suite.db, () => {
    order.push("venue");
  });
  try {
    await vi.waitFor(() => expect(order).toEqual(["venue"]));
  } finally {
    release();
    await Promise.all([holder, pair, independent]);
  }
  expect(order).toEqual(["venue", "pair"]);
});

it("returns the result after the venue commit and delivers its changes", async () => {
  expect(transactions).toHaveProperty("withVenueAndNodeTransaction");
  const seen: ResourceChange[] = [];
  unsubscribes.push(subscribeToChanges((change) => seen.push(change)));
  const id = randomUUID();
  const result = await transactions.withVenueAndNodeTransaction(
    suite.db,
    suite.node,
    async (tx) => {
      await tx.insert(menus).values({ id, name: "Lunch" });
      expect(seen).toEqual([]);
      return "saved";
    },
  );
  expect(result).toBe("saved");
  expect(await suite.db.select().from(menus)).toMatchObject([{ id, name: "Lunch" }]);
  expect(seen).toEqual([{ resources: [{ type: "menus", id }] }]);
});

it("a refused body rolls back and releases both queues", async () => {
  expect(transactions).toHaveProperty("withVenueAndNodeTransaction");
  const refused = new Error("refused");
  const id = randomUUID();
  await expect(
    transactions.withVenueAndNodeTransaction(suite.db, suite.node, async (tx) => {
      await tx.insert(menus).values({ id, name: "Lunch" });
      throw refused;
    }),
  ).rejects.toBe(refused);
  expect(await suite.db.select().from(menus)).toEqual([]);
  await expect(
    transactions.withVenueAndNodeTransaction(suite.db, suite.node, () => "recovered"),
  ).resolves.toBe("recovered");
});
