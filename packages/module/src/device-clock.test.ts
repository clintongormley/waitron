import { expect, it } from "vitest";
import { AGREEMENT_MS, measureDeviceReading } from "./index.js";

const issued = { wall: 1_000_000, monotonic: 500 };

it("agrees within thirty seconds", () => {
  expect(AGREEMENT_MS).toBe(30_000);
});

it("measures a device's time against the challenge it answers", () => {
  expect(
    measureDeviceReading(issued, 1_000_900, { wall: 1_001_200, monotonic: 1700 }, false),
  ).toEqual({
    result: "usable",
    instantMs: 1_000_900,
    uncertaintyMs: 600,
    wallStartedMs: 1_000_000,
    wallFinishedMs: 1_001_200,
    monotonicStartedMs: 500,
    monotonicFinishedMs: 1700,
  });
});

it("accepts an answer at the five-second and one-second edges", () => {
  expect(
    measureDeviceReading(issued, 1, { wall: 1_006_000, monotonic: 5500 }, false),
  ).toMatchObject({ result: "usable", uncertaintyMs: 2500 });
  expect(
    measureDeviceReading(issued, 1, { wall: 1_000_000, monotonic: 1500 }, false),
  ).toMatchObject({ result: "usable" });
  expect(
    measureDeviceReading(issued, 1, { wall: 1_002_000, monotonic: 1500 }, false),
  ).toMatchObject({ result: "usable" });
});

it("does not count a device on the box's own screen", () => {
  expect(
    measureDeviceReading(issued, 1_000_900, { wall: 1_001_200, monotonic: 1700 }, true),
  ).toEqual({ result: "unavailable", reason: "same_machine" });
  expect(measureDeviceReading(undefined, 0.5, { wall: 0, monotonic: 0 }, true)).toEqual({
    result: "unavailable",
    reason: "same_machine",
  });
});

it.each([
  ["no challenge", undefined, 1, { wall: 1_000_100, monotonic: 600 }],
  ["a fractional time", issued, 1.5, { wall: 1_000_100, monotonic: 600 }],
  ["an unsafe time", issued, 2 ** 53, { wall: 1_000_100, monotonic: 600 }],
  ["a steady clock that ran backwards", issued, 1, { wall: 1_000_000, monotonic: 499 }],
  ["an answer after five seconds", issued, 1, { wall: 1_005_001, monotonic: 5501 }],
  ["a steady clock that is not a number", issued, 1, { wall: 1_000_000, monotonic: NaN }],
  ["a wall clock stepped forwards", issued, 1, { wall: 1_002_001, monotonic: 1500 }],
  ["a wall clock stepped backwards", issued, 1, { wall: 999_999, monotonic: 1500 }],
])("refuses %s as an unanswered challenge", (_name, challenge, instantMs, received) => {
  expect(measureDeviceReading(challenge, instantMs, received, false)).toEqual({
    result: "unavailable",
    reason: "challenge",
  });
});
