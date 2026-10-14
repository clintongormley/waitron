import { beforeEach, expect, it } from "vitest";
import { invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { allocationFixture } from "../test/allocation-fixture.js";
import { FISCAL_RECOVERY_PACK } from "./recovery-pack.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = {
  nodeId: TENANT_A.nodeId,
  locationId: locationId(TENANT_A.locationId),
  venueId: "contract-venue",
};
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "rectificative" },
  { code: "FF", purpose: "full" },
];
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await seedTenants(suite.db);
  await seedFixtureSif(suite.db, {
    nodeId: node.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "S000001",
  });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, code: `${base.code}-S000001`, nodeId: node.nodeId })));
});

function input(overrides = {}) {
  const fixture = allocationFixture({ node, bases, identity: "P000042", ...overrides });
  return { block: fixture.state.evidence.block, custodian: fixture.custodian };
}

async function create(value: unknown = input(), target = node) {
  return withTransaction(suite.db, (tx) => FISCAL_RECOVERY_PACK(tx, target, value));
}

it("returns only the public signed register snapshot with its generation and block ids", async () => {
  const supplied = input();
  expect(await create(supplied)).toEqual({
    version: 1,
    kind: "paper-register-snapshot",
    custodian: supplied.custodian,
    block: supplied.block,
  });
});

it.each([
  { taxpayerNif: "A58818501" },
  { softwareId: "W2" },
  { environment: "production" as const },
])("refuses a signed snapshot outside the database's scope %j", async (changed) => {
  await expect(create(input(changed))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "scope_mismatch" },
  });
});

it("refuses a snapshot for another venue", async () => {
  await expect(create(input(), { ...node, venueId: "another-venue" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "scope_mismatch" },
  });
});

it("refuses a missing series rather than printing a pack the venue cannot activate", async () => {
  await expect(create(input({ bases: bases.slice(0, 2) }))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "series_mismatch" },
  });
});

it("refuses secret fields before returning printable content", async () => {
  await expect(create({ ...input(), privateKey: "never print this" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "malformed" },
  });
});
