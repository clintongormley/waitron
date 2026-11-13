import { randomUUID } from "node:crypto";
import type { DeploymentEnvironment } from "@waitron/db";
import type {
  ModuleClockSetAnswer,
  ModuleClockSetRequest,
  ModuleOperationHost,
  OperationBinding,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import {
  AGREEMENT_MS,
  canSelectHour,
  compareHourClocks,
  type HourClockDecision,
  type HourClockObservation,
} from "./hour-clock.js";
import { observeInternetHourClock } from "./hour-clock-internet.js";
import { readHourRelease } from "./hour-release.js";
import { chosenHourIssuedAtMs } from "./hour-selection.js";
import "./errors.js";

interface ClockDependencies {
  wall?: () => number;
  monotonic?: () => number;
  internet?: (environment: DeploymentEnvironment) => Promise<HourClockObservation>;
  release?: () => number | null;
}
export type { SetupBrowserClockSample } from "./hour-clock.js";
import type { SetupBrowserClockSample } from "./hour-clock.js";
interface Reading {
  readonly id: string;
  readonly observations: readonly HourClockObservation[];
  readonly wall: number;
  readonly monotonic: number;
}
export interface SetupClockClient {
  readonly onBox: boolean;
}
interface Session {
  readonly challenges: Map<string, { wall: number; monotonic: number }>;
  readonly readings: Map<string, Reading>;
}
export type SetupClockMeasurement =
  | {
      readonly status: "measured";
      readonly deviceMs: number;
      readonly request: ModuleClockSetRequest;
    }
  | { readonly status: "refused"; readonly reason: "same_machine" | "challenge" };
const PER_SESSION = 8;
function keep<T>(map: Map<string, T>, id: string, value: T) {
  if (map.size === PER_SESSION) map.delete(map.keys().next().value!);
  map.set(id, value);
}
function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
/** Asks the host to set the box's clock from a measured device, unless the device is earlier
 * than the hour already chosen for `binding`: the series step would then refuse
 * `minute_not_later` with the clock already set. */
export async function setBoxClockFrom(
  host: ModuleOperationHost,
  binding: OperationBinding,
  state: { readonly value: unknown; readonly history: unknown },
  measured: SetupClockMeasurement,
): Promise<ModuleClockSetAnswer> {
  if (measured.status === "refused") return measured;
  const chosenMs = chosenHourIssuedAtMs(state, binding);
  if (chosenMs !== undefined && measured.deviceMs < chosenMs)
    return { status: "refused", reason: "later" };
  if (host.setBoxClock === undefined) return { status: "refused", reason: "host_unavailable" };
  return host.setBoxClock({ ...binding }, structuredClone(measured.request));
}
export function createSetupHourClock(deps: ClockDependencies = {}) {
  const wall = deps.wall ?? Date.now;
  const monotonic = deps.monotonic ?? (() => performance.now());
  const internet = deps.internet ?? observeInternetHourClock;
  const release = deps.release ?? (() => readHourRelease()?.instantMs ?? null);
  const sessions = new Map<string, Session>();
  const session = (key: string) => {
    if (typeof key !== "string" || key.trim().length === 0 || key.length > 64 * 1024)
      return refuse("event_mismatch");
    let value = sessions.get(key);
    if (value === undefined) {
      // A bounded process-local cache grants nothing after eviction or restart.
      if (sessions.size === 64) sessions.delete(sessions.keys().next().value!);
      value = { challenges: new Map(), readings: new Map() };
      sessions.set(key, value);
    }
    return value;
  };
  const box = (): Extract<HourClockObservation, { result: "usable" }> => {
    const instantMs = wall();
    const measured = monotonic();
    return {
      source: "box",
      result: "usable",
      instantMs,
      uncertaintyMs: 0,
      wallStartedMs: instantMs,
      wallFinishedMs: instantMs,
      monotonicStartedMs: measured,
      monotonicFinishedMs: measured,
    };
  };
  const current = (held: Reading, sample: ReturnType<typeof box>) => {
    const elapsed = sample.monotonicFinishedMs - held.monotonic;
    if (elapsed < 0 || elapsed > 30_000 || !Number.isFinite(elapsed)) return refuse("clock_stale");
    if (Math.abs(sample.wallFinishedMs - held.wall - elapsed) > 1000)
      return refuse("clock_corrected");
    return compareHourClocks([...held.observations, sample], release());
  };
  const take = (state: Session, browser: SetupBrowserClockSample) => {
    const challenge =
      typeof browser.challengeId !== "string"
        ? undefined
        : state.challenges.get(browser.challengeId);
    if (challenge !== undefined) state.challenges.delete(browser.challengeId);
    const received = box();
    const elapsed =
      challenge === undefined ? NaN : received.monotonicFinishedMs - challenge.monotonic;
    const timed =
      challenge !== undefined &&
      Number.isSafeInteger(browser.instantMs) &&
      Number.isFinite(elapsed) &&
      elapsed >= 0 &&
      elapsed <= 5000 &&
      Math.abs(received.wallFinishedMs - challenge.wall - elapsed) <= 1000;
    return { challenge, received, elapsed, timed };
  };
  return {
    challenge(key: string) {
      const state = session(key);
      const id = randomUUID();
      const issued = { wall: wall(), monotonic: monotonic() };
      keep(state.challenges, id, issued);
      return { id, boxInstantMs: issued.wall, expiresInMs: 5000 };
    },
    setFromBrowser(
      key: string,
      browser: SetupBrowserClockSample,
      client: SetupClockClient,
    ): SetupClockMeasurement {
      const { received, elapsed, timed } = take(session(key), browser);
      if (client.onBox) return { status: "refused", reason: "same_machine" };
      if (!timed) return { status: "refused", reason: "challenge" };
      // The device read its clock at the round trip's midpoint, give or take half of it.
      const halfMs = elapsed / 2;
      const wallMs = received.wallFinishedMs - halfMs;
      return {
        status: "measured",
        deviceMs: browser.instantMs,
        request: {
          offsetMs: Math.round(browser.instantMs - wallMs),
          agreesWithinMs: AGREEMENT_MS,
          measuredAt: { wallMs, monoMs: received.monotonicFinishedMs - halfMs },
          reading: {
            boxAt: new Date(Math.round(wallMs)).toISOString(),
            witnessAt: new Date(browser.instantMs).toISOString(),
            uncertaintyMs: Math.ceil(halfMs),
          },
        },
      };
    },
    async compare(
      key: string,
      environment: DeploymentEnvironment,
      browser: SetupBrowserClockSample | null,
      client: SetupClockClient,
    ) {
      const state = session(key);
      const { challenge, received, elapsed, timed } =
        browser === null
          ? { challenge: undefined, received: box(), elapsed: NaN, timed: false }
          : take(state, browser);
      const observations: HourClockObservation[] = [];
      if (browser !== null && client.onBox)
        observations.push({ source: "browser", result: "unavailable", reason: "same_machine" });
      else if (browser !== null && challenge !== undefined && timed) {
        observations.push({
          source: "browser",
          result: "usable",
          instantMs: browser.instantMs,
          uncertaintyMs: elapsed / 2,
          wallStartedMs: challenge.wall,
          wallFinishedMs: received.wallFinishedMs,
          monotonicStartedMs: challenge.monotonic,
          monotonicFinishedMs: received.monotonicFinishedMs,
        });
      } else observations.push({ source: "browser", result: "unavailable", reason: "challenge" });
      observations.push(structuredClone(await internet(environment)));
      if (sessions.get(key) !== state) return refuse("clock_stale");
      const sample = box();
      const clock = compareHourClocks([...observations, sample], release());
      const reading: Reading = {
        id: randomUUID(),
        observations,
        wall: sample.wallFinishedMs,
        monotonic: sample.monotonicFinishedMs,
      };
      keep(state.readings, reading.id, reading);
      return { id: reading.id, clock };
    },
    /** With no `comparisonId`, the newest fresh reading that admits a name, else the newest's answer. */
    read(key: string, comparisonId?: string) {
      const state = session(key);
      const check = (id: string) => {
        const held = state.readings.get(id);
        if (held === undefined) return refuse("clock_stale");
        try {
          return current(held, box());
        } catch (error) {
          state.readings.delete(id);
          throw error;
        }
      };
      if (comparisonId !== undefined) return { clock: check(comparisonId) };
      const ids = [...state.readings.keys()].reverse();
      if (ids.length === 0) return refuse("clock_stale");
      let newest: { clock: HourClockDecision } | { error: unknown } | undefined;
      for (const id of ids) {
        let clock: HourClockDecision;
        try {
          clock = check(id);
        } catch (error) {
          newest ??= { error };
          continue;
        }
        if (canSelectHour(clock)) return { clock };
        newest ??= { clock };
      }
      if ("error" in newest!) throw newest.error;
      return { clock: newest!.clock };
    },
  };
}
