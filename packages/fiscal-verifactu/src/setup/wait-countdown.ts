import type { ReactiveControllerHost } from "lit";

export interface WaitCountdown {
  /** Counts `remainingMs` down to zero; checks once when `checkAfterMs` (default: all of it) has passed. */
  start(remainingMs: number, checkAfterMs?: number): void;
  stop(): void;
  readonly remainingMs: number | undefined;
}

export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Counts the server's time left down on this page's own timer; the server decides at each check. */
export function createWaitCountdown(
  host: ReactiveControllerHost,
  onCheck: () => void,
): WaitCountdown {
  let timer: ReturnType<typeof setInterval> | undefined;
  let remainingMs: number | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    remainingMs = undefined;
    host.requestUpdate();
  };
  host.addController({ hostDisconnected: stop });
  return {
    get remainingMs() {
      return remainingMs;
    },
    stop,
    start(duration, checkAfter = duration) {
      stop();
      const started = performance.now();
      let checked = false;
      remainingMs = Math.max(0, duration);
      host.requestUpdate();
      timer = setInterval(() => {
        const shown = formatRemaining(remainingMs!);
        const elapsed = Math.max(0, performance.now() - started);
        remainingMs = Math.max(0, duration - elapsed);
        if (formatRemaining(remainingMs) !== shown) host.requestUpdate();
        if (remainingMs === 0) {
          clearInterval(timer);
          timer = undefined;
        }
        if (!checked && elapsed >= checkAfter) {
          checked = true;
          onCheck();
        }
      }, 250);
    },
  };
}
