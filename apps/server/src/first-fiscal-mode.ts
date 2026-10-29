import type { Database } from "@waitron/db";
import { readNodeLocation } from "./till-config.js";
import { AppError } from "@waitron/shared";
import type { FirstSetupStore } from "@waitron/provisioning";
import { assertOtherSetupAllowed } from "@waitron/provisioning";
import type { ServerConfig } from "./config.js";
import "./errors.js";

export async function reconcileFirstSetupBeforeMode(
  config: ServerConfig,
  store: FirstSetupStore,
  db: Database,
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
      config.till === undefined ||
      config.till.nodeId !== result.venue.nodeId ||
      (await readNodeLocation(db, config.till.nodeId)) !== result.venue.locationId
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
