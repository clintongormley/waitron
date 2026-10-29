import type { Database } from "@waitron/db";
import { readNodeLocation } from "./node-config.js";
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
      config.node === undefined ||
      config.node.nodeId !== result.venue.nodeId ||
      (await readNodeLocation(db, config.node.nodeId)) !== result.venue.locationId
    )
      throw new AppError("setup.attempt_uncertain", {});
    return;
  }
  if (["activation-started", "committed", "publication", "complete"].includes(pair.state.status)) {
    config.node = undefined;
    return;
  }
  if (config.node !== undefined) assertOtherSetupAllowed(pair.state);
}
