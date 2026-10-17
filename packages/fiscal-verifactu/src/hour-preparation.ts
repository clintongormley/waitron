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
import { createHourSelection, type HourSelectionFacts } from "./hour-selection.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import type { HourClockDecision } from "./hour-clock.js";
import type { HourHistorySource } from "./hour-history.js";
import { createSetupHourClock } from "./hour-setup-clock.js";
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
    ) => Promise<HourSelectionFacts & { confirmation?: object }>;
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
        const facts = await options.read(held.binding);
        const selector = createHourSelection({
          ...options,
          withState: async (_binding, body) => body(state),
          read: async () => facts,
        });
        const selected = await selector.selected({
          binding: held.binding,
          authority: held.authority,
          confirmation: facts.confirmation,
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
    async resume(operation: ModuleOperationInput, documentBinding: string) {
      const operator = initialOperator(operation);
      const input = structuredClone(operation.input);
      return engine.resume({
        binding: operation.binding,
        authority: operation.authority,
        documentBinding,
        validate(selected) {
          if (!isDeepStrictEqual(hourSetupInput(selected, operator), input))
            return refuse("event_mismatch");
        },
      });
    },
    preview(request: Omit<SelectionRequest, "answer">) {
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
    readClock?(
      context: InitialSetupContext,
    ): Promise<{ clock: HourClockDecision; confirmation?: object }>;
    monotonicNow?(): number;
  } = {},
) {
  if (host.readSetupFacts === undefined || host.withPreparationState === undefined)
    return refuse("outside_confirmation_missing");
  const clocks = createSetupHourClock();
  const confirmed = new Map<string, string>();
  const preparation = createHourPreparation({
    withState: host.withPreparationState,
    monotonicNow: options.monotonicNow ?? (() => performance.now()),
    read: async (binding) => {
      const facts = await host.readSetupFacts!(binding);
      const clock =
        options.readClock === undefined
          ? clocks.read(facts.contextKey, confirmed.get(facts.contextKey))
          : await options.readClock(structuredClone(facts.context));
      return {
        scope: { taxpayerNif: facts.context.taxId, environment: facts.context.environment },
        bases: facts.context.bases,
        contextKey: facts.contextKey,
        ...(facts.continuationKey === undefined ? {} : { waitKey: facts.continuationKey }),
        history: [facts.localHistory as HourHistorySource],
        clock: clock.clock,
        ...(clock.confirmation === undefined ? {} : { confirmation: clock.confirmation }),
      };
    },
  });
  const withFacts = <T>(
    binding: ModuleOperationInput["binding"],
    run: (
      facts: Awaited<ReturnType<NonNullable<ModuleOperationHost["readSetupFacts"]>>>,
    ) => T | Promise<T>,
  ) => host.withPreparationState!(binding, async () => run(await host.readSetupFacts!(binding)));
  return {
    ...preparation,
    clockChallenge(binding: ModuleOperationInput["binding"]) {
      return withFacts(binding, (facts) => {
        confirmed.delete(facts.contextKey);
        return clocks.challenge(facts.contextKey);
      });
    },
    compareClocks(
      binding: ModuleOperationInput["binding"],
      browser: Parameters<typeof clocks.compare>[2],
    ) {
      return withFacts(binding, (facts) => {
        confirmed.delete(facts.contextKey);
        return clocks.compare(facts.contextKey, facts.context.environment, browser);
      });
    },
    confirmClock(binding: ModuleOperationInput["binding"], comparisonId: string) {
      return withFacts(binding, (facts) => {
        const reading = clocks.read(facts.contextKey, comparisonId);
        if (confirmed.size === 64) confirmed.delete(confirmed.keys().next().value!);
        confirmed.set(facts.contextKey, comparisonId);
        return reading.clock;
      });
    },
  };
}

const hosted = new WeakMap<ModuleOperationHost, ReturnType<typeof createHostedHourPreparation>>();
export function hostedHourPreparation(host: ModuleOperationHost) {
  let value = hosted.get(host);
  if (value === undefined) {
    value = createHostedHourPreparation(host);
    hosted.set(host, value);
  }
  return value;
}
