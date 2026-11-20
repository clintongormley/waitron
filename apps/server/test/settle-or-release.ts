import { closeSync, constants, openSync } from "node:fs";

export async function settleOrRelease<T>(
  promise: Promise<T>,
  fifo: string,
  ms: number,
): Promise<{ settled: boolean } & ({ value: T } | { error: unknown })> {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  let done = false;
  void outcome.then(() => (done = true));
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([outcome, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
  const settled = done;
  const giveUp = Date.now() + ms;
  while (!done && Date.now() < giveUp) {
    // Opening a writer lets a blocked open return, so the test worker does not hang.
    try {
      closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENXIO") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!done)
    return { settled, error: new Error(`still unsettled ${ms} ms after the first release`) };
  return { settled, ...(await outcome) };
}
