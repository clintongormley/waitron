import { expect, it } from "vitest";
import { render } from "lit";
import {
  clockProblem,
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

const words = { later: "A later minute is in use.", laterFrom: (t: string) => `From ${t}.` };

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
