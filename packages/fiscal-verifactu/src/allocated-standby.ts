import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type StandbyProvisioning,
} from "@waitron/module";
import { activatePreparedFiscalStandby } from "./allocated-lifecycle.js";
import { reserveHourDormant, establishHourDormant } from "./hour-dormant-standby.js";

function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function refuseNonHourStandby(operation: ModuleOperationInput | undefined): never {
  if (
    operation === undefined ||
    readOperationAuthority(operation.authority, operation.binding) === undefined
  )
    return refuse("reauthentication_required");
  return refuse("outside_confirmation_missing");
}

export const ALLOCATED_FISCAL_STANDBY: StandbyProvisioning = {
  series: "on-activation",
  async reserve(tx, primary, standby, operation) {
    if (standby === undefined) return refuse("node_mismatch");
    const dormant = await reserveHourDormant(tx, primary, standby, operation);
    if (dormant !== undefined) return dormant;
    return refuseNonHourStandby(operation);
  },
  async establish(tx: Transaction, standby, state, operation) {
    if (await establishHourDormant(tx, standby, state, operation)) return;
    return refuseNonHourStandby(operation);
  },
  activate: activatePreparedFiscalStandby,
};
