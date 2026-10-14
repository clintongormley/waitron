import { beforeEach, expect, it } from "vitest";
import { invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId, nodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { allocationFixture } from "../test/allocation-fixture.js";
import { ALLOCATED_FISCAL_RESTORE } from "./allocated-lifecycle.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { assertFiscalRestoreCommitted } from "./restore-committed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const fixture = allocationFixture({ node, bases, identity: "P000042" });
const binding = fixture.request("restore").binding;
beforeEach(async () => {
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: node.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: "S000001",
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});
async function commit() {
  await fixture.transaction(suite.db, "restore", (tx, operation) =>
    ALLOCATED_FISCAL_RESTORE(tx, node, operation),
  );
}
it("permits checking an exact committed restore without changing it", async () => {
  await commit();
  const before = await suite.db.select().from(fiscalAllocations);
  await expect(
    withTransaction(suite.db, (tx) => assertFiscalRestoreCommitted(tx, node, binding)),
  ).resolves.toBeUndefined();
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(before);
});
it("refuses to resume when no local activation committed", async () => {
  await expect(
    withTransaction(suite.db, (tx) => assertFiscalRestoreCommitted(tx, node, binding)),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it.each([
  { module: "different-regime" },
  { action: "re-register" },
  { eventId: "different-event" },
  { sourceId: "different-backup" },
  { targetNodeId: "00000000-0000-4000-8000-000000000099" },
])("refuses a resume outside the committed binding %j", async (changed) => {
  await commit();
  await expect(
    withTransaction(suite.db, (tx) =>
      assertFiscalRestoreCommitted(tx, node, { ...binding, ...changed }),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
});
it("refuses a different target node even if the event's binding was copied", async () => {
  await commit();
  await expect(
    withTransaction(suite.db, (tx) =>
      assertFiscalRestoreCommitted(
        tx,
        {
          ...node,
          nodeId: nodeId("00000000-0000-4000-8000-000000000099"),
        },
        binding,
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
});
