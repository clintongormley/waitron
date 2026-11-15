import { codeOf } from "@waitron/server-kit";
import type { SilentReason } from "./boot-peer-check.js";
import type { Logger } from "./logger.js";

export const MAIN_ASK_INTERVAL_MS = 5_000;
export const MAIN_SILENT_MS = 20_000;

export type MainAskResult = "answered" | SilentReason;

export type MainSilenceState =
  | {
      silent: false;
      silentSinceMs: number | null;
      /** Whether any ask has answered or found the main box's last checked address unreachable. */
      reached: boolean;
    }
  | { silent: true; silentSinceMs: number; reached: true };

export interface MainSilenceWatch {
  /** Builds nothing: the responder reads it for every query heard on the network. */
  state(): MainSilenceState;
  stop(): Promise<void>;
}

export interface MainSilenceWatchDeps {
  ask: () => Promise<MainAskResult>;
  now: () => number;
  intervalMs: number;
  silentAfterMs: number;
  /** A spare that has taken a copy already found the main box silent before its restart. */
  silentFromFirst: boolean;
  onChange: (silent: boolean) => void;
  log: Logger;
}

/**
 * Only `unreachable` counts towards silence: it is the one reason the switch's own check lets a
 * switch go on (`sourceSilent` in handover-emergency-api.ts).
 */
export function startMainSilenceWatch(deps: MainSilenceWatchDeps): MainSilenceWatch {
  let silentSinceMs: number | null = null;
  let reached = false;
  let state: MainSilenceState = { silent: false, silentSinceMs, reached };
  let fromFirst = deps.silentFromFirst;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const judge = (result: MainAskResult | undefined, startedAtMs: number) => {
    if (result === "unreachable") {
      reached = true;
      silentSinceMs ??= startedAtMs;
    } else {
      if (result === "answered") reached = true;
      silentSinceMs = null;
      fromFirst = false;
    }
    const was = state.silent;
    state =
      silentSinceMs !== null && (fromFirst || deps.now() - silentSinceMs >= deps.silentAfterMs)
        ? { silent: true, silentSinceMs, reached: true }
        : { silent: false, silentSinceMs, reached };
    if (state.silent === was) return;
    deps.log("info", state.silent ? "main_silence.silent" : "main_silence.answering", {});
    deps.onChange(state.silent);
  };

  const ask = async (): Promise<void> => {
    const startedAtMs = deps.now();
    let result: MainAskResult | undefined;
    try {
      result = await deps.ask();
    } catch (error) {
      deps.log("warn", "main_silence.ask_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    judge(result, startedAtMs);
    const waitMs = startedAtMs + deps.intervalMs - deps.now();
    // A timer waits at least 1 ms, so a main box slow to answer every ask would drift the cadence.
    if (waitMs <= 0) {
      inFlight = ask();
      return;
    }
    timer = setTimeout(() => {
      inFlight = ask();
    }, waitMs);
    timer.unref();
  };

  inFlight = ask();

  return {
    state: () => state,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
