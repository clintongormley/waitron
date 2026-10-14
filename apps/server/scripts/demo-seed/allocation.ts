import { getCountryPack } from "@waitron/country-packs";
import type { VenueAction, VenueApplyDeps } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { applyDevelopmentVenue } from "../throwaway-venue.js";
import { demoSeedEnvironment } from "./seed-sales.js";

export async function applyDeveloperDemoVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  environment: NodeJS.ProcessEnv = process.env,
) {
  demoSeedEnvironment(environment);
  const taxpayer = actions.find((action) => action.kind === "ensure-tenant");
  const demo = getCountryPack("ES")!.demo!;
  if (
    taxpayer?.country !== "ES" ||
    taxpayer.taxId !== demo.taxId ||
    taxpayer.legalName !== demo.legalName
  )
    throw new AppError("deployment.demo_data_refused", { environment: "preproduction" });
  return applyDevelopmentVenue(actions, deps, environment);
}
