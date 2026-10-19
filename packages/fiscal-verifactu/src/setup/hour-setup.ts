import "../errors.js";
import { AppError } from "@waitron/shared";
import type { SetupContribution } from "@waitron/module/src/setup-contract.js";
import { FISCAL_SETUP as components } from "./first-fiscal-screen.js";

export const FISCAL_SETUP: SetupContribution = {
  ...components,
  create(context) {
    const preparation = context.api.preparation;
    if (typeof preparation !== "function")
      throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
    return components.create(context);
  },
};
