import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import {
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

const words = {
  later: "A later minute is in use.",
  laterFrom: (t: string) => `From ${t}.`,
  laterFromDay: (d: string, t: string) => `From ${d}, ${t}.`,
};

it.each([
  [LAST_DATE_MS + 60_000, { kind: "later" }],
  [-LAST_DATE_MS - 60_000, { kind: "later" }],
  [LAST_DATE_MS, { kind: "later", allowedFromMs: LAST_DATE_MS }],
])("a later minute allowed from %d keeps only a time it can draw", (allowedFromMs, problem) => {
  const read = clockProblem({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later", allowedFromMs },
  });
  expect(read).toEqual(problem);
  const target = document.createElement("div");
  render(renderClockProblem(read, words as ClockWords, undefined, "en", "UTC"), target);
  expect(target.textContent).toContain("A later minute is in use.");
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

describe("the wait line names the day only when the floor falls on a later day in the venue's zone", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const line = (locale: "en" | "es", timeZone: string, nowIso: string, floorIso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(nowIso));
    const target = document.createElement("div");
    const pageWords = {
      ...clockWaitStrings[locale],
      secondClockDo: "",
      secondClockEnds: "",
      differDo: "",
    };
    render(
      renderClockProblem(
        { kind: "later", allowedFromMs: Date.parse(floorIso) },
        pageWords,
        undefined,
        locale,
        timeZone,
      ),
      target,
    );
    return target.textContent?.replace(/\s+/g, " ").trim();
  };

  it.each([
    ["en", "You can carry on from 18 Oct 2026, 15:45."],
    ["es", "Podrás seguir a partir del 18 oct 2026 a las 15:45."],
  ] as const)("a floor two days later shows its date in %s", (locale, sentence) => {
    expect(
      line(locale, "Europe/Madrid", "2026-10-16T14:15:00+02:00", "2026-10-18T15:45:00+02:00"),
    ).toContain(sentence);
  });

  it("a floor just past the venue's midnight shows its date although the UTC date is the same", () => {
    expect(line("en", "Atlantic/Canary", "2026-10-20T22:50:00Z", "2026-10-20T23:05:00Z")).toContain(
      "You can carry on from 21 Oct 2026, 00:05.",
    );
  });

  it.each([
    [
      "later today",
      "Europe/Madrid",
      "2026-10-16T14:15:00+02:00",
      "2026-10-16T23:30:00+02:00",
      "23:30",
    ],
    [
      "later today in the venue's zone, on the next UTC day",
      "Atlantic/Canary",
      "2026-10-20T23:05:00Z",
      "2026-10-21T00:00:00Z",
      "01:00",
    ],
    [
      "an earlier day",
      "Europe/Madrid",
      "2026-10-16T14:15:00+02:00",
      "2026-10-15T15:45:00+02:00",
      "15:45",
    ],
  ])("a floor %s shows the time alone", (_case, timeZone, nowIso, floorIso, time) => {
    const text = line("en", timeZone, nowIso, floorIso);
    expect(text).toContain(`You can carry on from ${time}.`);
    expect(text).not.toMatch(/Oct/);
  });
});
