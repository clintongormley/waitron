import { stampDeployment } from "@waitron/db";
import "../src/errors.js";
import {
  applyVenue,
  throwawayApplyInput,
  type VenueAction,
  type VenueApplyDeps,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { deploymentEnvironment } from "../src/config.js";

export async function applyDevelopmentVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const deployment = deploymentEnvironment(environment);
  // The seat refuses this too, but only when a module offers one; this script stamps
  // preproduction either way.
  if (deployment !== "preproduction")
    throw new AppError("sif.throwaway_allocation_refused", { environment: deployment });
  const throwaway = throwawayApplyInput(actions, deps.modules, [deployment]);
  await stampDeployment(deps.db, "preproduction");
  return applyVenue(actions, { ...deps, ...throwaway });
}
