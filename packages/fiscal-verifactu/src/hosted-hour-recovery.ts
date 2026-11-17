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
import {
  bootStanding,
  createSetupHourClock,
  selectionBoot,
  setBoxClockFrom,
  type SetupBrowserClockSample,
} from "./hour-setup-clock.js";
import { testClockOptions } from "./hour-preparation.js";
import type { HourHistorySource } from "./hour-history.js";
import "./errors.js";
import { chosenHourIssuedAtMs, conflictPreparationStatus } from "./hour-selection.js";

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
  const wall = clock.wall ?? Date.now;
  const clocks = createSetupHourClock({
    ...(clock.wall === undefined ? {} : { wall: clock.wall }),
    monotonic: monotonicNow,
    timeService: async () => (await host.timeServiceSynchronised?.()) ?? false,
  });
  const facts = async (binding: Parameters<NonNullable<typeof host.readRecoveryFacts>>[0]) => {
    const current = await host.readRecoveryFacts!(binding);
    if (current.country !== "ES") return refuse();
    return current;
  };
  const options: Parameters<typeof createHourRecoveryPreparation>[0] = {
    withState: host.withPreparationState,
    monotonicNow,
    readBoot: () => selectionBoot(host),
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
  const { standing, chosen } = bootStanding(host, wall, monotonicNow);
  const confirmed = () => {
    const kept = host.startClockConfirmation?.();
    if (kept == null || kept.reading.result !== "usable") return undefined;
    const { instantMs, wallFinishedMs, uncertaintyMs } = kept.reading;
    // The device read its clock at the round trip's midpoint.
    return standing(kept.boot, instantMs - (wallFinishedMs - uncertaintyMs), uncertaintyMs);
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
      operation.binding.action === "conflict-switch" &&
      exact(proposal, ["action"]) &&
      proposal.action === "status"
    )
      return host.withPreparationState!(operation.binding, async (state) => {
        const result = conflictPreparationStatus(state.history, operation.binding);
        check();
        return result;
      });
    if (
      (exact(proposal, ["action", "comparisonId"]) ||
        (exact(proposal, ["action", "comparisonId", "confirmed"]) &&
          proposal.confirmed === true)) &&
      proposal.action === "select" &&
      typeof proposal.comparisonId === "string"
    )
      return preparationFor(operation.binding).select({
        ...operation,
        comparisonId: proposal.comparisonId,
        ...(proposal.confirmed === true ? { confirmed: true } : {}),
      });
    if (exact(proposal, ["action"]) && proposal.action === "preview")
      return preparationFor(operation.binding).preview(operation);
    return host.withPreparationState!(operation.binding, async (state) => {
      const current = await facts(operation.binding);
      check();
      if (exact(proposal, ["action"]) && proposal.action === "clock-challenge")
        return clocks.challenge(current.contextKey);
      if (
        exact(proposal, ["action", "browser"]) &&
        (proposal.action === "compare-clocks" || proposal.action === "set-clock")
      ) {
        if (
          (proposal.browser !== null || proposal.action === "set-clock") &&
          (!exact(proposal.browser, ["challengeId", "instantMs"]) ||
            typeof proposal.browser.challengeId !== "string" ||
            !Number.isSafeInteger(proposal.browser.instantMs))
        )
          return refuse();
        if (proposal.action === "set-clock")
          return setBoxClockFrom(
            host,
            operation.binding,
            state,
            clocks.setFromBrowser(
              current.contextKey,
              proposal.browser as unknown as SetupBrowserClockSample,
              client,
            ),
          );
        const result = await clocks.compare(
          current.contextKey,
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
      await host.withPreparationState!(held.binding, async (state) => {
        const current = await facts(held.binding);
        operatorFor(held);
        if (current.priorActivation === "committed") return;
        const chosenMs = chosenHourIssuedAtMs(state, held.binding);
        if (chosenMs !== undefined) host.startClockChosenMinute?.(chosenMs);
        await clocks.compare(
          current.contextKey,
          null,
          { onBox: true },
          () => chosen(state, held.binding) ?? confirmed(),
        );
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
