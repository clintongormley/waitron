import { afterEach, describe, expect, it, vi } from "vitest";
import { nothing, render, type ReactiveControllerHost } from "lit";
import {
  ClockWait,
  clockProblem,
  clockWaitStrings,
  dateTimeFormat,
  renderClockProblem,
  validWait,
  type ClockWords,
} from "./clock-wait.js";

const LAST_DATE_MS = 8_640_000_000_000_000;

it.each([
  [{ targetMs: 1_000, remainingMs: 0 }, true],
  [{ targetMs: LAST_DATE_MS, remainingMs: 1_000 }, true],
  [{ targetMs: -LAST_DATE_MS, remainingMs: 1_000 }, true],
  [{ targetMs: 1_000, remainingMs: null }, false],
  [{ targetMs: LAST_DATE_MS + 60_000, remainingMs: 1_000 }, false],
  [{ targetMs: -LAST_DATE_MS - 60_000, remainingMs: 1_000 }, false],
])("a wait of %j is valid: %s", (wait, valid) => {
  expect(validWait(wait)).toBe(valid);
});

const words: ClockWords = {
  ...clockWaitStrings.en,
  secondClockDo: "",
  secondClockEnds: "",
  differDo: "",
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim();

it.each([undefined, Date.parse("2026-10-18T20:04:00Z"), LAST_DATE_MS + 60_000])(
  "a later minute names no time (allowed from %s)",
  (allowedFromMs) => {
    const read = clockProblem({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs },
    });
    expect(read).toEqual({ kind: "later" });
    const target = document.createElement("div");
    render(renderClockProblem(read, words, undefined), target);
    expect(text(target.querySelector("[data-test=minute-not-later]"))).toBe(
      "The series cannot be made yet: a later minute is already in use.",
    );
  },
);

it("a minute in use counts down when the box says how long", () => {
  const read = clockProblem({
    code: "sif.allocation_invalid",
    params: {
      reason: "minute_in_use",
      allowedFromMs: Date.parse("2026-10-18T20:04:00Z"),
      remainingMs: 180_000,
      recheckInMs: 30_000,
    },
  });
  expect(read).toEqual({ kind: "next-minute", remainingMs: 180_000, recheckInMs: 30_000 });
  const target = document.createElement("div");
  render(renderClockProblem(read, words, undefined), target);
  expect(text(target)).toBe("");
});

it.each([
  [{}],
  [{ remainingMs: 180_000 }],
  [{ recheckInMs: 30_000 }],
  [{ remainingMs: "180000", recheckInMs: 30_000 }],
  [{ remainingMs: Number.POSITIVE_INFINITY, recheckInMs: 30_000 }],
  [{ remainingMs: 180_000, recheckInMs: Number.NaN }],
  [{ remainingMs: 0, recheckInMs: 0 }],
  [{ remainingMs: 180_000, recheckInMs: 0 }],
  [{ remainingMs: 180_000, recheckInMs: -1 }],
  [{ remainingMs: 30_000, recheckInMs: 30_001 }],
])("a minute in use with %j names no time and does not count down", (values) => {
  const read = clockProblem({
    code: "sif.allocation_invalid",
    params: {
      reason: "minute_in_use",
      allowedFromMs: Date.parse("2026-10-18T20:04:00Z"),
      ...values,
    },
  });
  expect(read).toEqual({ kind: "in-use" });
  const target = document.createElement("div");
  render(renderClockProblem(read, words, undefined), target);
  expect(text(target.querySelector("[data-test=minute-in-use]"))).toBe(
    "The series cannot be made yet: this box's records already hold a series for the minute this box would use.",
  );
});

describe("a taken minute shows one countdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NEXT_MINUTE = (remainingMs: number, recheckInMs: number) => ({
    code: "sif.allocation_invalid",
    params: { reason: "minute_in_use", allowedFromMs: 1, remainingMs, recheckInMs },
  });
  const WAITING = { status: "waiting", targetMs: 1, remainingMs: 150_000 } as const;
  const TAKEN =
    "The minute this box would use already has a series here, so it will use the next free minute.";

  const setup = () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const host: ReactiveControllerHost = {
      addController: () => undefined,
      removeController: () => undefined,
      requestUpdate: () => undefined,
      updateComplete: Promise.resolve(true),
    };
    const recheck = vi.fn();
    const fail = vi.fn();
    const wait = new ClockWait<{ status: "selected" }>(host, recheck);
    const drawn = () => {
      const target = document.createElement("div");
      render(wait.counting ? wait.renderWait(words) : nothing, target);
      return target;
    };
    return { wait, recheck, fail, drawn };
  };

  it("a taken minute shows one countdown and checks again quietly", () => {
    const { wait, recheck, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    expect(wait.waiting).toBe(true);
    expect(wait.counting).toBe(true);
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(drawn().querySelector("[data-test=minute-taken]")?.getAttribute("role")).toBe("status");
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("3:00");
    vi.advanceTimersByTime(30_000);
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("2:30");
    wait.show(undefined, WAITING);
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("2:30");
    expect(fail).not.toHaveBeenCalled();
  });

  it("a re-check refused again starts the same display again", () => {
    const { wait, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    wait.settle(NEXT_MINUTE(120_000, 60_000), true, fail);
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("2:00");
    expect(fail).not.toHaveBeenCalled();
  });

  it("the taken-minute sentence goes when the person starts again", () => {
    const { wait, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    wait.show();
    wait.show(undefined, WAITING);
    expect(drawn().querySelector("[data-test=minute-taken]")).toBeNull();
    expect(text(drawn().querySelector("[role=status]"))).toBe(
      "Waiting to confirm the time, so no invoice series is ever repeated.",
    );
  });

  it.each([
    [
      "the series is selected",
      (wait: ClockWait<{ status: "selected" }>) => wait.show(undefined, { status: "selected" }),
    ],
    [
      "the clocks disagree",
      (wait: ClockWait<{ status: "selected" }>) => wait.show({ kind: "disagreement" }),
    ],
    [
      "a second clock is needed",
      (wait: ClockWait<{ status: "selected" }>) => wait.waitForSecondClock(),
    ],
  ])("the taken-minute sentence goes when %s", (_case, next) => {
    const { wait, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    next(wait);
    wait.show(undefined, WAITING);
    expect(drawn().querySelector("[data-test=minute-taken]")).toBeNull();
  });
});

it("builds each language, zone and style's formatter once", () => {
  const minute = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const first = dateTimeFormat("es", "Atlantic/Canary", minute);
  expect(dateTimeFormat("es", "Atlantic/Canary", { ...minute })).toBe(first);
  expect(first.format(Date.parse("2026-10-18T20:04:00Z"))).toBe("21:04");
  expect(dateTimeFormat("en", "Atlantic/Canary", minute)).not.toBe(first);
  expect(dateTimeFormat("es", "Europe/Madrid", minute)).not.toBe(first);
  expect(dateTimeFormat("es", "Atlantic/Canary", { dateStyle: "medium" })).not.toBe(first);
});
