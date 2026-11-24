import { randomUUID } from "node:crypto";
import {
  measureDeviceReading,
  type ModuleClockSetAnswer,
  type ModuleClockSetRequest,
  type ModuleOperationHost,
  type OperationBinding,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import {
  AGREEMENT_MS,
  boxClockSample,
  canSelectHour,
  STEP_MS,
  compareHourClocks,
  type HourClockDecision,
  type HourClockObservation,
} from "./hour-clock.js";
import { observeTimeServiceHourClock } from "./hour-clock-time-service.js";
import { readHourRelease } from "./hour-release.js";
import { chosenHourBoot, chosenHourIssuedAtMs, keptInstantMs } from "./hour-selection.js";
import "./errors.js";

interface ClockDependencies {
  wall?: () => number;
  monotonic?: () => number;
  timeService?: () => Promise<boolean>;
  release?: () => number | null;
}
export type { SetupBrowserClockSample } from "./hour-clock.js";
import type { SetupBrowserClockSample } from "./hour-clock.js";
interface Reading {
  readonly id: string;
  readonly observations: readonly HourClockObservation[];
  readonly wall: number;
  readonly monotonic: number;
  /** Whether the box's own clock counts as the second clock, as when the reading was taken. */
  readonly boxClockAlone: boolean;
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
export function selectionBoot(host: ModuleOperationHost) {
  const boot = host.readBoot?.();
  return boot === undefined || boot.id === null || !(Number.isFinite(boot.ms) && boot.ms >= 0)
    ? undefined
    : { bootId: boot.id, uptimeMs: boot.ms };
}
export function bootStanding(
  host: ModuleOperationHost,
  wall: () => number,
  monotonicNow: () => number,
) {
  /** A time kept with `kept`'s boot reading, still standing while the box ran on unstepped on
   * the same boot: `offsetMs` from the box's clock, give or take `uncertaintyMs`. */
  const standing = (
    kept: { bootId: string | null; uptimeMs: number; wallMs: number } | undefined,
    offsetMs: number,
    uncertaintyMs: number,
  ): HourClockObservation | undefined => {
    const boot = selectionBoot(host);
    const wallMs = wall();
    const instantMs = boot === undefined ? undefined : keptInstantMs(kept, boot, wallMs);
    if (instantMs === undefined) return undefined;
    const measured = monotonicNow();
    return {
      source: "browser",
      result: "usable",
      instantMs: instantMs + offsetMs,
      uncertaintyMs,
      wallStartedMs: wallMs,
      wallFinishedMs: wallMs,
      monotonicStartedMs: measured,
      monotonicFinishedMs: measured,
    };
  };
  return {
    standing,
    /** The time agreed when `binding`'s hour was chosen, while it stands; with `confirmedOnly`,
     * only a time the person confirmed. */
    chosen(
      state: Parameters<typeof chosenHourBoot>[0],
      binding: OperationBinding,
      confirmedOnly = false,
    ) {
      const kept = chosenHourBoot(state, binding);
      return confirmedOnly && kept?.confirmed !== true ? undefined : standing(kept, 0, 0);
    },
  };
}
export function createSetupHourClock(deps: ClockDependencies = {}) {
  const wall = deps.wall ?? Date.now;
  const monotonic = deps.monotonic ?? (() => performance.now());
  const timeService = deps.timeService ?? (async () => false);
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
  const box = () => boxClockSample(wall, monotonic);
  const current = (held: Reading, sample: ReturnType<typeof box>) => {
    const elapsed = sample.monotonicFinishedMs - held.monotonic;
    if (elapsed < 0 || elapsed > 30_000 || !Number.isFinite(elapsed)) return refuse("clock_stale");
    if (Math.abs(sample.wallFinishedMs - held.wall - elapsed) > STEP_MS)
      return refuse("clock_corrected");
    return compareHourClocks([...held.observations, sample], release(), {
      boxClockAlone: held.boxClockAlone,
    });
  };
  const take = (state: Session, browser: SetupBrowserClockSample, onBox: boolean) => {
    const challenge =
      typeof browser.challengeId !== "string"
        ? undefined
        : state.challenges.get(browser.challengeId);
    if (challenge !== undefined) state.challenges.delete(browser.challengeId);
    const received = box();
    return measureDeviceReading(
      challenge,
      browser.instantMs,
      { wall: received.wallFinishedMs, monotonic: received.monotonicFinishedMs },
      onBox,
    );
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
      const reading = take(session(key), browser, client.onBox);
      if (reading.result === "unavailable") return { status: "refused", reason: reading.reason };
      // The device read its clock at the round trip's midpoint, give or take half of it.
      const halfMs = reading.uncertaintyMs;
      const wallMs = reading.wallFinishedMs - halfMs;
      return {
        status: "measured",
        deviceMs: browser.instantMs,
        request: {
          offsetMs: Math.round(browser.instantMs - wallMs),
          agreesWithinMs: AGREEMENT_MS,
          measuredAt: { wallMs, monoMs: reading.monotonicFinishedMs - halfMs },
          reading: {
            boxAt: new Date(Math.round(wallMs)).toISOString(),
            witnessAt: new Date(browser.instantMs).toISOString(),
            uncertaintyMs: Math.ceil(halfMs),
          },
        },
      };
    },
    /** `carried` stands in for the browser when none was sent, asked only once the time service
     * has answered, so a step while it is read ends what it carries. */
    async compare(
      key: string,
      browser: SetupBrowserClockSample | null,
      client: SetupClockClient,
      carried?: () => HourClockObservation | undefined,
      admit: { boxClockAlone?: boolean } = {},
    ) {
      const state = session(key);
      const sent: HourClockObservation | undefined =
        browser === null ? undefined : { ...take(state, browser, client.onBox), source: "browser" };
      const internet = await observeTimeServiceHourClock(timeService, { wall, monotonic });
      if (sessions.get(key) !== state) return refuse("clock_stale");
      const observations: HourClockObservation[] = [
        sent ?? carried?.() ?? { source: "browser", result: "unavailable", reason: "challenge" },
        internet,
      ];
      const sample = box();
      const boxClockAlone = admit.boxClockAlone === true;
      const clock = compareHourClocks([...observations, sample], release(), { boxClockAlone });
      const reading: Reading = {
        id: randomUUID(),
        observations,
        wall: sample.wallFinishedMs,
        monotonic: sample.monotonicFinishedMs,
        boxClockAlone,
      };
      keep(state.readings, reading.id, reading);
      return { id: reading.id, clock };
    },
    /** Whether a reading taken in the last `withinMs` still admits a name. */
    admitsWithin(key: string, withinMs: number) {
      const sample = box();
      return [...session(key).readings.values()].some((held) => {
        if (!(sample.monotonicFinishedMs - held.monotonic <= withinMs)) return false;
        try {
          return canSelectHour(current(held, sample));
        } catch {
          return false;
        }
      });
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
