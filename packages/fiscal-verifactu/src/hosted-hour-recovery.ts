import { reportedHourCodes } from "./reported-hour-codes.js";
import { AppError } from "@waitron/shared";
import type {
  ModuleOperationHost,
  ModuleOperationInput,
  ModuleOperationPreparation,
} from "@waitron/module";
import {
  createHourRecoveryPreparation,
  createHourPromotionPreparation,
  promotionHourOperator,
  recoveryHourOperator,
} from "./hour-recovery-preparation.js";
import { createSetupHourClock, type SetupBrowserClockSample } from "./hour-setup-clock.js";
import { testClockOptions } from "./hour-preparation.js";
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
function createHostedHourRecovery(
  host: ModuleOperationHost,
  clock: { wall?(): number; monotonicNow?(): number } = {},
) {
  if (host.readRecoveryFacts === undefined || host.withPreparationState === undefined)
    return refuse("outside_confirmation_missing");
  const monotonicNow = clock.monotonicNow ?? (() => performance.now());
  const clocks = createSetupHourClock({
    ...(clock.wall === undefined ? {} : { wall: clock.wall }),
    monotonic: monotonicNow,
  });
  const facts = async (binding: Parameters<NonNullable<typeof host.readRecoveryFacts>>[0]) => {
    const current = await host.readRecoveryFacts!(binding);
    if (current.country !== "ES") return refuse();
    return current;
  };
  const options: Parameters<typeof createHourRecoveryPreparation>[0] = {
    withState: host.withPreparationState,
    monotonicNow,
    readContext: async (binding) => {
      const current = await facts(binding);
      return {
        ...current,
        scope: { taxpayerNif: current.taxId, environment: current.environment },
        history: current.history as readonly HourHistorySource[],
      };
    },
    read: async (binding, comparisonId) => {
      const current = await facts(binding);
      const reading = clocks.read(current.contextKey, comparisonId);
      return {
        ...current,
        scope: { taxpayerNif: current.taxId, environment: current.environment },
        history: current.history as readonly HourHistorySource[],
        ...reading,
      };
    },
  };
  const recoveryPreparation = createHourRecoveryPreparation(options);
  const promotionPreparation = createHourPromotionPreparation(options);
  const preparationFor = (binding: ModuleOperationInput["binding"]) =>
    binding.action === "promote" ? promotionPreparation : recoveryPreparation;
  const operatorFor = (operation: Pick<ModuleOperationInput, "binding" | "authority">) =>
    (operation.binding.action === "promote" ? promotionHourOperator : recoveryHourOperator)(
      operation.binding,
      operation.authority,
    );
  const recovery: NonNullable<ModuleOperationPreparation["recovery"]> = async (
    supplied,
    proposal,
    client,
  ) => {
    const operation = { ...supplied, binding: Object.freeze({ ...supplied.binding }) };
    const check = () => operatorFor(operation);
    check();
    if (
      exact(proposal, ["action", "answer", "comparisonId", "installationCodes"]) &&
      proposal.action === "select" &&
      ["no", "yes", "unknown"].includes(proposal.answer as string) &&
      typeof proposal.comparisonId === "string"
    )
      return preparationFor(operation.binding).select({
        ...operation,
        answer: proposal.answer as "no" | "yes" | "unknown",
        comparisonId: proposal.comparisonId,
        reportedIdentities: reportedHourCodes(proposal.installationCodes),
      });
    if (exact(proposal, ["action"]) && proposal.action === "preview")
      return preparationFor(operation.binding).preview(operation);
    return host.withPreparationState!(operation.binding, async () => {
      const current = await facts(operation.binding);
      check();
      if (exact(proposal, ["action"]) && proposal.action === "clock-challenge")
        return clocks.challenge(current.contextKey);
      if (exact(proposal, ["action", "browser"]) && proposal.action === "compare-clocks") {
        if (
          proposal.browser !== null &&
          (!exact(proposal.browser, ["challengeId", "instantMs"]) ||
            typeof proposal.browser.challengeId !== "string" ||
            !Number.isSafeInteger(proposal.browser.instantMs))
        )
          return refuse();
        const result = await clocks.compare(
          current.contextKey,
          current.environment,
          proposal.browser as SetupBrowserClockSample | null,
          client,
        );
        check();
        return result;
      }
      return refuse();
    });
  };
  return {
    async prepare<T>(
      operation: ModuleOperationInput,
      run: (prepared: ModuleOperationInput) => Promise<T>,
    ): Promise<T> {
      return preparationFor(operation.binding).prepare(operation, run);
    },
    recovery,
    async resume(operation: Pick<ModuleOperationInput, "binding" | "authority">) {
      const held = { ...operation, binding: Object.freeze({ ...operation.binding }) };
      operatorFor(held);
      await host.withPreparationState!(held.binding, async () => {
        const current = await facts(held.binding);
        operatorFor(held);
        if (current.priorActivation === "committed") return;
        await clocks.compare(current.contextKey, current.environment, null, { onBox: true });
        operatorFor(held);
      });
    },
  };
}
const hosted = new WeakMap<ModuleOperationHost, ReturnType<typeof createHostedHourRecovery>>();
export function hostedHourRecovery(host: ModuleOperationHost) {
  let value = hosted.get(host);
  if (value === undefined) {
    value = createHostedHourRecovery(host, testClockOptions(host));
    hosted.set(host, value);
  }
  return value;
}
