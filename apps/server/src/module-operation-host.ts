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
import { createFirstFiscalDelivery } from "./first-fiscal-delivery.js";
import { createFirstSetupNodeKeys } from "./first-setup-node-key.js";
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
  freezeConfiguration?: (
    request: import("@waitron/provisioning").VenueRequest,
    newTaxpayer: boolean,
  ) => Promise<
    NonNullable<import("@waitron/provisioning").FirstSetupFrozen["configurationImport"]>
  >;
  assertClaimAllowed?: (hold: import("@waitron/provisioning").FirstSetupHold) => Promise<void>;
}) {
  const evidence: { current?: { read: ModuleOperationHost["readPublicEvidence"] } } = {};
  const host = createModuleOperationHost(options.environment, {
    read: async (binding) => evidence.current?.read(binding),
  });
  const modules = configureModuleOperations(options.modules, host);
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...options, coordinator });
  const bootId = randomUUID();
  const owner = createFirstSetupOwner({
    ...options,
    store,
    coordinator,
    bootId,
    freeze: async (request, environment, ids, intent) => {
      const selection = venueFiscalSelection(
        modules,
        request.location.fiscalTerritory,
        options.moduleConfig,
      );
      const selected = enabledModules(modules, selection.config);
      planVenue(request, selected);
      let configurationImport;
      if (intent?.configurationImport) {
        if (options.freezeConfiguration === undefined) throw new AppError("setup.not_ready", {});
        configurationImport = await options.freezeConfiguration(
          request,
          intent.newTaxpayer === true,
        );
      }
      return {
        ...ids,
        ...(configurationImport === undefined ? {} : { configurationImport }),
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
  const legacyEvidence = createFirstFiscalEvidence({
    ...options,
    modules,
    store,
    coordinator,
    bootId,
    owner,
  });
  const keys = createFirstSetupNodeKeys({ ...options, store, coordinator, owner });
  const delivery = createFirstFiscalDelivery({
    ...options,
    modules,
    store,
    coordinator,
    owner,
    keys,
    bootId,
  });
  const configuredEvidence = {
    ...legacyEvidence,
    invalidate(attemptId: string) {
      legacyEvidence.invalidate(attemptId);
      delivery.invalidate(attemptId);
    },
    async read(binding: OperationBinding) {
      return (await delivery.has(binding)) ? delivery.read(binding) : legacyEvidence.read(binding);
    },
  };
  evidence.current = configuredEvidence;
  return {
    coordinator,
    store,
    owner,
    offerings(territory: string) {
      const selected = enabledModules(
        modules,
        venueFiscalSelection(options.modules, territory, options.moduleConfig).config,
      );
      return selected
        .filter((module) => initialSetupFor(selected, module.name) !== undefined)
        .map((module) => ({ module: module.name, version: module.version }));
    },
    evidence: configuredEvidence,
    keys,
    delivery,
    publishSelection(state: import("@waitron/provisioning").FirstSetupState) {
      return writeModuleConfig(
        options.stateDir,
        venueFiscalSelection(
          modules,
          state.frozen.request.location.fiscalTerritory,
          options.moduleConfig,
        ).config,
      );
    },
    assertSelection(state: import("@waitron/provisioning").FirstSetupState) {
      const selected = enabledModules(
        modules,
        venueFiscalSelection(
          modules,
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
    modules,
  };
}
