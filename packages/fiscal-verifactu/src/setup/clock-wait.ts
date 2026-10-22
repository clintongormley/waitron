import { html, nothing, type ReactiveControllerHost } from "lit";
import type { HourClockDecision } from "../hour-clock.js";
import { formatRemaining, type WaitCountdown } from "./wait-countdown.js";

/** What a page explains instead of a name: design §6.5, "Every wait explains itself". */
export type ClockProblem =
  { kind: "second-clock" } | { kind: "disagreement" } | { kind: "later"; allowedFromMs?: number };

export interface ClockWords {
  whyWait: string;
  nothingToDo: string;
  continuesIn: string;
  whySecondClock: string;
  onBox: string;
  secondClockDo: string;
  secondClockEnds: string;
  whyRefused: string;
  differ: string;
  differDo: string;
  later: string;
  laterFrom: (time: string) => string;
}

export const SECOND_CLOCK_POLL_MS = 15_000;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validWait(result: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(result.targetMs) &&
    (result.remainingMs === null ||
      (typeof result.remainingMs === "number" &&
        Number.isFinite(result.remainingMs) &&
        result.remainingMs >= 0))
  );
}

/** The explanation a refusal from the box carries; undefined for any other error. */
export function clockProblem(error: unknown): ClockProblem | undefined {
  if (!record(error) || error.code !== "sif.allocation_invalid" || !record(error.params))
    return undefined;
  const { reason, allowedFromMs } = error.params;
  if (reason === "second_clock_missing") return { kind: "second-clock" };
  if (reason === "clock_disagreement") return { kind: "disagreement" };
  if (reason === "minute_not_later")
    return {
      kind: "later",
      ...(Number.isSafeInteger(allowedFromMs) ? { allowedFromMs: allowedFromMs as number } : {}),
    };
  return undefined;
}

/**
 * Shows what a failed request means. While the page checks for a second clock by itself
 * (`retryingQuietly`), a request lost on the way (no refusal code) is left to the next check;
 * a refusal is never retried.
 */
export function settleRefusal(
  error: unknown,
  retryingQuietly: boolean,
  page: {
    waitForSecondClock(): void;
    show(problem: ClockProblem | undefined): void;
    fail(error: unknown): void;
  },
): void {
  const problem = clockProblem(error);
  if (problem?.kind === "second-clock") page.waitForSecondClock();
  else if (problem) page.show(problem);
  else if (!(retryingQuietly && (error as { code?: unknown } | null)?.code === undefined)) {
    page.show(undefined);
    page.fail(error);
  }
}

/** Checks again every 15 seconds; starting it again while it runs keeps its rhythm. */
export function createSecondClockPoll(host: ReactiveControllerHost, run: () => void) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  host.addController({ hostDisconnected: stop });
  return {
    get running() {
      return timer !== undefined;
    },
    start() {
      timer ??= setInterval(run, SECOND_CLOCK_POLL_MS);
    },
    stop,
  };
}

export function renderClockProblem(
  problem: ClockProblem | undefined,
  words: ClockWords,
  clock: HourClockDecision | undefined,
  locale: "en" | "es",
  timeZone: string,
) {
  if (problem?.kind === "second-clock")
    return html`<section data-test="clock-wait">
      <p role="status">${words.whySecondClock}</p>
      ${
        clock?.unavailable.some((r) => r.source === "browser" && r.reason === "same_machine")
          ? html`<p>${words.onBox}</p>`
          : nothing
      }
      <p>${words.secondClockDo}</p>
      <p>${words.secondClockEnds}</p>
    </section>`;
  if (problem?.kind === "disagreement")
    return html`<section data-test="clock-refused">
      <p role="status">${words.whyRefused}</p>
      <p>${words.differ}</p>
      <p>${words.differDo}</p>
    </section>`;
  if (problem?.kind === "later") {
    const time =
      problem.allowedFromMs === undefined
        ? undefined
        : new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "es-ES", {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone,
          }).format(problem.allowedFromMs);
    return html`<p role="status" data-test="minute-not-later">
      ${words.later}${time === undefined ? nothing : html` ${words.laterFrom(time)}`}
    </p>`;
  }
  return nothing;
}

export function renderWait(words: ClockWords, countdown: WaitCountdown) {
  return html`<section data-test="hour-wait">
    <p role="status">${words.whyWait}</p>
    <p>${words.nothingToDo}</p>
    ${
      countdown.remainingMs === undefined
        ? nothing
        : html`<p>
            ${words.continuesIn}
            <span role="timer" data-test="remaining"
              >${formatRemaining(countdown.remainingMs)}</span
            >
          </p>`
    }
  </section>`;
}
