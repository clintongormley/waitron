import { randomUUID } from "node:crypto";
import { readTaxpayer, stampDeployment } from "@waitron/db";
import { nodeId } from "@waitron/shared";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { applyVenue, type VenueApplyDeps } from "../src/venue-apply.js";
import type { VenueAction } from "../src/venue-plan.js";

// Existing-sale fixtures retain their recorded identities and series; setup-contract cases use
// applyAllocatedTestVenue instead, with an independently signed initial allocation.
export function applyHistoricalTestVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  installationIdentity?: string,
) {
  return applyVenue(actions, {
    ...deps,
    modules: deps.modules.map((module) =>
      module.name === "fiscal-verifactu"
        ? {
            ...module,
            operations: undefined,
            provisioning: {
              ...module.provisioning,
              seed: {
                summary: "seed a historical fiscal identity for an existing-sale fixture",
                async run(tx, node) {
                  const taxpayer = (await readTaxpayer(tx))!;
                  const sif = await seedFixtureSif(tx, {
                    nodeId: node.nodeId,
                    nif: taxpayer.taxId,
                    idSistemaInformatico: "W1",
                    numeroInstalacion: installationIdentity,
                  });
                  return `SIF ${sif.id} (installation ${sif.numeroInstalacion})`;
                },
              },
            },
          }
        : module,
    ),
  });
}

export async function applyAllocatedTestVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
) {
  const taxpayer = actions.find((action) => action.kind === "ensure-taxpayer");
  const seed = actions.find(
    (action) => action.kind === "seed-module" && action.module === "fiscal-verifactu",
  );
  if (
    taxpayer === undefined ||
    seed === undefined ||
    !actions.some((action) => action.kind === "create-node") ||
    !actions.some((action) => action.kind === "create-series")
  )
    return applyVenue(actions, deps);
  const bases = actions
    .filter((action) => action.kind === "create-series")
    .map(({ code, purpose }) => ({ code, purpose }));
  const initialNodeId = deps.initialNodeId ?? randomUUID();
  const initialAdministratorId = deps.initialAdministratorId ?? randomUUID();
  const fixture = allocationFixture({
    node: { nodeId: nodeId(initialNodeId) },
    bases,
    identity: "S000001",
    taxpayerNif: taxpayer.taxId,
    operatorId: initialAdministratorId,
  });
  const setup = fixture.request("setup");
  await stampDeployment(deps.db, "preproduction");
  return applyVenue(actions, {
    ...deps,
    initialNodeId,
    initialAdministratorId,
    moduleInputs: new Map([
      ...(deps.moduleInputs ?? []),
      [
        "fiscal-verifactu",
        {
          eventId: setup.binding.eventId,
          sourceId: setup.binding.sourceId,
          input: setup.input,
        },
      ],
    ]),
    modules: deps.modules.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: setup.preparation } : module,
    ),
  });
}
