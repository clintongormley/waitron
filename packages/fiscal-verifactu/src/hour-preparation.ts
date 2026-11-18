import { isDeepStrictEqual } from "node:util";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type ModuleOperationPreparation,
  type ModuleOperationHost,
  type InitialSetupContext,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { withHourAdmission } from "./allocation-envelope.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import {
  createHourSelection,
  type HourSelectionFacts,
  type HourSelectionStore,
} from "./hour-selection.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import type { HourClockDecision } from "./hour-clock.js";
import type { HourHistorySource } from "./hour-history.js";
import {
  bootStanding,
  createSetupHourClock,
  selectionBoot,
  setBoxClockFrom,
} from "./hour-setup-clock.js";
import "./errors.js";

type SelectionOptions = Parameters<typeof createHourSelection>[0];
type Selected = Awaited<ReturnType<ReturnType<typeof createHourSelection>["selected"]>>;
type SelectionRequest = Parameters<ReturnType<typeof createHourSelection>["select"]>[0];

function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function initialOperator(operation: Pick<ModuleOperationInput, "binding" | "authority">) {
  const operator = readOperationAuthority(operation.authority, operation.binding);
  if (
    operator === undefined ||
    typeof operator.operatorId !== "string" ||
    operator.operatorId.trim().length === 0
  )
    return refuse("reauthentication_required");
  if (operation.binding.action !== "setup") return refuse("event_mismatch");
  return operator.operatorId;
}
export function hourSetupInput(
  selected: Pick<Selected, "binding" | "scope" | "bases" | "identity" | "issuedAt">,
  operatorId: string,
) {
  return {
    allocation: {
      version: 1,
      allocationId: `hour/${selected.binding.eventId}`,
      taxpayerNif: selected.scope.taxpayerNif,
      softwareId: WAITRON_ID_SISTEMA,
      environment: selected.scope.environment,
      installationIdentity: selected.identity,
      series: selected.bases.map(({ code, purpose }) => ({
        code: `${code}-${selected.identity}`,
        purpose,
      })),
      source: "hour",
      reservationEvidence: null,
      issuedAt: selected.issuedAt,
    },
    approval: {
      version: 1,
      eventId: selected.binding.eventId,
      sourceId: selected.binding.sourceId,
      targetNodeId: selected.binding.targetNodeId,
      operatorId,
      oldMachineAbsent: true,
      oldMachineOffline: false,
      noParallelRecovery: true,
      confirmedAt: selected.issuedAt,
      incidentEvidence: `hour/${selected.binding.eventId}`,
    },
  };
}

export function createHourPreparation(
  options: Omit<SelectionOptions, "read"> & {
    read: (
      binding: ModuleOperationInput["binding"],
      comparisonId?: string,
    ) => Promise<HourSelectionFacts>;
    /** Takes activation's own clock reading before `read` looks at the held ones. */
    refreshClock?: (
      binding: ModuleOperationInput["binding"],
      state: Parameters<Parameters<HourSelectionStore>[1]>[0],
    ) => Promise<void>;
  },
) {
  const engine = createHourSelection(options);
  const operations: ModuleOperationPreparation = {
    prepare(operation, run) {
      const held = { ...operation, binding: { ...operation.binding }, input: undefined as unknown };
      initialOperator(held);
      try {
        held.input = structuredClone(operation.input);
      } catch {
        return refuse("malformed_allocation");
      }
      return options.withState(held.binding, async (state) => {
        await options.refreshClock?.(held.binding, state);
        const facts = await options.read(held.binding);
        const selector = createHourSelection({
          ...options,
          withState: async (_binding, body) => body(state),
          read: async () => facts,
        });
        const selected = await selector.selected({
          binding: held.binding,
          authority: held.authority,
        });
        if (!isDeepStrictEqual(hourSetupInput(selected, initialOperator(held)), held.input))
          return refuse("event_mismatch");
        return withHourAdmission(
          held,
          { requiredBases: selected.bases, priorActivation: "none" },
          (evidence) =>
            createAllocationPreparation(async (scope) => ({ ...scope, evidence })).prepare(
              held,
              run,
            ),
        );
      });
    },
  };
  return {
    ...operations,
    preview(request: Omit<SelectionRequest, "comparisonId">) {
      initialOperator(request);
      return engine.preview(request);
    },
    async select(request: SelectionRequest) {
      initialOperator(request);
      const selected = await engine.select(request);
      return selected.status === "selected"
        ? { ...selected, input: hourSetupInput(selected, initialOperator(request)) }
        : selected;
    },
  };
}

export function createHostedHourPreparation(
  host: ModuleOperationHost,
  options: {
    /** Replaces the held readings, so activation takes no clock reading of its own. */
    readClock?(context: InitialSetupContext): Promise<{ clock: HourClockDecision }>;
    wall?(): number;
    monotonicNow?(): number;
  } = {},
) {
  if (host.readSetupFacts === undefined || host.withPreparationState === undefined)
    return refuse("outside_confirmation_missing");
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const clocks = createSetupHourClock({
    ...(options.wall === undefined ? {} : { wall: options.wall }),
    monotonic: monotonicNow,
    timeService: async () => (await host.timeServiceSynchronised?.()) ?? false,
  });
  const admission = (context: InitialSetupContext) => ({
    boxClockAlone:
      host.environment.WAITRON_ENV === "dev" && context.environment === "preproduction",
  });
  const kept = bootStanding(host, options.wall ?? Date.now, monotonicNow);
  const preparation = createHourPreparation({
    withState: host.withPreparationState,
    monotonicNow,
    readBoot: () => selectionBoot(host),
    refreshClock: async (binding, state) => {
      if (options.readClock !== undefined) return;
      const { contextKey, context } = await host.readSetupFacts!(binding);
      // Twenty seconds leaves a held reading ten of its thirty when `read` takes it.
      if (clocks.admitsWithin(contextKey, 20_000)) return;
      await clocks.compare(
        contextKey,
        null,
        { onBox: true },
        () => kept.chosen(state, binding, true),
        admission(context),
      );
    },
    read: async (binding, comparisonId) => {
      const facts = await host.readSetupFacts!(binding);
      const clock =
        options.readClock === undefined
          ? clocks.read(facts.contextKey, comparisonId)
          : await options.readClock(structuredClone(facts.context));
      return {
        scope: { taxpayerNif: facts.context.taxId, environment: facts.context.environment },
        bases: facts.context.bases,
        contextKey: facts.contextKey,
        ...(facts.continuationKey === undefined ? {} : { waitKey: facts.continuationKey }),
        history: [facts.localHistory] as HourHistorySource[],
        clock: clock.clock,
      };
    },
  });
  const withFacts = <T>(
    binding: ModuleOperationInput["binding"],
    run: (
      facts: Awaited<ReturnType<NonNullable<ModuleOperationHost["readSetupFacts"]>>>,
      state: Parameters<Parameters<HourSelectionStore>[1]>[0],
    ) => T | Promise<T>,
  ) =>
    host.withPreparationState!(binding, async (state) =>
      run(await host.readSetupFacts!(binding), state),
    );
  return {
    ...preparation,
    clockChallenge(binding: ModuleOperationInput["binding"]) {
      return withFacts(binding, (facts) => clocks.challenge(facts.contextKey));
    },
    setClock(
      binding: ModuleOperationInput["binding"],
      browser: Parameters<typeof clocks.setFromBrowser>[1],
      client: Parameters<typeof clocks.setFromBrowser>[2],
    ) {
      return withFacts(binding, (facts, state) =>
        setBoxClockFrom(
          host,
          binding,
          state,
          clocks.setFromBrowser(facts.contextKey, browser, client),
        ),
      );
    },
    compareClocks(
      binding: ModuleOperationInput["binding"],
      browser: Parameters<typeof clocks.compare>[1],
      client: Parameters<typeof clocks.compare>[2],
    ) {
      return withFacts(binding, (facts) =>
        clocks.compare(facts.contextKey, browser, client, undefined, admission(facts.context)),
      );
    },
  };
}

export function testClockOptions(host: ModuleOperationHost) {
  const clock = host.testClock;
  return clock === undefined
    ? {}
    : { wall: () => clock.wall(), monotonicNow: () => clock.monotonic() };
}
const hosted = new WeakMap<ModuleOperationHost, ReturnType<typeof createHostedHourPreparation>>();
export function hostedHourPreparation(host: ModuleOperationHost) {
  let value = hosted.get(host);
  if (value === undefined) {
    value = createHostedHourPreparation(host, testClockOptions(host));
    hosted.set(host, value);
  }
  return value;
}
