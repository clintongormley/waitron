import { AppError } from "@waitron/shared";
import type { FirstSetupStore } from "@waitron/provisioning";
import { assertOtherSetupAllowed } from "@waitron/provisioning";
import type { ServerConfig } from "./config.js";
import "./errors.js";

export async function reconcileFirstSetupBeforeMode(
  config: ServerConfig,
  store: FirstSetupStore,
): Promise<void> {
  const pair = await store.readResumable();
  if (pair === null) return;
  if (pair.publicationComplete) {
    const result = pair.state.result;
    if (
      typeof result !== "object" ||
      result === null ||
      !("venue" in result) ||
      typeof result.venue !== "object" ||
      result.venue === null ||
      !("nodeId" in result.venue) ||
      !("locationId" in result.venue) ||
      config.till?.nodeId !== result.venue.nodeId ||
      config.till?.locationId !== result.venue.locationId
    )
      throw new AppError("setup.attempt_uncertain", {});
    return;
  }
  if (["activation-started", "committed", "publication", "complete"].includes(pair.state.status)) {
    config.till = undefined;
    return;
  }
  if (config.till !== undefined) assertOtherSetupAllowed(pair.state);
}
