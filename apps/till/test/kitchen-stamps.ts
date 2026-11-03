import type { StationQueueItem } from "../src/api/client.js";

type KitchenStamps = Pick<StationQueueItem, "phase" | "requestedAt" | "readyAt" | "passControlled">;

/** The kitchen request fields of an item that never waited for the pass, read from its state and
 *  fire time: held while `firedAt` is null, otherwise requested and (when ready) ready at it. */
export function kitchenStamps(item: Pick<StationQueueItem, "state" | "firedAt">): KitchenStamps {
  if (item.firedAt === null) {
    return { phase: "held", requestedAt: null, readyAt: null, passControlled: false };
  }
  return {
    phase: item.state === "queued" ? "waiting" : item.state,
    requestedAt: item.firedAt,
    readyAt: item.state === "ready" ? item.firedAt : null,
    passControlled: false,
  };
}

/** Fills the kitchen request fields an item fixture leaves out from {@link kitchenStamps}. */
export function withKitchenStamps(
  item: Omit<StationQueueItem, keyof KitchenStamps> & Partial<KitchenStamps>,
): StationQueueItem {
  return { ...kitchenStamps(item), ...item };
}
