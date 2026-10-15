import { writeModuleConfig } from "./module-config.js";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import {
  configureModuleOperations,
  enabledModules,
  initialSetupFor,
  type ModuleOperationHost,
  type OperationBinding,
  type WaitronModule,
  type ModuleConfig,
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
  moduleConfig?: ModuleConfig;
  assertClaimAllowed?: (hold: import("@waitron/provisioning").FirstSetupHold) => Promise<void>;
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
      const selection = venueFiscalSelection(
        options.modules,
        request.location.fiscalTerritory,
        options.moduleConfig,
      );
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
    offerings(territory: string) {
      const selected = enabledModules(
        options.modules,
        venueFiscalSelection(options.modules, territory, options.moduleConfig).config,
      );
      return selected
        .filter((module) => initialSetupFor(selected, module.name) !== undefined)
        .map((module) => ({ module: module.name, version: module.version }));
    },
    evidence,
    publishSelection(state: import("@waitron/provisioning").FirstSetupState) {
      return writeModuleConfig(
        options.stateDir,
        venueFiscalSelection(
          options.modules,
          state.frozen.request.location.fiscalTerritory,
          options.moduleConfig,
        ).config,
      );
    },
    assertSelection(state: import("@waitron/provisioning").FirstSetupState) {
      const selected = enabledModules(
        options.modules,
        venueFiscalSelection(
          options.modules,
          state.frozen.request.location.fiscalTerritory,
          options.moduleConfig,
        ).config,
      );
      if (
        !isDeepStrictEqual(
          selected.map((module) => ({ module: module.name, version: module.version })),
          state.frozen.modules.map(({ module, version }) => ({ module, version })),
        )
      )
        throw new AppError("setup.attempt_conflict", {});
    },
    modules: configureModuleOperations(options.modules, host),
  };
}
