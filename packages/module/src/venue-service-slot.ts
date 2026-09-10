import { AppError } from "@waitron/shared";
import type { VenueServiceContribution, WaitronModule } from "./module.js";
import "./errors.js";

/** Select the venue-service implementation before boot mounts any order path. */
export function selectVenueService(modules: readonly WaitronModule[]): VenueServiceContribution {
  const candidates = modules.flatMap((module) =>
    module.venueService === undefined ? [] : [{ name: module.name, value: module.venueService }],
  );
  if (candidates.length === 0) throw new AppError("module.venue_service_empty", {});
  if (candidates.length > 1) {
    throw new AppError("module.venue_service_ambiguous", {
      candidates: candidates.map((candidate) => candidate.name),
    });
  }
  return candidates[0]!.value;
}
