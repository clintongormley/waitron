const queues = new WeakMap<object, Map<string, Promise<void>>>();

/**
 * Runs `attempt` once every earlier attempt on `throttle` under `key` has settled. An attempt checks
 * its secret before its transaction and the throttle counts the outcome inside it, so without turns
 * attempts sent at once would each derive a key before any outcome was counted. Never call this
 * inside a transaction: waiting here while holding the write lock would stall the attempt ahead,
 * which is waiting for that lock.
 */
export async function inTurn<T>(
  throttle: object,
  key: string,
  attempt: () => Promise<T>,
): Promise<T> {
  let queue = queues.get(throttle);
  if (queue === undefined) {
    queue = new Map();
    queues.set(throttle, queue);
  }
  const ahead = queue.get(key);
  let settled!: () => void;
  const mine = new Promise<void>((resolve) => {
    settled = resolve;
  });
  queue.set(key, mine);
  try {
    await ahead;
    return await attempt();
  } finally {
    settled();
    if (queue.get(key) === mine) queue.delete(key);
  }
}

/** How many keys have an attempt running or waiting on `throttle`. */
export function keysInTurn(throttle: object): number {
  return queues.get(throttle)?.size ?? 0;
}
