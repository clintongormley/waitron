import { writeModuleConfig } from "./module-config.js";
import { isDeepStrictEqual } from "node:util";
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
import { createFirstSetupNodeKeys } from "./first-setup-node-key.js";
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
      const document = await readFirstFiscalDeliverySnapshot(name, state, originals);
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
  const { coordinator, store, owner, resolution, modules, bootId } = runtime;
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
    const retired = await readRetiredSetup(name);
    const retainedFacts = retired.flatMap((entry) =>
      entry.publicEvidence
        .map((value) => seat.retainedAssignments?.(value))
        .filter((value) => value !== undefined),
    );
    for (const facts of retainedFacts) {
      if (
        facts.keys.some((key) => candidates.has(key)) ||
        facts.positions.some((floor) =>
          positions.some(
            (value) => value.namespace === floor.namespace && value.position <= floor.position,
          ),
        )
      )
        throw new AppError("setup.attempt_conflict", {});
    }
    for (const old of [
      ...state.previous
        .filter((attempt) => attempt.frozen.modules.some((entry) => entry.module === name))
        .map((attempt) => ({
          context: firstSetupModuleContext(attempt, name),
          input: attempt.inputs[name],
        })),
      ...retired,
    ]) {
      for (const key of seat.assignmentKeys?.(old.context, old.input) ?? [])
        if (candidates.has(key)) throw new AppError("setup.attempt_conflict", {});
      for (const floor of seat.assignmentPositions?.(old.context, old.input) ?? [])
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
