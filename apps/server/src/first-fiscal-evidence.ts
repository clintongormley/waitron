import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import {
  initialSetupFor,
  type InitialSetupContext,
  type OperationBinding,
  type WaitronModule,
} from "@waitron/module";
import {
  readDurableHostJson,
  writeDurableHostJson,
  type FirstSetupCoordinator,
  type FirstSetupHold,
  type FirstSetupState,
  type FirstSetupStore,
} from "@waitron/provisioning";
import type { createFirstSetupOwner, FirstSetupOwnerAttempt } from "./first-setup-owner.js";

interface Enrolled {
  attemptId: string;
  publicKey: unknown;
  comparison: unknown;
  trust: unknown;
}
interface PublicEvidenceFile {
  version: 1;
  modules: Record<string, Enrolled>;
  history: {
    attemptId: string;
    revision: number;
    ownerGeneration: number;
    module: string;
    current: unknown;
  }[];
}
interface EvidenceOptions {
  stateDir: string;
  store: FirstSetupStore;
  bootId: string;
  owner: ReturnType<typeof createFirstSetupOwner>;
  coordinator: FirstSetupCoordinator;
  modules: readonly WaitronModule[];
}
function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key))
  );
}
export function firstSetupModuleContext(state: FirstSetupState, name: string): InitialSetupContext {
  const frozen = state.frozen;
  const module = frozen.modules.find((entry) => entry.module === name);
  if (module === undefined) refuse();
  return {
    attemptId: frozen.attemptId,
    binding: {
      module: name,
      action: "setup",
      eventId: module.eventId,
      sourceId: frozen.sourceId,
      targetNodeId: frozen.nodeId,
    },
    administratorId: frozen.administratorId,
    country: frozen.request.country,
    taxId: frozen.request.taxId,
    environment: frozen.environment,
    recipientVenueId: frozen.sourceId,
    bases: [
      { code: frozen.request.seriesCode, purpose: "standard" },
      { code: frozen.request.fullSeriesCode ?? "FF", purpose: "full" },
      { code: frozen.request.rectificativeSeriesCode, purpose: "rectificative" },
    ],
    request: module.request,
  };
}
export function createFirstFiscalEvidence(options: EvidenceOptions) {
  const path = join(options.stateDir, "module-operation-public.json");
  const grants = new Map<
    string,
    {
      attemptId: string;
      revision: number;
      ownerGeneration: number;
      bootId: string;
      expires: number;
      enrolled: Enrolled;
      input: unknown;
      current: unknown;
    }
  >();
  const invalidate = (attemptId: string) => {
    for (const [key, grant] of grants) if (grant.attemptId === attemptId) grants.delete(key);
  };
  const inside = <T>(
    hold: FirstSetupHold | undefined,
    run: (held: FirstSetupHold) => Promise<T>,
  ) =>
    hold === undefined
      ? options.coordinator.run(run)
      : options.coordinator.held(hold, () => run(hold));
  const seat = (state: FirstSetupState, name: string) => {
    const selected = state.frozen.modules.find((entry) => entry.module === name);
    const available = options.modules.find((entry) => entry.name === name);
    if (selected === undefined || available?.version !== selected.version) refuse();
    const contribution = initialSetupFor(options.modules, name);
    if (contribution === undefined) refuse();
    return contribution;
  };
  const readFile = async (): Promise<PublicEvidenceFile | null> => {
    const value = await readDurableHostJson(path, 64 * 1024);
    if (value === null) return null;
    if (
      !exact(value, ["version", "modules", "history"]) ||
      value.version !== 1 ||
      !record(value.modules) ||
      !Array.isArray(value.history)
    )
      refuse();
    for (const [name, enrolled] of Object.entries(value.modules)) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(name) ||
        !exact(enrolled, ["attemptId", "publicKey", "comparison", "trust"]) ||
        typeof enrolled.attemptId !== "string"
      )
        refuse();
    }
    for (const entry of value.history) {
      if (
        !exact(entry, ["attemptId", "revision", "ownerGeneration", "module", "current"]) ||
        typeof entry.attemptId !== "string" ||
        typeof entry.module !== "string" ||
        !Number.isSafeInteger(entry.revision) ||
        !Number.isSafeInteger(entry.ownerGeneration)
      )
        refuse();
    }
    return value as unknown as PublicEvidenceFile;
  };
  const enrolledTrust = (state: FirstSetupState, name: string, entry: Enrolled | undefined) => {
    if (entry === undefined || entry.attemptId !== state.frozen.attemptId) refuse();
    const trust = seat(state, name).enrol(
      firstSetupModuleContext(state, name),
      entry.publicKey,
      entry.comparison,
    );
    if (!isDeepStrictEqual(trust, entry.trust)) refuse();
    return trust;
  };
  return {
    invalidate,
    enrol(
      owner: FirstSetupOwnerAttempt,
      name: string,
      publicKey: unknown,
      comparison: unknown,
      hold?: FirstSetupHold,
    ) {
      invalidate(owner.attemptId);
      return inside(hold, async () => {
        const state = await options.owner.authorize(owner);
        const trust = seat(state, name).enrol(
          firstSetupModuleContext(state, name),
          publicKey,
          comparison,
        );
        const file = (await readFile()) ?? { version: 1, modules: {}, history: [] };
        file.modules[name] = structuredClone({
          attemptId: owner.attemptId,
          publicKey,
          comparison,
          trust,
        });
        await writeDurableHostJson(path, file, 64 * 1024);
      });
    },
    confirm(
      owner: FirstSetupOwnerAttempt,
      name: string,
      statement: unknown,
      reconfirmation: string,
      hold?: FirstSetupHold,
    ) {
      invalidate(owner.attemptId);
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner);
        await options.owner.consumeReconfirmation(owner, reconfirmation, "activation", held);
        if (!state.consumptionIntent) refuse();
        const file = await readFile();
        const enrolled = file?.modules[name];
        const trust = enrolledTrust(state, name, enrolled);
        const contribution = seat(state, name);
        const context = firstSetupModuleContext(state, name);
        const imported = contribution.inspect(context, state.inputs[name]);
        const current = contribution.confirmation(context, imported, { trust, current: statement });
        file!.history.push({
          attemptId: owner.attemptId,
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
          module: name,
          current,
        });
        await writeDurableHostJson(path, file, 64 * 1024);
        grants.set(name, {
          attemptId: owner.attemptId,
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
          bootId: options.bootId,
          expires: performance.now() + 300000,
          enrolled: structuredClone(enrolled!),
          input: structuredClone(imported.input),
          current,
        });
      });
    },
    async read(
      binding: OperationBinding,
    ): Promise<{ trust: unknown; current: unknown } | undefined> {
      const grant = grants.get(binding.module);
      // Claim before any await: concurrent preparations cannot consume the same consultation.
      grants.delete(binding.module);
      const state = await options.store.read();
      if (state === null || binding.action !== "setup") return undefined;
      if (
        state.status === "complete" ||
        state.status === "abandoned" ||
        state.status === "uncertain" ||
        grant === undefined ||
        grant.attemptId !== state.frozen.attemptId ||
        grant.revision !== state.revision ||
        grant.ownerGeneration !== state.ownerGeneration ||
        grant.bootId !== options.bootId ||
        performance.now() >= grant.expires
      )
        refuse();
      const context = firstSetupModuleContext(state, binding.module);
      if (
        !isDeepStrictEqual(context.binding, binding) ||
        !isDeepStrictEqual(grant.input, state.inputs[binding.module])
      )
        refuse();
      const file = await readFile();
      if (!isDeepStrictEqual(file?.modules[binding.module], grant.enrolled)) refuse();
      const trust = enrolledTrust(state, binding.module, file?.modules[binding.module]);
      const contribution = seat(state, binding.module);
      const current = contribution.confirmation(
        context,
        contribution.inspect(context, state.inputs[binding.module]),
        { trust, current: grant.current },
      );
      const final = await options.store.read();
      if (!isDeepStrictEqual(state, final) || performance.now() >= grant.expires) refuse();
      return structuredClone({ trust, current });
    },
  };
}
