import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { MyShift } from "../api/attendance-api.js";
import type { TillClockInScreen } from "./till-clock-in-screen.js";
import "./till-clock-in-screen.js";

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});

const mount = (props: Partial<TillClockInScreen> = {}) =>
  mountWidget<TillClockInScreen>("till-clock-in-screen", props);
const shift = (id: string, start: Date, end: Date, description: string): MyShift => ({
  id,
  startsAt: start.toISOString(),
  startsOffsetMinutes: -start.getTimezoneOffset() + 30,
  endsAt: end.toISOString(),
  endsOffsetMinutes: -end.getTimezoneOffset(),
  description,
  rosterVersionId: "published",
});
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
describe("first-sign-in clock page", () => {
  it("puts the timed primary action and Not now in the foot bar and emits one intent each", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at(27, 17, 2));
      const { el } = await mount({ displayName: "Javier Torres" });
      expect(el.shadowRoot!.querySelector("h1")?.textContent?.trim()).toBe("Hello, Javier");
      const buttons = [...el.shadowRoot!.querySelectorAll("wt-foot-button-bar wt-button")];
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Clock in · 17:02", "Not now"]);
      expect(buttons[0]!.shadowRoot!.querySelector("button")!.getBoundingClientRect().height).toBe(
        52,
      );
      expect(buttons[0]!.getAttribute("variant")).toBe("primary");
      const seen: Event[] = [];
      for (const type of ["clock-in", "cancel-clock-in"])
        el.addEventListener(type, (e) => seen.push(e));
      for (const button of buttons) await userEvent.click(button);
      expect(seen.map((e) => [e.type, e.bubbles, e.composed, (e as CustomEvent).detail])).toEqual([
        ["clock-in", true, true, null],
        ["cancel-clock-in", true, true, null],
      ]);
    } finally {
      setLocale(locale);
    }
  });

  it.each([
    [at(27, 1, 5), "23:30 – 02:00 · Bar"],
    [at(27, 12), "17:30 – 23:30 · Dining room"],
  ])("shows the current or next published shift at %s", async (now, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const listMyShifts = vi
      .fn()
      .mockResolvedValue([
        shift("later", at(27, 18), at(27, 23, 45), "Kitchen"),
        shift("first", at(27, 17), at(27, 23, 30), "Dining room"),
        shift("night", at(26, 23), at(27, 2), "Bar"),
      ]);
    const { el } = await mount({ api: { listMyShifts } });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(expected));
    expect(listMyShifts).toHaveBeenCalledExactlyOnceWith("2026-11-26", "2026-11-28");
  });

  it("shows the break start with its recorded offset and skips the roster read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T20:55:00Z"));
    const listMyShifts = vi.fn().mockResolvedValue([]);
    const { el } = await mount({
      api: { listMyShifts },
      action: "break-end",
      displayName: "Javier Torres",
      breakStart: { eventAt: "2026-11-27T20:30:00Z", offsetMinutes: 60 },
    });
    expect(el.shadowRoot!.querySelector("h1")?.textContent?.trim()).toBe("Welcome back, Javier");
    expect(el.shadowRoot!.querySelector("time")?.textContent?.trim()).toBe("21:30");
    expect(el.shadowRoot!.querySelector("strong")?.textContent?.replace(/\s+/gu, " ").trim()).toBe(
      "21:30 · 25 min",
    );
    expect(listMyShifts).not.toHaveBeenCalled();
  });

  it("read failure has Retry and usable Not now, while an unknown state cannot submit", async () => {
    const { el } = await mountWidget<TillClockInScreen>("till-clock-in-screen", {
      error: "Cannot read clock",
      canAct: false,
    });
    const button = el.shadowRoot!.querySelector("wt-button[data-clock-in]")!;
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("variant")).toBe("secondary");
    expect(el.shadowRoot!.querySelector("[role=status]")!.textContent).toBe("Cannot read clock");
    const seen: string[] = [];
    el.addEventListener("retry-clock-read", () => seen.push("retry"));
    el.addEventListener("cancel-clock-in", () => seen.push("cancel"));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-retry]")!);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    expect(seen).toEqual(["retry", "cancel"]);
  });

  it("only a submitted write disables Cancel; a write refusal permits another action", async () => {
    const { el } = await mountWidget<TillClockInScreen>("till-clock-in-screen", { reading: true });
    expect(el.shadowRoot!.querySelector("[data-cancel]")!.hasAttribute("disabled")).toBe(false);
    el.reading = false;
    el.busy = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-cancel]")!.hasAttribute("disabled")).toBe(true);
    el.busy = false;
    el.error = "Write refused";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-clock-in]")!.hasAttribute("disabled")).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-cancel]")!.hasAttribute("disabled")).toBe(false);
  });
});
