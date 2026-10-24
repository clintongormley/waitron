import type { ReactiveControllerHost } from "lit";

export interface WaitCountdown {
  start(remainingMs: number): void;
  stop(): void;
  readonly remainingMs: number | undefined;
}

export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Counts the server's time left down on this page's own timer; the server decides at zero. */
export function createWaitCountdown(
  host: ReactiveControllerHost,
  onZero: () => void,
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
    start(duration) {
      stop();
      const started = performance.now();
      remainingMs = Math.max(0, duration);
      host.requestUpdate();
      timer = setInterval(() => {
        const shown = formatRemaining(remainingMs!);
        remainingMs = Math.max(0, duration - Math.max(0, performance.now() - started));
        if (formatRemaining(remainingMs) !== shown) host.requestUpdate();
        if (remainingMs === 0) {
          clearInterval(timer);
          timer = undefined;
          onZero();
        }
      }, 250);
    },
  };
}
