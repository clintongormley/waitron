import { stampDeployment } from "@waitron/db";
import {
  applyVenue,
  throwawayApplyInput,
  type VenueAction,
  type VenueApplyDeps,
} from "@waitron/provisioning";
import { deploymentEnvironment } from "../src/config.js";

export async function applyDevelopmentVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const throwaway = throwawayApplyInput(actions, deps.modules, [
    deploymentEnvironment(environment),
  ]);
  await stampDeployment(deps.db, "preproduction");
  return applyVenue(actions, { ...deps, ...throwaway });
}
