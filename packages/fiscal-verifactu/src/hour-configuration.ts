import "./errors.js";
import { AppError } from "@waitron/shared";
import type {
  InitialSetupContribution,
  ModuleOperationHost,
  ModuleOperationPreparation,
} from "@waitron/module";
import { createHourInitialSetup } from "./initial-hour-setup.js";
import { FISCAL_INITIAL_SETUP as historicalInitialSetup } from "./initial-setup.js";
import { hostedHourPreparation } from "./hour-preparation.js";
import { createHourDormantPreparation, isHourDormantInput } from "./hour-dormant-standby.js";
import { hostedHourRecovery } from "./hosted-hour-recovery.js";
import { readHourRecoveryHistory, readHourRecoveryState } from "./hour-recovery-state.js";

function snapshot(input: unknown): unknown {
  try {
    if (
      typeof input === "object" &&
      input !== null &&
      Reflect.ownKeys(input).some(
        (key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(input, key),
      )
    )
      throw new Error();
    return structuredClone(input);
  } catch {
    throw new AppError("sif.allocation_invalid", { reason: "malformed_allocation" });
  }
}

function configured(host?: ModuleOperationHost): ModuleOperationPreparation {
  const requireHost = () => {
    if (host === undefined)
      throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
    return host;
  };
  return {
    readRecoveryHistory: readHourRecoveryHistory,
    readRecoveryState: readHourRecoveryState,
    async recovery(operation, proposal) {
      return hostedHourRecovery(requireHost()).recovery(operation, proposal);
    },
    async resumeRecovery(operation) {
      await hostedHourRecovery(requireHost()).resume(operation);
    },
    async prepare(supplied, run) {
      const operation = {
        ...supplied,
        binding: Object.freeze({ ...supplied.binding }),
        input: snapshot(supplied.input),
      };
      if (isHourDormantInput(operation.input))
        return createHourDormantPreparation(host).prepare(operation, run);
      if (operation.binding.action === "setup")
        return hostedHourPreparation(requireHost()).prepare(operation, run);
      if (
        host?.readRecoveryFacts !== undefined &&
        ["restore", "re-register", "promote"].includes(operation.binding.action)
      )
        return hostedHourRecovery(host).prepare(operation, run);
      throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
    },
  };
}

export const FISCAL_OPERATIONS: ModuleOperationPreparation = {
  readRecoveryHistory: readHourRecoveryHistory,
  readRecoveryState: readHourRecoveryState,
  configure: configured,
  prepare(operation, run) {
    return configured().prepare(operation, run);
  },
};

function unconfiguredSetup(): never {
  throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
}

export const FISCAL_INITIAL_SETUP: InitialSetupContribution = {
  ...historicalInitialSetup,
  candidates: unconfiguredSetup,
  request: unconfiguredSetup,
  inspect: unconfiguredSetup,
  enrol: unconfiguredSetup,
  confirmation: unconfiguredSetup,
  documentConfirmation: unconfiguredSetup,
  configure(host) {
    return createHourInitialSetup(host, historicalInitialSetup);
  },
};
