import type { CurrentOrderKitchen, CurrentOrderRow, StationQueueItem } from "../src/api/client.js";

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

type CurrentKitchenStamps = Pick<CurrentOrderKitchen, "phase" | "requestedAt">;

/** A current order's kitchen fields with the request fields {@link kitchenStamps} gives its state
 *  and fire time, unless the fixture states its own. */
export function withCurrentKitchenStamps(
  kitchen: Omit<CurrentOrderKitchen, keyof CurrentKitchenStamps> & Partial<CurrentKitchenStamps>,
): CurrentOrderKitchen {
  const { phase, requestedAt } = kitchenStamps(kitchen);
  return { phase, requestedAt, ...kitchen };
}

/** A current order row whose request time follows its stamps unless the fixture states one: its
 *  fire time once released, null while held. */
export function withRowRequestedAt(
  row: Omit<CurrentOrderRow, "requestedAt"> & Partial<Pick<CurrentOrderRow, "requestedAt">>,
): CurrentOrderRow {
  const requestedAt =
    row.requestedAt === undefined ? (row.released ? row.firedAt : null) : row.requestedAt;
  return { ...row, requestedAt };
}
