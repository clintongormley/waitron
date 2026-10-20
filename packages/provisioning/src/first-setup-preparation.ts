import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import {
  enabledModules,
  initialSetupFor,
  type ModuleConfig,
  type ModuleOperationHost,
  type WaitronModule,
} from "@waitron/module";
import type { createFirstSetupOwner, FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type {
  FirstSetupCoordinator,
  FirstSetupHold,
  FirstSetupState,
  FirstSetupStore,
} from "./first-setup-state.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import "./errors.js";

interface Options {
  modules: readonly WaitronModule[];
  moduleConfig?: ModuleConfig;
  owner: ReturnType<typeof createFirstSetupOwner>;
  store: FirstSetupStore;
  coordinator: FirstSetupCoordinator;
  readRetiredSetup?: ModuleOperationHost["readRetiredSetup"];
  resumeBinding?(
    owner: FirstSetupOwnerAttempt,
    module: string,
    hold: FirstSetupHold,
  ): Promise<string>;
  withPreparationAuthorization<T>(
    authorize: () => Promise<void>,
    run: () => Promise<T>,
  ): Promise<T>;
}

function invalid(): never {
  throw new AppError("setup.request_invalid", { field: "body" });
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}

export function createFirstSetupPreparation(options: Options) {
  const { modules } = options;
  const assertSelection = (state: FirstSetupState) => {
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
      conflict();
  };
  const assertFreshAssignment = async (
    state: FirstSetupState,
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
    const retired = (await options.readRetiredSetup?.(name)) ?? [];
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
        conflict();
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
        if (candidates.has(key)) conflict();
      for (const floor of seat.assignmentPositions?.(old.context, old.input) ?? []) {
        if (
          positions.some(
            (value) => value.namespace === floor.namespace && value.position <= floor.position,
          )
        )
          conflict();
      }
    }
  };
  const inside = <T>(
    hold: FirstSetupHold | undefined,
    run: (held: FirstSetupHold) => Promise<T>,
  ) =>
    hold === undefined
      ? options.coordinator.run(run)
      : options.coordinator.held(hold, () => run(hold));
  const selected = (state: FirstSetupState, module: string) => {
    assertSelection(state);
    const entry = state.frozen.modules.find((value) => value.module === module);
    const installed = modules.find((value) => value.name === module);
    const seat = initialSetupFor(modules, module);
    if (entry === undefined || entry.version !== installed?.version || seat === undefined)
      invalid();
    return { seat, context: firstSetupModuleContext(state, module) };
  };
  return {
    assertSelection,
    assertFreshAssignment,
    preparation: {
      resume(
        owner: FirstSetupOwnerAttempt,
        module: string,
        reconfirmation: string,
        hold?: FirstSetupHold,
      ) {
        return inside(hold, async (held) => {
          const state = await options.owner.authorize(owner);
          const ownership = [...state.history]
            .reverse()
            .find((event) => ["claim", "resume", "recover"].includes(event.kind));
          if (ownership?.kind !== "recover" || ownership.ownerGeneration !== state.ownerGeneration)
            throw new AppError("setup.owner_required", {});
          if (state.status !== "consumption-intent" || !Object.hasOwn(state.inputs, module))
            conflict();
          const { seat, context } = selected(state, module);
          if (seat.resume === undefined || options.resumeBinding === undefined)
            throw new AppError("setup.not_ready", {});
          const binding = await options.resumeBinding(owner, module, held);
          await options.owner.consumeReconfirmation(owner, reconfirmation, "block-use", held);
          await options.withPreparationAuthorization(
            async () => {
              await options.owner.authorize(owner);
              if ((await options.resumeBinding!(owner, module, held)) !== binding) conflict();
            },
            () => seat.resume!(context, structuredClone(state.inputs[module]), binding),
          );
          await options.owner.authorize(owner);
        });
      },
      prepare(
        owner: FirstSetupOwnerAttempt,
        module: string,
        proposal: unknown,
        hold?: FirstSetupHold,
      ) {
        return inside(hold, async () => {
          const state = await options.owner.authorize(owner);
          const { seat, context } = selected(state, module);
          if (seat.preparation === undefined) invalid();
          return seat.preparation(context, proposal);
        });
      },
      select(
        owner: FirstSetupOwnerAttempt,
        module: string,
        proposal: unknown,
        reconfirmation: unknown,
        hold?: FirstSetupHold,
      ) {
        return inside(hold, async (held) => {
          let state = await options.owner.authorize(owner);
          if (state.status !== "claimed") conflict();
          const { seat, context } = selected(state, module);
          let reconfirmed = false;
          const confirm = async () => {
            if (reconfirmed) return;
            if (
              typeof reconfirmation !== "string" ||
              !reconfirmation.length ||
              Buffer.byteLength(reconfirmation) > 65536
            )
              invalid();
            await options.owner.consumeReconfirmation(owner, reconfirmation, "block-use", held);
            reconfirmed = true;
          };
          const request = await options.withPreparationAuthorization(confirm, async () =>
            seat.request(context, await seat.candidates(context, proposal)),
          );
          if (seat.pending?.(request)) {
            await confirm();
            return { state, preparation: request };
          }
          await assertFreshAssignment(
            {
              ...state,
              frozen: {
                ...state.frozen,
                modules: state.frozen.modules.map((entry) =>
                  entry.module === module ? { ...entry, request } : entry,
                ),
              },
            },
            module,
          );
          await confirm();
          state = await options.store.update(
            owner.attemptId,
            state.revision,
            { kind: "candidates", module, request },
            held,
          );
          if (
            state.frozen.modules.every(
              (entry) =>
                initialSetupFor(modules, entry.module) === undefined || entry.request !== null,
            )
          ) {
            state = await options.store.update(
              owner.attemptId,
              state.revision,
              { kind: "consumption-intent" },
              held,
            );
          }
          options.owner.invalidate(owner.attemptId);
          return { state };
        });
      },
      import(owner: FirstSetupOwnerAttempt, module: string, input: unknown, hold?: FirstSetupHold) {
        return inside(hold, async (held) => {
          let state = await options.owner.authorize(owner);
          const { seat, context } = selected(state, module);
          const imported = seat.inspect(context, input);
          await assertFreshAssignment(state, module, imported.input);
          if (Object.hasOwn(state.inputs, module)) {
            if (!isDeepStrictEqual(state.inputs[module], imported.input)) conflict();
          } else {
            state = await options.store.update(
              owner.attemptId,
              state.revision,
              { kind: "import", module, input: imported.input },
              held,
            );
          }
          options.owner.invalidate(owner.attemptId);
          return state;
        });
      },
    },
  };
}
