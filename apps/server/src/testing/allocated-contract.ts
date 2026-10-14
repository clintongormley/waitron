import { and, eq, isNull } from "drizzle-orm";
import {
  catalogues,
  deployment,
  invoiceSeries,
  locations,
  nodes,
  readTenant,
  tenants,
  type Database,
} from "@waitron/db";
import { ALLOCATED_FISCAL_STANDBY } from "@waitron/fiscal-verifactu";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import { nodeId } from "@waitron/shared";

export async function standbyContract(
  db: Database,
  primary: ProvisionedNode,
  targetNodeId: string,
  bases: readonly { code: string; purpose: string }[],
  operatorId?: string,
) {
  const tenant = (await readTenant(db))!;
  return allocationFixture({
    node: { ...primary, nodeId: nodeId(targetNodeId) },
    primary,
    bases,
    identity: "P000042",
    taxpayerNif: tenant.taxId,
    operatorId,
  });
}

export type StandbyContract = Awaited<ReturnType<typeof standbyContract>>;

export function allocatedStandbyModules(
  modules: readonly WaitronModule[],
  fixture: StandbyContract,
) {
  return modules.map((module) =>
    module.name === "fiscal-verifactu"
      ? ({
          ...module,
          provisioning: { ...module.provisioning, standby: ALLOCATED_FISCAL_STANDBY },
          operations: {
            prepare(operation, run) {
              return fixture.request(operation.binding.action).preparation.prepare(operation, run);
            },
          },
        } satisfies WaitronModule)
      : module,
  );
}

export async function prepareStandbyDatabase(
  source: Database,
  target: Database,
  primary: ProvisionedNode,
) {
  const tenant = (await source.select().from(tenants))[0]!;
  const location = (
    await source.select().from(locations).where(eq(locations.id, primary.locationId))
  )[0]!;
  const node = (await source.select().from(nodes).where(eq(nodes.id, primary.nodeId)))[0]!;
  const sif = await source
    .select()
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, primary.nodeId), isNull(registroSif.revocadoEn)));
  const series = await source
    .select()
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, primary.nodeId), isNull(invoiceSeries.retiredAt)));
  await target.insert(tenants).values(tenant);
  if (location.catalogueId !== null) {
    const catalogue = (
      await source.select().from(catalogues).where(eq(catalogues.id, location.catalogueId))
    )[0]!;
    await target.insert(catalogues).values(catalogue);
  }
  await target.insert(locations).values(location);
  await target.insert(nodes).values(node);
  await target.insert(deployment).values({ id: 1, environment: "preproduction" });
  await target.insert(registroSif).values(sif);
  await target.insert(invoiceSeries).values(series);
}

export async function takenOverSeries(
  db: Database,
  targetNodeId: string,
  fixture: StandbyContract,
  state: unknown,
) {
  const primary = {
    nodeId: nodeId(fixture.request("establish").binding.sourceId),
    locationId: (await db.select().from(locations))[0]!.id as ProvisionedNode["locationId"],
  };
  const target = { ...primary, nodeId: nodeId(targetNodeId) };
  await db
    .insert(nodes)
    .values({ id: target.nodeId, locationId: target.locationId, name: "Standby" });
  await fixture.transaction(db, "establish", (tx, operation) =>
    ALLOCATED_FISCAL_STANDBY.establish(tx, target, state, operation),
  );
  await fixture.transaction(db, "promote", (tx, operation) =>
    ALLOCATED_FISCAL_STANDBY.activate!(tx, target, operation),
  );
  return db
    .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, target.nodeId), isNull(invoiceSeries.retiredAt)))
    .orderBy(invoiceSeries.code);
}
