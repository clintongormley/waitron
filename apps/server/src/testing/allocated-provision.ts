import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { locationId, nodeId } from "@waitron/shared";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { enabledModules } from "@waitron/module";
import { getVenueSetupCountryPack } from "@waitron/country-packs";
import { planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../modules.js";
import { provisionVenue, type ProvisionDeps, type ProvisionRequest } from "../provision.js";
import { writeAllocationInput } from "./allocation-input.js";

export async function initialSetupInput(
  directory: string,
  venue: {
    taxId: string;
    seriesCode: string;
    fullSeriesCode?: string;
    rectificativeSeriesCode: string;
  },
  environment: "preproduction" | "production" = "preproduction",
) {
  const targetNodeId = nodeId(randomUUID());
  const administratorId = randomUUID();
  const fixture = allocationFixture({
    node: { nodeId: targetNodeId, locationId: locationId(randomUUID()) },
    identity: "S000001",
    environment,
    taxpayerNif: (() => {
      const result = getVenueSetupCountryPack("ES")!.taxIdentifier!.validate(venue.taxId);
      return result.valid ? result.normalized : venue.taxId;
    })(),
    operatorId: administratorId,
    bases: [
      { code: venue.seriesCode, purpose: "standard" },
      { code: venue.fullSeriesCode ?? "FF", purpose: "full" },
      { code: venue.rectificativeSeriesCode, purpose: "rectificative" },
    ],
  });
  const held = fixture.request("setup");
  const configuration = await writeAllocationInput(directory, fixture, "setup");
  for (const [key, value] of Object.entries(configuration)) vi.stubEnv(key, value);
  return {
    nodeId: targetNodeId,
    administratorId,
    inputs: [
      {
        module: "fiscal-verifactu",
        eventId: held.binding.eventId,
        sourceId: held.binding.sourceId,
        input: held.input,
      },
    ],
  };
}

export async function provisionAllocatedTestVenue(deps: ProvisionDeps, request: ProvisionRequest) {
  const modules = enabledModules(ALL_MODULES, deps.moduleConfig);
  if (
    !modules.some((module) => module.name === "fiscal-verifactu") ||
    request.initialOperations !== undefined
  )
    return provisionVenue(deps, request);
  const plan = planVenue(request.venue, modules);
  const taxpayer = plan.find((action) => action.kind === "ensure-tenant")!;
  const targetNodeId = nodeId(randomUUID());
  const administratorId = randomUUID();
  const fixture = allocationFixture({
    node: { nodeId: targetNodeId, locationId: locationId(randomUUID()) },
    identity: "S000001",
    environment: request.environment,
    taxpayerNif: taxpayer.taxId,
    operatorId: administratorId,
    bases: plan
      .filter((action) => action.kind === "create-series")
      .map(({ code, purpose }) => ({ code, purpose })),
  });
  const held = fixture.request("setup");
  const environment = await writeAllocationInput(deps.stateDir, fixture, "setup");
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  return provisionVenue(deps, {
    ...request,
    initialOperations: {
      nodeId: targetNodeId,
      administratorId,
      inputs: [
        {
          module: "fiscal-verifactu",
          eventId: held.binding.eventId,
          sourceId: held.binding.sourceId,
          input: held.input,
        },
      ],
    },
  });
}
