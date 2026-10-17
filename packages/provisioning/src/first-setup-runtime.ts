import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import { readDeploymentEnvironment, withTransaction, type Database } from "@waitron/db";
import {
  configureModuleOperations,
  enabledModules,
  initialSetupFor,
  type ModuleOperationHost,
  type OperationBinding,
  type WaitronModule,
  type ModuleConfig,
} from "@waitron/module";
import { createSetupPreparationHost } from "./setup-preparation-host.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  type FirstSetupCoordinator,
  type FirstSetupHold,
} from "./first-setup-state.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import "./errors.js";
export function createModuleOperationHost(
  environment: Readonly<Record<string, string | undefined>>,
  evidence?: {
    read: ModuleOperationHost["readPublicEvidence"];
    withPreparationState?: ModuleOperationHost["withPreparationState"];
    readRetiredSetup?: ModuleOperationHost["readRetiredSetup"];
    readSetupFacts?: ModuleOperationHost["readSetupFacts"];
  },
): ModuleOperationHost {
  return Object.freeze({
    environment: Object.freeze({ ...environment }),
    ...(evidence?.readSetupFacts === undefined ? {} : { readSetupFacts: evidence.readSetupFacts }),
    ...(evidence?.withPreparationState === undefined
      ? {}
      : { withPreparationState: evidence.withPreparationState }),
    ...(evidence?.readRetiredSetup === undefined
      ? {}
      : { readRetiredSetup: evidence.readRetiredSetup }),
    readPublicEvidence: async (binding: OperationBinding) => evidence?.read(binding),
  });
}

export function createFirstSetupRuntime(options: {
  environment: Readonly<Record<string, string | undefined>>;
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
  moduleConfig?: ModuleConfig;
  database?: () => Database | undefined;
  freezeConfiguration?: (
    request: import("./venue-plan.js").VenueRequest,
    newTaxpayer: boolean,
  ) => Promise<
    NonNullable<import("./first-setup-state.js").FirstSetupFrozen["configurationImport"]>
  >;
  assertClaimAllowed?: (hold: FirstSetupHold) => Promise<void>;
  readPublicEvidence?: ModuleOperationHost["readPublicEvidence"];
  readRetiredSetup?: ModuleOperationHost["readRetiredSetup"];
  onOwnershipRecovered?: (attemptId: string) => void;
}) {
  const sharedCoordinator = createFirstSetupCoordinator();
  const holds = new AsyncLocalStorage<FirstSetupHold>();
  const replacementAuthority = new AsyncLocalStorage<() => Promise<void>>();
  const coordinator: FirstSetupCoordinator = {
    run: (body) => sharedCoordinator.run((hold) => holds.run(hold, () => body(hold))),
    held: (hold, body) => sharedCoordinator.held(hold, () => holds.run(hold, body)),
  };
  const preparation: { current?: ReturnType<typeof createSetupPreparationHost> } = {};
  const host = createModuleOperationHost(options.environment, {
    readSetupFacts: async (binding) => {
      if (preparation.current === undefined) throw new AppError("setup.not_ready", {});
      return preparation.current.readSetupFacts(binding);
    },
    read: async (binding) => options.readPublicEvidence?.(binding),
    readRetiredSetup: options.readRetiredSetup,
    withPreparationState: (binding, run) => {
      if (preparation.current === undefined) throw new AppError("setup.not_ready", {});
      return preparation.current.withPreparationState(binding, run);
    },
  });
  const modules = configureModuleOperations(options.modules, host);
  const store = createFirstSetupStore({ ...options, coordinator });
  const retained = modules.flatMap((module) => {
    const sources = module.provisioning?.initialSetup?.resolutionEvidence?.();
    return sources === undefined ? [] : [sources];
  });
  const resolution = createFirstSetupResolutionInspection({
    ...options,
    store,
    migrationsRoot: options.environment.WAITRON_MIGRATIONS_DIR || null,
    expectedMigrationSets: options.modules.map((module) => module.migrations.name),
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
    onOwnershipRecovered: options.onOwnershipRecovered,
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
  preparation.current = createSetupPreparationHost({
    ...options,
    currentHold: () => holds.getStore(),
    readSetupFacts: async (held, check) => {
      const state = await store.read();
      check();
      if (state === null) throw new AppError("setup.owner_required", {});
      const context = firstSetupModuleContext(state, held.module);
      if (!isDeepStrictEqual(context.binding, held))
        throw new AppError("setup.attempt_conflict", {});
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
          selected.map(({ name, version }) => ({ module: name, version })),
          state.frozen.modules.map(({ module, version }) => ({ module, version })),
        )
      )
        throw new AppError("setup.attempt_conflict", {});
      const database = options.database?.();
      const contribution = initialSetupFor(modules, held.module);
      if (database === undefined || contribution?.localHistory === undefined)
        throw new AppError("setup.not_ready", {});
      const localHistory = await withTransaction(database, async (tx) => {
        check();
        const environment = await readDeploymentEnvironment(database);
        check();
        if (environment !== null && environment !== state.frozen.environment)
          throw new AppError("setup.attempt_conflict", {});
        return contribution.localHistory!(tx, environment);
      });
      check();
      return structuredClone({
        context,
        contextKey: JSON.stringify([
          state.frozen.attemptId,
          state.ownerGeneration,
          context.country,
          context.taxId,
          context.environment,
          state.frozen.request.location,
          context.bases,
          state.frozen.modules.map(({ module, version }) => ({ module, version })),
          state.frozen.configurationImport ?? null,
        ]),
        localHistory,
      });
    },
    coordinator,
    withVenueExclusion: (body) => resolution.withVenueExclusion(body),
    authorizeReplacement: async () => {
      const state = await store.read();
      if (state === null || !["claimed", "consumption-intent"].includes(state.status))
        throw new AppError("setup.attempt_conflict", {});
      const authorize = replacementAuthority.getStore();
      if (authorize === undefined) throw new AppError("setup.owner_required", {});
      await authorize();
    },
    authorize: async (binding) => {
      const state = await store.read();
      const module = state?.frozen.modules.find((entry) => entry.module === binding.module);
      const installed = modules.find((entry) => entry.name === binding.module);
      if (
        state === null ||
        !["claimed", "consumption-intent", "activation-started"].includes(state.status) ||
        binding.action !== "setup" ||
        binding.sourceId !== state.frozen.sourceId ||
        binding.targetNodeId !== state.frozen.nodeId ||
        module === undefined ||
        binding.eventId !== module.eventId ||
        module.version !== installed?.version
      )
        throw new AppError("setup.attempt_conflict", {});
    },
  });
  return {
    withPreparationAuthorization<T>(
      authorize: () => Promise<void>,
      run: () => Promise<T>,
    ): Promise<T> {
      return replacementAuthority.run(authorize, run);
    },
    coordinator,
    store,
    owner,
    resolution,
    modules,
    bootId,
  };
}
