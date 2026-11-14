import "./errors.js";
import type { ModuleRouteContext } from "@waitron/module";
import type { DeploymentMode, SingletonRole } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { TradingAdmission } from "./trading-admission.js";

type Generation = NonNullable<ModuleRouteContext["recordGeneration"]>;
export function moduleRecordGeneration(
  deps: Omit<Generation, "requireWritable" | "requireClockConfirmed"> & {
    mode(): DeploymentMode;
    role(): SingletonRole;
    fenced(): boolean;
    trading: TradingAdmission;
    clockUnconfirmed: () => boolean;
  },
): Generation {
  return {
    nodeId: deps.nodeId,
    environment: deps.environment,
    clock: deps.clock,
    returnSource: deps.returnSource,
    requireWritable() {
      if (deps.mode() !== "primary" || deps.role() !== "primary" || deps.fenced())
        throw new AppError("node.read_only", {});
      deps.trading.require();
    },
    requireClockConfirmed() {
      if (deps.clockUnconfirmed()) throw new AppError("clock.unconfirmed", {});
    },
  };
}
