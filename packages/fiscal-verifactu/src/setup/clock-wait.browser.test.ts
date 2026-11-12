import { afterEach, describe, expect, it, vi } from "vitest";
import { nothing, render, type ReactiveControllerHost } from "lit";
import {
  ClockWait,
  clockProblem,
  clockWaitStrings,
  dateTimeFormat,
  remainingAsClock,
  renderClockProblem,
  renderClockRows,
  validWait,
  type ClockWords,
} from "./clock-wait.js";
import { regionName } from "./check-venue.js";

const LAST_DATE_MS = 8_640_000_000_000_000;

it.each([
  ["en", "ES", "Spain"],
  ["es", "ES", "España"],
  ["en", "", ""],
  ["en", "E1", "E1"],
  ["es", "not a code", "not a code"],
] as const)("in %s the country %j is shown as %j", (language, code, shown) => {
  expect(regionName(language, code)).toBe(shown);
});

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
};

const unanswered = { answered: false, answer: () => undefined };

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
    render(renderClockProblem(read, words, undefined, unanswered), target);
    expect(text(target.querySelector("[data-test=minute-not-later]"))).toBe(
      "The invoice series cannot be created yet: this box's clock is earlier than a time it has already used for invoice series.",
    );
  },
);

it.each(["second-clock", "disagreement"] as const)(
  "a %s explanation draws no paragraph for a sentence the page leaves empty",
  (kind) => {
    const target = document.createElement("div");
    render(
      renderClockProblem({ kind }, { ...words, secondClockDo: "Do this." }, undefined, unanswered),
      target,
    );
    const paragraphs = [...target.querySelectorAll("p")].map((p) => text(p));
    expect(paragraphs).not.toContain("");
    expect(paragraphs).toHaveLength(2);
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
  render(renderClockProblem(read, words, undefined, unanswered), target);
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
  render(renderClockProblem(read, words, undefined, unanswered), target);
  expect(text(target.querySelector("[data-test=minute-in-use]"))).toBe(
    "The invoice series cannot be created. This is a fault in Waitron.",
  );
});

it("a stored pick refused as in use names no time in Spanish", () => {
  const read = clockProblem({
    code: "sif.allocation_invalid",
    params: { reason: "minute_in_use" },
  });
  expect(read).toEqual({ kind: "in-use" });
  const target = document.createElement("div");
  render(
    renderClockProblem(
      read,
      { ...clockWaitStrings.es, secondClockDo: "", secondClockEnds: "" },
      undefined,
      unanswered,
    ),
    target,
  );
  expect(text(target.querySelector("[data-test=minute-in-use]"))).toBe(
    "No se pueden crear las series de facturas. Es un fallo de Waitron.",
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
    "This invoice series code has already been used. Waitron creates a new one by itself when the countdown ends.";

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
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("03:00");
    expect(text(drawn().querySelector("[data-test=remaining]")?.parentElement)).toBe(
      "New invoice series in 03:00",
    );
    expect(text(drawn())).toContain("Nothing to do; keep this page open.");
    vi.advanceTimersByTime(30_000);
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("02:30");
    wait.show(undefined, WAITING);
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("02:30");
    expect(fail).not.toHaveBeenCalled();
  });

  it("after the re-check the figure follows the box's answer", () => {
    const { wait, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    wait.show(undefined, { ...WAITING, remainingMs: 90_001 });
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("01:31");
  });

  it("a re-check refused again starts the same display again", () => {
    const { wait, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    wait.settle(NEXT_MINUTE(120_000, 60_000), true, fail);
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("02:00");
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
    expect(text(drawn().querySelector("[data-test=remaining]")?.parentElement)).toBe(
      "Continues in 2:30",
    );
  });

  it("a lost re-check keeps the countdown going and checks again", () => {
    const { wait, recheck, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    expect(recheck).toHaveBeenCalledTimes(1);
    wait.settle(new TypeError("Failed to fetch"), true, fail);
    expect(fail).not.toHaveBeenCalled();
    expect(wait.counting).toBe(true);
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    vi.advanceTimersByTime(1_000);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("02:29");
    vi.advanceTimersByTime(14_000);
    expect(recheck).toHaveBeenCalledTimes(2);
    wait.settle(new TypeError("Failed to fetch"), true, fail);
    vi.advanceTimersByTime(15_000);
    expect(recheck).toHaveBeenCalledTimes(3);
    wait.show(undefined, WAITING);
    vi.advanceTimersByTime(60_000);
    expect(recheck).toHaveBeenCalledTimes(3);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("01:30");
    expect(fail).not.toHaveBeenCalled();
  });

  it("a taken minute's figure stays at 00:00 while lost re-checks repeat", () => {
    const { wait, recheck, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    expect(recheck).toHaveBeenCalledTimes(1);
    wait.settle(new TypeError("Failed to fetch"), true, fail);
    for (let check = 2; check <= 13; check++) {
      vi.advanceTimersByTime(15_000);
      expect(recheck).toHaveBeenCalledTimes(check);
      wait.settle(new TypeError("Failed to fetch"), true, fail);
    }
    expect(text(drawn().querySelector("[data-test=remaining]")?.parentElement)).toBe(
      "New invoice series in 00:00",
    );
    expect(text(drawn().querySelector("[data-test=minute-taken]"))).toBe(TAKEN);
    expect(fail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(recheck).toHaveBeenCalledTimes(14);
    expect(text(drawn().querySelector("[data-test=remaining]"))).toBe("00:00");
  });

  it("a lost check at the end of the box's wait checks again", () => {
    const { wait, recheck, fail, drawn } = setup();
    wait.show(undefined, { ...WAITING, remainingMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    expect(recheck).toHaveBeenCalledTimes(1);
    wait.settle(new TypeError("Failed to fetch"), true, fail);
    expect(fail).not.toHaveBeenCalled();
    expect(text(drawn().querySelector("[data-test=remaining]")?.parentElement)).toBe(
      "Continues in 0:00",
    );
    vi.advanceTimersByTime(15_000);
    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it("a person's action after a lost re-check stops the quiet checks", () => {
    const { wait, recheck, fail, drawn } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    wait.settle(new TypeError("Failed to fetch"), true, fail);
    wait.show();
    vi.advanceTimersByTime(60_000);
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(drawn().textContent?.trim()).toBe("");
  });

  it.each([
    ["a request the person made is lost", new TypeError("Failed to fetch"), false],
    ["the box refuses the re-check", { code: "setup.invalid" }, true],
    ["the page cannot read the box's answer to a re-check", new Error("invalid wait"), true],
  ])("the wait goes when %s", (_case, error, automatic) => {
    const { wait, recheck, fail } = setup();
    wait.settle(NEXT_MINUTE(180_000, 30_000), false, fail);
    vi.advanceTimersByTime(30_000);
    wait.settle(error, automatic, fail);
    expect(fail).toHaveBeenCalledWith(error);
    expect(wait.counting).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(recheck).toHaveBeenCalledTimes(1);
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

it.each([
  [0, "00:00"],
  [1_000, "00:01"],
  [51_001, "00:52"],
  [60_000, "01:00"],
  [61_000, "01:01"],
  [150_000, "02:30"],
  [180_000, "03:00"],
  [600_000, "10:00"],
])("a taken minute's %i ms left reads %s", (ms, shown) => {
  expect(remainingAsClock(ms)).toBe(shown);
});

it("says in Spanish that the code exists and when a new one is made", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const host: ReactiveControllerHost = {
    addController: () => undefined,
    removeController: () => undefined,
    requestUpdate: () => undefined,
    updateComplete: Promise.resolve(true),
  };
  try {
    const wait = new ClockWait<{ status: "selected" }>(host, () => undefined);
    wait.show({ kind: "next-minute", remainingMs: 52_000, recheckInMs: 1_000 });
    const target = document.createElement("div");
    render(
      wait.renderWait({
        ...clockWaitStrings.es,
        secondClockDo: "",
        secondClockEnds: "",
      }),
      target,
    );
    expect(text(target.querySelector("[data-test=minute-taken]"))).toBe(
      "Este código de serie de facturas ya se ha usado. Waitron creará otro por sí solo cuando termine la cuenta atrás.",
    );
    expect(text(target.querySelector("[data-test=remaining]")?.parentElement)).toBe(
      "Nueva serie de facturas en 00:52",
    );
  } finally {
    vi.useRealTimers();
  }
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

describe("the clock rows on Check this venue", () => {
  const at = Date.parse("2026-10-18T12:30:20Z");
  const reading = (source: string, ms: number) => ({
    source,
    lowerMs: ms - 400,
    upperMs: ms + 400,
  });
  const decision = (
    usable: { source: string; lowerMs: number; upperMs: number }[],
    disagreement = false,
  ) =>
    ({
      usable,
      unavailable: [],
      secondClock: usable.length > 1,
      disagreement,
      releaseBlocked: false,
      rangeBlocked: false,
    }) as unknown as Parameters<typeof renderClockRows>[0];
  const rows = (target: Element) =>
    [...target.querySelectorAll("div")].map((row) => [
      text(row.querySelector("dt")),
      text(row.querySelector("dd")),
    ]);
  const draw = (clock: Parameters<typeof renderClockRows>[0], locale: "en" | "es" = "en") => {
    const target = document.createElement("div");
    render(
      renderClockRows(clock, false, clockWaitStrings[locale], locale, "Europe/Madrid"),
      target,
    );
    return target;
  };

  it.each([
    [["browser"], "18 October 2026 at 14:30 — matches this device"],
    [["internet"], "18 October 2026 at 14:30 — matches the internet time"],
    [
      ["browser", "internet"],
      "18 October 2026 at 14:30 — matches this device and the internet time",
    ],
  ])("clocks that agree show one Box time row naming %j", (others, shown) => {
    const target = draw(
      decision([reading("box", at), ...others.map((s) => reading(s, at + 9_000))]),
    );
    expect(rows(target)).toEqual([["Box time", shown]]);
    expect(text(target)).not.toContain("12:30");
    expect(text(target)).not.toContain(":20");
  });

  it("names the clock that agreed in Spanish", () => {
    const target = draw(decision([reading("box", at), reading("internet", at)]), "es");
    expect(rows(target)).toEqual([
      ["Hora del servidor", "18 de octubre de 2026 a las 14:30 — coincide con la hora de internet"],
    ]);
  });

  it("clocks that differ show one row per clock, each one time to the minute", () => {
    const target = document.createElement("div");
    render(
      renderClockRows(
        decision([reading("box", at), reading("browser", at + 5 * 60_000)], true),
        true,
        clockWaitStrings.en,
        "en",
        "Europe/Madrid",
      ),
      target,
    );
    expect(rows(target)).toEqual([
      ["Box time", "18 October 2026 at 14:30"],
      ["This device", "18 October 2026 at 14:35"],
      ["Internet", "Unavailable"],
    ]);
    expect(text(target)).not.toContain(" – ");
    expect(text(target)).not.toContain("Z");
  });

  const drawDiffering = (
    readings: { source: string; lowerMs: number; upperMs: number }[],
    locale: "en" | "es" = "en",
  ) => {
    const target = document.createElement("div");
    render(
      renderClockRows(
        decision(readings, true),
        true,
        clockWaitStrings[locale],
        locale,
        "Europe/Madrid",
      ),
      target,
    );
    return target;
  };
  const minuteStart = Date.parse("2026-10-18T12:30:00Z");

  it("clocks that differ within one minute show their seconds, so the difference is visible", () => {
    const target = drawDiffering([
      reading("box", minuteStart + 400),
      reading("browser", minuteStart + 45_000),
    ]);
    expect(rows(target)).toEqual([
      ["Box time", "18 October 2026 at 14:30:00"],
      ["This device", "18 October 2026 at 14:30:45"],
      ["Internet", "Unavailable"],
    ]);
  });

  it("shows the seconds in Spanish too", () => {
    const target = drawDiffering(
      [reading("box", minuteStart + 400), reading("internet", minuteStart + 45_000)],
      "es",
    );
    expect(rows(target)).toEqual([
      ["Hora del servidor", "18 de octubre de 2026 a las 14:30:00"],
      ["Este dispositivo", "No disponible"],
      ["Internet", "18 de octubre de 2026 a las 14:30:45"],
    ]);
  });

  it("clocks that differ by two minutes show minutes only", () => {
    const target = drawDiffering([
      reading("box", minuteStart + 400),
      reading("browser", minuteStart + 120_000),
      reading("internet", minuteStart + 125_000),
    ]);
    expect(rows(target)).toEqual([
      ["Box time", "18 October 2026 at 14:30"],
      ["This device", "18 October 2026 at 14:32"],
      ["Internet", "18 October 2026 at 14:32"],
    ]);
  });

  it("a box with no second clock shows its time alone", () => {
    expect(rows(draw(decision([reading("box", at)])))).toEqual([
      ["Box time", "18 October 2026 at 14:30"],
    ]);
  });
});

describe("the question when the clocks differ", () => {
  const host: ReactiveControllerHost = {
    addController: () => undefined,
    removeController: () => undefined,
    requestUpdate: () => undefined,
    updateComplete: Promise.resolve(true),
  };
  const choiceWords: ClockWords = {
    ...clockWaitStrings.en,
    secondClockDo: "",
    secondClockEnds: "",
  };

  it.each(["server-correct", "both-wrong"])(
    "%s replaces the question with the instruction, and a new problem asks again",
    (choice) => {
      const wait = new ClockWait<{ status: "selected" }>(host, () => undefined);
      wait.show({ kind: "disagreement" });
      const target = document.createElement("div");
      render(wait.renderProblem(choiceWords, undefined), target);
      expect(text(target)).toContain("Which is correct:");
      expect(
        [...target.querySelectorAll("wt-button")].map((b) => [
          b.getAttribute("data-test"),
          text(b),
        ]),
      ).toEqual([
        ["server-correct", "The server"],
        ["both-wrong", "Both times are wrong"],
      ]);
      target.querySelector<HTMLElement>(`[data-test=${choice}]`)!.click();
      render(wait.renderProblem(choiceWords, undefined), target);
      expect(text(target)).not.toContain("Which is correct:");
      expect(target.querySelector("wt-button")).toBeNull();
      expect(text(target.querySelector("[data-test=correct-device]"))).toBe(
        "Please correct the time on this device and then reconnect to the server.",
      );
      wait.show({ kind: "disagreement" });
      render(wait.renderProblem(choiceWords, undefined), target);
      expect(text(target)).toContain("Which is correct:");
    },
  );

  it("asks in Spanish", () => {
    const wait = new ClockWait<{ status: "selected" }>(host, () => undefined);
    wait.show({ kind: "disagreement" });
    const target = document.createElement("div");
    const es = { ...clockWaitStrings.es, secondClockDo: "", secondClockEnds: "" };
    render(wait.renderProblem(es, undefined), target);
    expect(text(target)).toContain("¿Cuál es la correcta?");
    expect([...target.querySelectorAll("wt-button")].map((b) => text(b))).toEqual([
      "El servidor",
      "Las dos horas están mal",
    ]);
    target.querySelector<HTMLElement>("[data-test=both-wrong]")!.click();
    render(wait.renderProblem(es, undefined), target);
    expect(text(target.querySelector("[data-test=correct-device]"))).toBe(
      "Corrige la hora de este dispositivo y vuelve a conectarte al servidor.",
    );
  });

  it("no shared sentence sends the person to somebody else", () => {
    const all = JSON.stringify(clockWaitStrings);
    expect(all).not.toMatch(/ask for help|pide ayuda/i);
  });
});
