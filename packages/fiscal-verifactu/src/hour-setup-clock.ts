import { randomUUID } from "node:crypto";
import type { DeploymentEnvironment } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { compareHourClocks, confirmHourClock, type HourClockObservation } from "./hour-clock.js";
import { observeInternetHourClock } from "./hour-clock-internet.js";
import { readHourRelease } from "./hour-release.js";
import "./errors.js";

interface ClockDependencies {
  wall?: () => number;
  monotonic?: () => number;
  internet?: (environment: DeploymentEnvironment) => Promise<HourClockObservation>;
  release?: () => number | null;
}
export interface SetupBrowserClockSample {
  readonly challengeId: string;
  readonly instantMs: number;
}
interface Reading {
  readonly id: string;
  readonly observations: readonly HourClockObservation[];
  readonly wall: number;
  readonly monotonic: number;
}
interface Session {
  challenge?: { id: string; wall: number; monotonic: number };
  comparison?: object;
  reading?: Reading;
}
function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
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
      value = {};
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
  return {
    challenge(key: string) {
      const state = session(key);
      state.challenge = { id: randomUUID(), wall: wall(), monotonic: monotonic() };
      state.comparison = undefined;
      state.reading = undefined;
      return { id: state.challenge.id, boxInstantMs: state.challenge.wall, expiresInMs: 5000 };
    },
    async compare(
      key: string,
      environment: DeploymentEnvironment,
      browser: SetupBrowserClockSample | null,
    ) {
      const state = session(key);
      const challenge = state.challenge;
      if (challenge !== undefined && browser?.challengeId === challenge.id)
        state.challenge = undefined;
      state.reading = undefined;
      const comparison = {};
      state.comparison = comparison;
      const received = box();
      const elapsed =
        challenge === undefined ? NaN : received.monotonicFinishedMs - challenge.monotonic;
      const observations: HourClockObservation[] = [];
      if (
        browser !== null &&
        challenge !== undefined &&
        browser.challengeId === challenge.id &&
        Number.isSafeInteger(browser.instantMs) &&
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed <= 5000 &&
        Math.abs(received.wallFinishedMs - challenge.wall - elapsed) <= 1000
      ) {
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
      if (sessions.get(key) !== state || state.comparison !== comparison)
        return refuse("clock_stale");
      const sample = box();
      const clock = compareHourClocks([...observations, sample], release());
      const reading: Reading = {
        id: randomUUID(),
        observations,
        wall: sample.wallFinishedMs,
        monotonic: sample.monotonicFinishedMs,
      };
      state.reading = reading;
      return { id: reading.id, clock };
    },
    read(key: string, confirmationId?: string) {
      const state = session(key);
      if (state.reading === undefined) return refuse("clock_stale");
      let clock: ReturnType<typeof compareHourClocks>;
      try {
        clock = current(state.reading, box());
      } catch (error) {
        state.reading = undefined;
        throw error;
      }
      if (confirmationId !== undefined && confirmationId !== state.reading.id)
        return refuse("clock_confirmation_required");
      return {
        clock,
        ...(confirmationId === undefined ? {} : { confirmation: confirmHourClock(clock) }),
      };
    },
  };
}
