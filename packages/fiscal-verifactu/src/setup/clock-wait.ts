import { html, nothing, type ReactiveControllerHost } from "lit";
import type { HourClockDecision } from "../hour-clock.js";
import "@waitron/ui/src/components/wt-button.js";
import { createWaitCountdown, formatRemaining, type WaitCountdown } from "./wait-countdown.js";
import { detailRow } from "./check-venue.js";

/** What a page explains instead of a name: design §6.5, "Every wait explains itself". */
export type ClockProblem =
  | { kind: "second-clock" }
  | { kind: "disagreement" }
  | { kind: "later" | "in-use" }
  | { kind: "next-minute"; remainingMs: number; recheckInMs: number };

export interface ClockWords {
  whyWait: string;
  nothingToDo: string;
  continuesIn: string;
  whySecondClock: string;
  onBox: string;
  secondClockDo: string;
  secondClockEnds: string;
  whichCorrect: string;
  theServer: string;
  bothWrong: string;
  correctDevice: string;
  serverTime: string;
  thisDevice: string;
  internetTime: string;
  unavailable: string;
  later: string;
  inUse: string;
  minuteTaken: string;
  newCodeIn: string;
}

type ClockRowWords = Pick<ClockWords, "serverTime" | "thisDevice" | "internetTime" | "unavailable">;

export interface ClockComparison {
  id: string;
  clock: HourClockDecision;
}

export interface ClockWaitAnswer {
  status: "waiting";
  targetMs: number;
  remainingMs: number;
}

/** The wait words both setup pages share; each page adds the three that name its own devices. */
export const clockWaitStrings = {
  en: {
    whyWait: "Waiting to confirm the time, so no invoice series is ever repeated.",
    nothingToDo: "Nothing to do; keep this page open.",
    continuesIn: "Continues in",
    whySecondClock:
      "So no invoice series is ever repeated, the box's time is compared with another device's or the internet's.",
    onBox: "This screen is on the box itself, so it does not count.",
    whichCorrect:
      "It is very important that the server time is set correctly. Which time is correct:",
    theServer: "The server",
    bothWrong: "Both times are wrong",
    correctDevice: "Please correct the time on this device and then reconnect to the server.",
    serverTime: "Server time",
    thisDevice: "This device",
    internetTime: "Internet",
    unavailable: "Unavailable",
    later:
      "The invoice series cannot be created yet: this box's clock is earlier than a time it has already used for invoice series.",
    inUse: "The invoice series cannot be created. This is a fault in Waitron.",
    minuteTaken:
      "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.",
    newCodeIn: "New invoice series in",
  },
  es: {
    whyWait: "Esperamos a confirmar la hora para que ninguna serie de facturas se repita.",
    nothingToDo: "No hace falta hacer nada; deja esta página abierta.",
    continuesIn: "Sigue en",
    whySecondClock:
      "Para que ninguna serie de facturas se repita, la hora del servidor se compara con la de otro aparato o con internet.",
    onBox: "Esta pantalla está en el propio servidor y no cuenta.",
    whichCorrect: "Es muy importante que la hora del servidor sea correcta. ¿Cuál es la correcta?",
    theServer: "El servidor",
    bothWrong: "Las dos horas están mal",
    correctDevice: "Corrige la hora de este dispositivo y vuelve a conectarte al servidor.",
    serverTime: "Hora del servidor",
    thisDevice: "Este dispositivo",
    internetTime: "Internet",
    unavailable: "No disponible",
    later:
      "Todavía no se pueden crear las series de facturas: la hora de este servidor es anterior a una hora que ya usó para series de facturas.",
    inUse: "No se pueden crear las series de facturas. Es un fallo de Waitron.",
    minuteTaken:
      "Este código de serie de facturas ya se ha usado. Waitron creará otro por sí solo cuando termine la cuenta atrás.",
    newCodeIn: "Nueva serie de facturas en",
  },
} satisfies Record<"en" | "es", Omit<ClockWords, "secondClockDo" | "secondClockEnds">>;

const formats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per language, zone and style, rather than one per redraw of a counting page. */
export function dateTimeFormat(
  locale: "en" | "es",
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = JSON.stringify([locale, timeZone, options]);
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "es-ES", { ...options, timeZone });
    formats.set(key, format);
  }
  return format;
}

/** "02:30": the taken-minute wait's figure, `formatRemaining` with two-digit minutes. */
export function remainingAsClock(ms: number): string {
  return formatRemaining(ms).padStart(5, "0");
}

export const RECHECK_POLL_MS = 15_000;

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A whole millisecond a `Date` can hold. */
const instantMs = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Math.abs(value as number) <= 8_640_000_000_000_000;

const countable = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function validWait(result: Record<string, unknown>): boolean {
  return (
    instantMs(result.targetMs) &&
    typeof result.remainingMs === "number" &&
    Number.isFinite(result.remainingMs) &&
    result.remainingMs >= 0
  );
}

/** The explanation a refusal from the box carries; undefined for any other error. */
export function clockProblem(error: unknown): ClockProblem | undefined {
  if (!record(error) || error.code !== "sif.allocation_invalid" || !record(error.params))
    return undefined;
  const { reason, remainingMs, recheckInMs } = error.params;
  if (reason === "second_clock_missing") return { kind: "second-clock" };
  if (reason === "clock_disagreement") return { kind: "disagreement" };
  if (reason === "minute_not_later") return { kind: "later" };
  if (reason !== "minute_in_use") return undefined;
  return countable(recheckInMs) && countable(remainingMs) && recheckInMs <= remainingMs
    ? { kind: "next-minute", remainingMs, recheckInMs }
    : // A fault in Waitron: a stored pick found taken, or a wait whose times cannot be read.
      { kind: "in-use" };
}

/** Asks the box for a clock challenge, then for its comparison with this browser's time. */
export async function readClocks(
  send: (proposal: unknown) => Promise<unknown>,
): Promise<ClockComparison> {
  const challenge = await send({ action: "clock-challenge" });
  if (!record(challenge) || typeof challenge.id !== "string") throw new Error("invalid challenge");
  const compared = await send({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  if (
    !record(compared) ||
    typeof compared.id !== "string" ||
    !record(compared.clock) ||
    !Array.isArray(compared.clock.usable) ||
    !Array.isArray(compared.clock.unavailable)
  )
    throw new Error("invalid comparison");
  return compared as unknown as ClockComparison;
}

/** Checks again every 15 seconds; starting it again while it runs keeps its rhythm. */
function createRecheckPoll(host: ReactiveControllerHost, run: () => void) {
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
      timer ??= setInterval(run, RECHECK_POLL_MS);
    },
    stop,
  };
}

/**
 * What a setup page explains about the clocks — a problem, the server's answer, or neither — and
 * the two timers that run `recheck` by themselves.
 */
export class ClockWait<Selected extends { status: "selected" }> {
  readonly #host: ReactiveControllerHost;
  readonly #countdown: WaitCountdown;
  readonly #poll: ReturnType<typeof createRecheckPoll>;
  #problem: ClockProblem | undefined;
  #result: Selected | ClockWaitAnswer | undefined;
  /** Reached this wait through a taken minute: kept by the box's wait that follows. */
  #minuteTaken = false;
  /** The person answered which clock is correct, for the disagreement on screen. */
  #answered = false;

  constructor(host: ReactiveControllerHost, recheck: () => void) {
    this.#host = host;
    this.#countdown = createWaitCountdown(host, recheck);
    this.#poll = createRecheckPoll(host, recheck);
  }

  get problem(): ClockProblem | undefined {
    return this.#problem;
  }

  get result(): Selected | ClockWaitAnswer | undefined {
    return this.#result;
  }

  /** Counting down, to the box's wait or through a taken minute. */
  get counting(): boolean {
    return this.#result?.status === "waiting" || this.#problem?.kind === "next-minute";
  }

  /** Counting down or waiting for a second clock. */
  get waiting(): boolean {
    return this.counting || this.#problem?.kind === "second-clock";
  }

  /** Replaces what the page explains: a problem, a server answer, or neither. */
  show(problem?: ClockProblem, result?: Selected | ClockWaitAnswer): void {
    this.#countdown.stop();
    this.#poll.stop();
    this.#minuteTaken =
      problem?.kind === "next-minute" ||
      (this.#minuteTaken && problem === undefined && result?.status === "waiting");
    this.#problem = problem;
    this.#result = result;
    this.#answered = false;
    this.#host.requestUpdate();
    if (problem?.kind === "next-minute")
      this.#countdown.start(problem.remainingMs, problem.recheckInMs);
    else if (result?.status === "waiting") this.#countdown.start(result.remainingMs);
  }

  waitForSecondClock(): void {
    this.#result = undefined;
    this.#minuteTaken = false;
    this.#countdown.stop();
    this.#problem = { kind: "second-clock" };
    this.#poll.start();
    this.#host.requestUpdate();
  }

  /** Shows a wait the box has already recorded; any other preview changes nothing. */
  showPreview(preview: unknown): void {
    if (
      record(preview) &&
      preview.status === "waiting" &&
      validWait(preview) &&
      (preview.remainingMs as number) > 0
    )
      this.show(undefined, preview as unknown as ClockWaitAnswer);
  }

  /**
   * Shows what a failed request means. A check the page made by itself (`automatic`) that ends in
   * a `TypeError` with no code — what a request throws when it or its answer is lost on the
   * network, though any other `TypeError` with no code takes the same path — leaves a countdown or
   * second-clock wait up and starts the 15-second re-check; the next `show` stops it.
   */
  settle(error: unknown, automatic: boolean, fail: (error: unknown) => void): void {
    const problem = clockProblem(error);
    if (problem?.kind === "second-clock") this.waitForSecondClock();
    else if (problem) this.show(problem);
    else if (
      automatic &&
      (this.#poll.running || this.counting) &&
      error instanceof TypeError &&
      (error as { code?: unknown }).code === undefined
    )
      this.#poll.start();
    else {
      this.show();
      fail(error);
    }
  }

  renderWait(words: ClockWords) {
    return renderWait(words, this.#countdown, this.#minuteTaken);
  }

  renderProblem(
    words: ClockWords,
    clock: HourClockDecision | undefined,
    locale: "en" | "es",
    timeZone: string,
  ) {
    return renderClockProblem(
      this.#problem,
      words,
      clock,
      {
        answered: this.#answered,
        answer: () => {
          this.#answered = true;
          this.#host.requestUpdate();
        },
      },
      { locale, timeZone },
    );
  }
}

/** A page may leave a sentence empty, as the setup page does with `secondClockEnds` before Proceed. */
const sentence = (words: string) => (words ? html`<p>${words}</p>` : nothing);

export function renderClockProblem(
  problem: ClockProblem | undefined,
  words: ClockWords,
  clock: HourClockDecision | undefined,
  choice: { answered: boolean; answer: () => void },
  place?: { locale: "en" | "es"; timeZone: string },
) {
  if (problem?.kind === "second-clock")
    return html`<section data-test="clock-wait">
      <p role="status">${words.whySecondClock}</p>
      ${
        clock?.unavailable.some((r) => r.source === "browser" && r.reason === "same_machine")
          ? html`<p>${words.onBox}</p>`
          : nothing
      }
      ${sentence(words.secondClockDo)} ${sentence(words.secondClockEnds)}
    </section>`;
  if (problem?.kind === "disagreement")
    return html`<section data-test="clock-refused">
      ${
        choice.answered
          ? html`<p role="status" data-test="correct-device">${words.correctDevice}</p>`
          : html`<p role="status" id="which-correct">${words.whichCorrect}</p>`
      }
      ${
        clock && place
          ? html`<dl class="details" data-test="clock-times">
              ${renderClockRows(clock, words, place.locale, place.timeZone)}
            </dl>`
          : nothing
      }
      ${
        choice.answered
          ? nothing
          : html`<div class="choices" role="group" aria-labelledby="which-correct">
              ${(
                [
                  ["server-correct", words.theServer],
                  ["both-wrong", words.bothWrong],
                ] as const
              ).map(
                ([test, label]) =>
                  html`<wt-button
                    data-test=${test}
                    variant="secondary"
                    @click=${() => choice.answer()}
                    >${label}</wt-button
                  >`,
              )}
            </div>`
      }
    </section>`;
  if (problem?.kind === "later" || problem?.kind === "in-use")
    return html`<p
      role="status"
      data-test=${problem.kind === "later" ? "minute-not-later" : "minute-in-use"}
    >
      ${problem.kind === "later" ? words.later : words.inUse}
    </p>`;
  return nothing;
}

const middle = (reading: { lowerMs: number; upperMs: number }) =>
  (reading.lowerMs + reading.upperMs) / 2;

/**
 * The clock step's rows: the server's time, this device's, and the internet's when it was read. The
 * box refuses clocks more than 30 seconds apart, so when another clock reads the server's minute the
 * rows show seconds too.
 */
export function renderClockRows(
  clock: HourClockDecision,
  words: ClockRowWords,
  locale: "en" | "es",
  timeZone: string,
) {
  const minutes = dateTimeFormat(locale, timeZone, { dateStyle: "long", timeStyle: "short" });
  const box = clock.usable.find((r) => r.source === "box");
  const boxMinute = box && minutes.format(middle(box));
  const format = clock.usable.some((r) => r !== box && minutes.format(middle(r)) === boxMinute)
    ? dateTimeFormat(locale, timeZone, { dateStyle: "long", timeStyle: "medium" })
    : minutes;
  const at = (source: HourClockDecision["usable"][number]["source"]) => {
    const reading = clock.usable.find((r) => r.source === source);
    return reading ? format.format(middle(reading)) : words.unavailable;
  };
  return html`${detailRow(words.serverTime, at("box"))}${detailRow(words.thisDevice, at("browser"))}${
    clock.usable.some((r) => r.source === "internet")
      ? detailRow(words.internetTime, at("internet"))
      : nothing
  }`;
}

function renderWait(words: ClockWords, countdown: WaitCountdown, minuteTaken: boolean) {
  return html`<section data-test="hour-wait">
    ${
      minuteTaken
        ? html`<p role="status" data-test="minute-taken">${words.minuteTaken}</p>`
        : html`<p role="status">${words.whyWait}</p>`
    }
    <p>${words.nothingToDo}</p>
    ${
      countdown.remainingMs === undefined
        ? nothing
        : html`<p>
            ${minuteTaken ? words.newCodeIn : words.continuesIn}
            <span role="timer" data-test="remaining"
              >${
                minuteTaken
                  ? remainingAsClock(countdown.remainingMs)
                  : formatRemaining(countdown.remainingMs)
              }</span
            >
          </p>`
    }
  </section>`;
}
