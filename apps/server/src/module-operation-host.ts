import { randomUUID } from "node:crypto";
import {
  configureModuleOperations,
  enabledModules,
  type ModuleOperationHost,
  type OperationBinding,
  type WaitronModule,
} from "@waitron/module";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  planVenue,
  venueFiscalSelection,
} from "@waitron/provisioning";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstFiscalEvidence } from "./first-fiscal-evidence.js";
export function createModuleOperationHost(
  environment: Readonly<Record<string, string | undefined>>,
  evidence?: { read: ModuleOperationHost["readPublicEvidence"] },
): ModuleOperationHost {
  return Object.freeze({
    environment: Object.freeze({ ...environment }),
    readPublicEvidence: async (binding: OperationBinding) => evidence?.read(binding),
  });
}

export function createFirstSetupModuleHost(options: {
  environment: Readonly<Record<string, string | undefined>>;
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
}) {
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...options, coordinator });
  const bootId = randomUUID();
  const owner = createFirstSetupOwner({
    ...options,
    store,
    coordinator,
    bootId,
    freeze: async (request, environment, ids) => {
      const selection = venueFiscalSelection(options.modules, request.location.fiscalTerritory);
      const selected = enabledModules(options.modules, selection.config);
      planVenue(request, selected);
      return {
        ...ids,
        sourceId: `first-setup:${ids.attemptId}`,
        environment,
        request,
        modules: selected.map((module) => ({
          module: module.name,
          version: module.version,
          eventId: randomUUID(),
          request: null,
        })),
      };
    },
  });
  const evidence = createFirstFiscalEvidence({ ...options, store, coordinator, bootId, owner });
  const host = createModuleOperationHost(options.environment, evidence);
  return {
    coordinator,
    store,
    owner,
    evidence,
    modules: configureModuleOperations(options.modules, host),
  };
}
