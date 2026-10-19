import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoiceSeries, openVenueDatabase, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { fiscalAllocations, registroSif } from "@waitron/fiscal-verifactu";
import { locationId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { writeAllocationInput } from "./testing/allocation-input.js";
import { provisionNode } from "./provision-till.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { runRestoreHooks } from "./restore.js";
import { registerTill } from "../scripts/register-till.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
let root: string;
let secret: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "retired-fiscal-operation-"));
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId, nextNumber: 37 })));
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      ...node,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: "P000001",
    }),
  );
  secret = await mintBreakGlassSecret(suite.db, node.nodeId);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
async function rows(db = suite.db) {
  return {
    series: await db.select().from(invoiceSeries),
    registrations: await db.select().from(registroSif),
    allocations: await db.select().from(fiscalAllocations),
  };
}
it.each(["provision-node", "register-till", "restore-runner"])(
  "production %s refuses a signed paper input even with its correct key and outside files",
  async (entry) => {
    const action = entry === "restore-runner" ? "restore" : "re-register";
    const fixture = allocationFixture({ node, bases, identity: "P000042", recoveryKey: true });
    const environment = await writeAllocationInput(root, fixture, action);
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const { binding, input } = fixture.request(action);
    const request = { binding, input };
    const before = await rows();
    const venueDir = join(root, "venue");
    if (entry === "register-till") {
      await mkdir(venueDir);
      await suite.db.archiveTo(join(venueDir, "venue.db"));
    }
    const pending =
      entry === "provision-node"
        ? provisionNode(
            suite.db,
            { nodeId: node.nodeId, recovery: { ...request, secret } },
            ALL_MODULES,
          )
        : entry === "register-till"
          ? registerTill(node.nodeId, {
              ...environment,
              WAITRON_NODE_RECOVERY_KEY: secret,
              WAITRON_VENUE_DIR: venueDir,
            })
          : runRestoreHooks({
              db: suite.db,
              modules: ALL_MODULES,
              node,
              log: () => {},
              withModuleOperations: createRecoveryRestoreRunner(ALL_MODULES, request, secret),
            });
    await expect(pending).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await rows()).toEqual(before);
    if (entry === "register-till") {
      const copy = await openVenueDatabase(venueDir);
      try {
        expect(await rows(copy.venue)).toEqual(before);
      } finally {
        await copy.close();
      }
    }
  },
);
