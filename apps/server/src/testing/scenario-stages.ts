import { setTimeout as delay } from "node:timers/promises";

export interface StageEvent<Phase extends string> {
  phase: Phase;
  outcome: "ok" | "failed" | "skipped";
  elapsedMs: number;
}

/** One event per stage: a stage ends when the next begins, or when `end` names its outcome. */
export function stageClock<Phase extends string>(
  record: ((event: StageEvent<Phase>) => void) | undefined,
  signal: AbortSignal | undefined,
) {
  let current: { phase: Phase; started: number } | undefined;
  const end = (outcome: StageEvent<Phase>["outcome"]): void => {
    if (current === undefined) return;
    const { phase, started } = current;
    current = undefined;
    record?.({ phase, outcome, elapsedMs: performance.now() - started });
  };
  return {
    begin(phase: Phase): void {
      end("ok");
      signal?.throwIfAborted();
      current = { phase, started: performance.now() };
    },
    end,
  };
}

/** Probes every `pollMs` until `probe` answers a value, checking the deadline between probes. */
export async function waitUntil<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>,
  signal: AbortSignal | undefined,
  pollMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await delay(pollMs, undefined, signal === undefined ? {} : { signal });
  }
}
