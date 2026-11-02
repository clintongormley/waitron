import { expect, it } from "vitest";
import { locations, nodes, readVenue } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedNode, seedNodesForSifContention } from "./testing/seed.js";
import { seedTenantNodeSif, seedTenants, TENANT_A } from "../test/fixtures.js";
import {
  seedIndependentChain,
  seedPendingEnvios,
  seedPinnedChain,
  seedSecondChain,
} from "../test/drain-fixtures.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

it("adds fiscal nodes at the existing venue without replacing its settings", async () => {
  await seedNode(suite.db);
  const before = await readVenue(suite.db);
  await seedNode(suite.db, "B");
  await seedNodesForSifContention(suite.db, 2);
  expect(await readVenue(suite.db)).toEqual(before);
  expect(await suite.db.select().from(nodes)).toHaveLength(4);
});

it.each([
  { name: "seedTenantNodeSif", seed: seedTenantNodeSif },
  { name: "seedTenants", seed: seedTenants },
])("reuses an existing venue for fixed-id parents: $name", async ({ seed }) => {
  const [venue] = await suite.db
    .insert(locations)
    .values({
      name: "Retained venue",
      timeZone: "Europe/Rome",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning({ id: locations.id });
  const before = await readVenue(suite.db);
  await seed(suite.db);
  expect(await readVenue(suite.db)).toEqual(before);
  expect(
    (await suite.db.select().from(nodes)).find((row) => row.id === TENANT_A.nodeId),
  ).toMatchObject({ locationId: venue!.id });
});

it("adds independent fiscal chains at the existing venue", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const before = await readVenue(suite.db);
  await seedSecondChain(suite.db, seeded, 10);
  await seedIndependentChain(suite.db, { sifId: "f".repeat(36), secuencia: 20 });
  await seedPinnedChain(suite.db, seeded, {
    sifId: "e".repeat(36),
    firstSecuencia: 30,
    rows: [{ nombreRazonEmisor: "Waitron SL", generadoEn: "2026-07-20T19:20:30+01:00" }],
  });
  expect(await readVenue(suite.db)).toEqual(before);
  expect(await suite.db.select().from(nodes)).toHaveLength(4);
});
