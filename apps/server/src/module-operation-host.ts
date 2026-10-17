import { writeModuleConfig } from "./module-config.js";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import {
  enabledModules,
  initialSetupFor,
  type ModuleOperationHost,
  type OperationBinding,
  type WaitronModule,
  type ModuleConfig,
} from "@waitron/module";
import {
  venueFiscalSelection,
  createFirstSetupRuntime,
  readFirstSetupRetirements,
  firstSetupAnchorFor,
  createFirstSetupResolutionStore,
} from "@waitron/provisioning";
import {
  createFirstFiscalDelivery,
  readFirstFiscalDeliverySnapshot,
} from "./first-fiscal-delivery.js";
import { readFirstSetupRecoveryDeliverySnapshot } from "./first-setup-recovery-delivery.js";
import {
  firstSetupModuleContext,
  createFirstFiscalEvidence,
  readFirstFiscalEvidenceSnapshot,
} from "./first-fiscal-evidence.js";
export { createModuleOperationHost } from "@waitron/provisioning";

export function createFirstSetupModuleHost(options: {
  environment: Readonly<Record<string, string | undefined>>;
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
  moduleConfig?: ModuleConfig;
  database?: () => Database | undefined;
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
  const readRetiredSetup: NonNullable<ModuleOperationHost["readRetiredSetup"]> = async (name) => {
    const retired = await readFirstSetupRetirements(options);
    if (retired.length === 0) return [];
    const anchor = await firstSetupAnchorFor(options);
    const archive = createFirstSetupResolutionStore({ ...anchor, coordinator });
    const result: Awaited<ReturnType<typeof readRetiredSetup>>[number][] = [];
    for (const { state, record } of retired) {
      const originals = await archive.readOriginals(record.resolutionId);
      const publicEvidence = readFirstFiscalEvidenceSnapshot(name, originals);
      for (const original of originals) {
        if (!original.name.startsWith("outside-file:") || original.bytes === null) continue;
        try {
          publicEvidence.push(JSON.parse(original.bytes.toString("utf8")) as unknown);
        } catch {
          throw new AppError("setup.attempt_invalid", {});
        }
      }
      const recovery = readFirstSetupRecoveryDeliverySnapshot(name, state, originals, modules);
      const document =
        recovery?.statement ?? (await readFirstFiscalDeliverySnapshot(name, state, originals));
      if (document !== undefined) publicEvidence.push(document);
      for (const attempt of [state, ...state.previous]) {
        if (!attempt.frozen.modules.some((entry) => entry.module === name)) continue;
        result.push({
          context: firstSetupModuleContext(attempt, name),
          input: attempt.inputs[name],
          publicEvidence,
        });
      }
    }
    return result;
  };
  const runtime = createFirstSetupRuntime({
    ...options,
    readPublicEvidence: async (binding) => evidence.current?.read(binding),
    readRetiredSetup,
    onOwnershipRecovered: (attemptId) => evidence.current?.invalidate(attemptId),
  });
  const { coordinator, store, owner, resolution, modules, bootId, keys, recoveryDelivery } =
    runtime;
  const legacyEvidence = createFirstFiscalEvidence({
    ...options,
    modules,
    store,
    coordinator,
    bootId,
    owner,
  });
  const delivery = createFirstFiscalDelivery({
    ...options,
    modules,
    store,
    coordinator,
    owner,
    keys,
    bootId,
  });
  const { assertFreshAssignment, assertSelection, preparation } = runtime;
  const configuredEvidence = {
    ...legacyEvidence,
    invalidate(attemptId: string) {
      legacyEvidence.invalidate(attemptId);
      delivery.invalidate(attemptId);
      recoveryDelivery.invalidate(attemptId);
    },
    async read(binding: OperationBinding) {
      if (binding.action !== "setup") return undefined;
      const state = await store.readResumable();
      if (state === null) throw new AppError("setup.owner_required", {});
      const evidence = (await delivery.has(binding))
        ? await delivery.read(binding)
        : await legacyEvidence.read(binding);
      await assertFreshAssignment(state.state, binding.module);
      return evidence;
    },
  };
  evidence.current = configuredEvidence;
  return {
    withPreparationAuthorization: runtime.withPreparationAuthorization,
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
    recoveryDelivery,
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
    assertSelection,
    preparation,
    modules,
  };
}
