import { readNodeLocation } from "./node-config.js";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, nodes, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodeId } from "@waitron/shared";

const NODE = nodeId("33333333-3333-4333-8333-333333333333");
const SECOND = nodeId("44444444-4444-4444-8444-444444444444");
const UNKNOWN = nodeId("66666666-6666-4666-8666-666666666666");
const LOCATION = "55555555-5555-4555-8555-555555555555";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

it("resolves two different nodes to their shared location", async () => {
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Counter",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await suite.db.insert(nodes).values([
    { id: NODE, locationId: LOCATION, name: "First" },
    { id: SECOND, locationId: LOCATION, name: "Second" },
  ]);
  expect(await readNodeLocation(suite.db, NODE)).toBe(LOCATION);
  expect(await withTransaction(suite.db, (tx) => readNodeLocation(tx, SECOND))).toBe(LOCATION);
  expect(await readNodeLocation(suite.db, UNKNOWN)).toBeNull();
});

it("returns null without an own node row after adoption", async () => {
  expect(await readNodeLocation(suite.db, NODE)).toBeNull();
});
