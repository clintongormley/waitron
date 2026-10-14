import { randomUUID } from "node:crypto";
import { stampDeployment } from "@waitron/db";
import { createAllocationPreparation } from "@waitron/fiscal-verifactu";
import { applyVenue, type VenueAction, type VenueApplyDeps } from "@waitron/provisioning";
import {
  assertDevelopmentEnvironment,
  createDevelopmentKey,
  signDevelopmentAllocation,
} from "./sign.js";

export async function applyDevelopmentVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  environment: NodeJS.ProcessEnv = process.env,
) {
  assertDevelopmentEnvironment(environment);
  const taxpayer = actions.find((action) => action.kind === "ensure-tenant");
  const bases = actions
    .filter((action) => action.kind === "create-series")
    .map(({ code, purpose }) => ({ code, purpose }));
  const nodeId = randomUUID();
  const administratorId = randomUUID();
  const eventId = randomUUID();
  const sourceId = "developer-custodian";
  const { input, evidence } = signDevelopmentAllocation(
    {
      key: createDevelopmentKey(environment),
      taxpayerNif: taxpayer!.taxId,
      bases,
      nodeId,
      administratorId,
      eventId,
      sourceId,
      now: new Date(),
    },
    environment,
  );
  const preparation = createAllocationPreparation(async (scope) => ({ ...scope, evidence }));
  await stampDeployment(deps.db, "preproduction");
  return applyVenue(actions, {
    ...deps,
    initialNodeId: nodeId,
    initialAdministratorId: administratorId,
    moduleInputs: new Map([["fiscal-verifactu", { eventId, sourceId, input }]]),
    modules: deps.modules.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
    ),
  });
}
