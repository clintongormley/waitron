import { reportedHourCodes } from "./reported-hour-codes.js";
import { AppError } from "@waitron/shared";
import type {
  ModuleOperationHost,
  ModuleOperationInput,
  ModuleOperationPreparation,
} from "@waitron/module";
import {
  createHourRecoveryPreparation,
  recoveryHourOperator,
} from "./hour-recovery-preparation.js";
import { createSetupHourClock, type SetupBrowserClockSample } from "./hour-setup-clock.js";
import type { HourHistorySource } from "./hour-history.js";
import "./errors.js";

function refuse(reason = "event_mismatch"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function createHostedHourRecovery(host: ModuleOperationHost) {
  if (host.readRecoveryFacts === undefined || host.withPreparationState === undefined)
    return refuse("outside_confirmation_missing");
  const clocks = createSetupHourClock();
  const confirmed = new Map<string, string>();
  const facts = async (binding: Parameters<NonNullable<typeof host.readRecoveryFacts>>[0]) => {
    const current = await host.readRecoveryFacts!(binding);
    if (current.country !== "ES") return refuse();
    return current;
  };
  const preparation = createHourRecoveryPreparation({
    withState: host.withPreparationState,
    monotonicNow: () => performance.now(),
    readContext: async (binding) => {
      const current = await facts(binding);
      return {
        ...current,
        scope: { taxpayerNif: current.taxId, environment: current.environment },
        history: current.history as readonly HourHistorySource[],
      };
    },
    read: async (binding) => {
      const current = await facts(binding);
      const reading = clocks.read(current.contextKey, confirmed.get(current.contextKey));
      return {
        ...current,
        scope: { taxpayerNif: current.taxId, environment: current.environment },
        history: current.history as readonly HourHistorySource[],
        ...reading,
      };
    },
  });
  const recovery: NonNullable<ModuleOperationPreparation["recovery"]> = async (
    supplied,
    proposal,
  ) => {
    const operation = { ...supplied, binding: Object.freeze({ ...supplied.binding }) };
    const check = () => recoveryHourOperator(operation.binding, operation.authority);
    check();
    if (
      exact(proposal, ["action", "answer", "installationCodes"]) &&
      proposal.action === "select" &&
      ["no", "yes", "unknown"].includes(proposal.answer as string)
    )
      return preparation.select({
        ...operation,
        answer: proposal.answer as "no" | "yes" | "unknown",
        reportedIdentities: reportedHourCodes(proposal.installationCodes),
      });
    if (exact(proposal, ["action"]) && proposal.action === "preview")
      return preparation.preview(operation);
    return host.withPreparationState!(operation.binding, async () => {
      const current = await facts(operation.binding);
      check();
      if (exact(proposal, ["action"]) && proposal.action === "clock-challenge") {
        confirmed.delete(current.contextKey);
        return clocks.challenge(current.contextKey);
      }
      if (exact(proposal, ["action", "browser"]) && proposal.action === "compare-clocks") {
        if (
          proposal.browser !== null &&
          (!exact(proposal.browser, ["challengeId", "instantMs"]) ||
            typeof proposal.browser.challengeId !== "string" ||
            !Number.isSafeInteger(proposal.browser.instantMs))
        )
          return refuse();
        confirmed.delete(current.contextKey);
        const result = await clocks.compare(
          current.contextKey,
          current.environment,
          proposal.browser as SetupBrowserClockSample | null,
        );
        check();
        return result;
      }
      if (
        exact(proposal, ["action", "comparisonId"]) &&
        proposal.action === "confirm-clock" &&
        typeof proposal.comparisonId === "string"
      ) {
        const reading = clocks.read(current.contextKey, proposal.comparisonId);
        if (confirmed.size === 64) confirmed.delete(confirmed.keys().next().value!);
        confirmed.set(current.contextKey, proposal.comparisonId);
        return reading.clock;
      }
      return refuse();
    });
  };
  return {
    prepare: preparation.prepare,
    recovery,
    async resume(operation: Pick<ModuleOperationInput, "binding" | "authority">) {
      const held = { ...operation, binding: Object.freeze({ ...operation.binding }) };
      recoveryHourOperator(held.binding, held.authority);
      await host.withPreparationState!(held.binding, async () => {
        const current = await facts(held.binding);
        recoveryHourOperator(held.binding, held.authority);
        if (current.priorActivation === "committed") return;
        confirmed.delete(current.contextKey);
        await clocks.compare(current.contextKey, current.environment, null);
        recoveryHourOperator(held.binding, held.authority);
      });
    },
  };
}
const hosted = new WeakMap<ModuleOperationHost, ReturnType<typeof createHostedHourRecovery>>();
export function hostedHourRecovery(host: ModuleOperationHost) {
  let value = hosted.get(host);
  if (value === undefined) {
    value = createHostedHourRecovery(host);
    hosted.set(host, value);
  }
  return value;
}
