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
  readRetiredFirstSetupStates,
} from "@waitron/provisioning";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstFiscalDelivery } from "./first-fiscal-delivery.js";
import { createFirstSetupNodeKeys } from "./first-setup-node-key.js";
import { firstSetupModuleContext, createFirstFiscalEvidence } from "./first-fiscal-evidence.js";
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
  const evidence: {
    current?: {
      read: ModuleOperationHost["readPublicEvidence"];
      invalidate(attemptId: string): void;
    };
  } = {};
  const host = createModuleOperationHost(options.environment, {
    read: async (binding) => evidence.current?.read(binding),
  });
  const modules = configureModuleOperations(options.modules, host);
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...options, coordinator });
  const retained = modules.flatMap((module) => {
    const sources = module.provisioning?.initialSetup?.resolutionEvidence?.();
    return sources === undefined ? [] : [sources];
  });
  const resolution = createFirstSetupResolutionInspection({
    ...options,
    store,
    publicEvidencePaths: retained.flatMap((sources) => sources.files),
    publicEvidenceDirectories: retained.flatMap((sources) => sources.directories),
  });
  const bootId = randomUUID();
  const owner = createFirstSetupOwner({
    ...options,
    store,
    coordinator,
    bootId,
    resolution,
    onOwnershipRecovered: (attemptId) => evidence.current?.invalidate(attemptId),
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
  const assertFreshAssignment = async (
    state: import("@waitron/provisioning").FirstSetupState,
    name: string,
    input = state.inputs[name],
  ): Promise<void> => {
    const seat = initialSetupFor(modules, name);
    if (
      seat === undefined ||
      (seat.assignmentKeys === undefined && seat.assignmentPositions === undefined)
    )
      return;
    const context = firstSetupModuleContext(state, name);
    const candidates = new Set(seat.assignmentKeys?.(context, input) ?? []);
    const positions = seat.assignmentPositions?.(context, input) ?? [];
    const retired = await readRetiredFirstSetupStates(options);
    for (const old of [
      ...state.previous,
      ...retired.flatMap((entry) => [entry, ...entry.previous]),
    ]) {
      if (!old.frozen.modules.some((entry) => entry.module === name)) continue;
      const context = firstSetupModuleContext(old, name);
      for (const key of seat.assignmentKeys?.(context, old.inputs[name]) ?? [])
        if (candidates.has(key)) throw new AppError("setup.attempt_conflict", {});
      for (const floor of seat.assignmentPositions?.(context, old.inputs[name]) ?? [])
        if (
          positions.some(
            (value) => value.namespace === floor.namespace && value.position <= floor.position,
          )
        )
          throw new AppError("setup.attempt_conflict", {});
    }
  };
  const configuredEvidence = {
    ...legacyEvidence,
    invalidate(attemptId: string) {
      legacyEvidence.invalidate(attemptId);
      delivery.invalidate(attemptId);
    },
    async read(binding: OperationBinding) {
      const state = await store.readResumable();
      if (state === null) throw new AppError("setup.owner_required", {});
      await assertFreshAssignment(state.state, binding.module);
      return (await delivery.has(binding)) ? delivery.read(binding) : legacyEvidence.read(binding);
    },
  };
  evidence.current = configuredEvidence;
  return {
    coordinator,
    store,
    owner,
    resolution,
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
    assertFreshAssignment,
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
