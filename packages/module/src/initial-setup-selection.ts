import { AppError } from "@waitron/shared";
import type { WaitronModule } from "./module.js";
import type { InitialSetupContribution } from "./initial-setup.js";
import "./errors.js";

export function initialSetupFor(
  selected: readonly WaitronModule[],
  name: string,
): InitialSetupContribution | undefined {
  const module = selected.find((entry) => entry.name === name);
  if (module === undefined) throw new AppError("module.operation_invalid", { module: name });
  return module.provisioning?.initialSetup;
}
