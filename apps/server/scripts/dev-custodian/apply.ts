import { stampDeployment } from "@waitron/db";
import { FISCAL_PROVISIONING } from "@waitron/fiscal-verifactu";
import { applyVenue, type VenueAction, type VenueApplyDeps } from "@waitron/provisioning";
import { randomUUID } from "node:crypto";
import { deploymentEnvironment } from "../../src/config.js";

export async function applyDevelopmentVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const taxpayer = actions.find((action) => action.kind === "ensure-tenant");
  const bases = actions
    .filter((action) => action.kind === "create-series")
    .map(({ code, purpose }) => ({ code, purpose }));
  const nodeId = randomUUID();
  const administratorId = randomUUID();
  const { eventId, sourceId, input, operations } = FISCAL_PROVISIONING.throwawayAllocation!.prepare(
    {
      environments: [deploymentEnvironment(environment)],
      taxpayerNif: taxpayer!.taxId,
      bases,
      nodeId,
      administratorId,
    },
  );
  await stampDeployment(deps.db, "preproduction");
  return applyVenue(actions, {
    ...deps,
    initialNodeId: nodeId,
    initialAdministratorId: administratorId,
    moduleInputs: new Map([["fiscal-verifactu", { eventId, sourceId, input }]]),
    modules: deps.modules.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations } : module,
    ),
  });
}
