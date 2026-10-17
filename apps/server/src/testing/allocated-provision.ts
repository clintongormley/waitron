import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { locationId, nodeId } from "@waitron/shared";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { withOperationAuthority } from "@waitron/module";
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
  const binding = {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: randomUUID(),
    sourceId: randomUUID(),
    targetNodeId,
  } as const;
  const now = Date.parse("2026-10-16T11:40:00Z");
  let selected: unknown = null;
  const history: unknown[] = [];
  const preparation = createHourPreparation({
    monotonicNow: () => 0,
    withState: async (_binding, run) =>
      run({
        get value() {
          return structuredClone(selected);
        },
        get history() {
          return structuredClone(history);
        },
        async replace(next) {
          selected = structuredClone(next);
          history.push(structuredClone(next));
        },
      }),
    read: async () => ({
      scope: { taxpayerNif: taxpayer.taxId, environment: request.environment },
      bases: plan
        .filter((action) => action.kind === "create-series")
        .map(({ code, purpose }) => ({ code, purpose })),
      contextKey: "direct-provision-unit-fixture",
      clock: compareHourClocks(
        ["box", "browser"].map((source) => ({
          source: source as "box" | "browser",
          result: "usable",
          instantMs: now,
          uncertaintyMs: 0,
          wallStartedMs: now,
          wallFinishedMs: now,
          monotonicStartedMs: 0,
          monotonicFinishedMs: 0,
        })),
        Date.parse("2026-10-15T00:00:00Z"),
      ),
      history: [{ reference: "synthetic-empty-venue", complete: true, records: [] }],
    }),
  });
  const held = await withOperationAuthority(binding, administratorId, (authority) =>
    preparation.select({ binding, authority, answer: "no" }),
  );
  if (held.status !== "selected") throw new Error("synthetic hour was not selected");
  return provisionVenue(
    deps,
    {
      ...request,
      initialOperations: {
        nodeId: targetNodeId,
        administratorId,
        inputs: [
          {
            module: binding.module,
            eventId: binding.eventId,
            sourceId: binding.sourceId,
            input: held.input,
          },
        ],
      },
    },
    ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
    ),
  );
}
