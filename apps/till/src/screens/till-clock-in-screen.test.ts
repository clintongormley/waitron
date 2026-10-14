import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillClockInScreen } from "./till-clock-in-screen.js";
import "./till-clock-in-screen.js";

afterEach(cleanupWidgets);
describe("first-sign-in clock page", () => {
  it("Clock in and Cancel sit together in the middle and emit one plain intent each", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    try {
      const { el } = await mountWidget<TillClockInScreen>("till-clock-in-screen", {});
      const actions = el.shadowRoot!.querySelector<HTMLElement>(".actions")!;
      expect(actions).not.toBeNull();
      expect(getComputedStyle(el).display).toBe("flex");
      expect(getComputedStyle(el).justifyContent).toBe("center");
      const buttons = [...actions.querySelectorAll("wt-button")];
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Clock in", "Cancel"]);
      expect(buttons[0]!.getAttribute("size")).toBe("lg");
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

  it("read failure has Retry and usable Cancel, while an unknown state cannot submit", async () => {
    const { el } = await mountWidget<TillClockInScreen>("till-clock-in-screen", {
      error: "Cannot read clock",
      canClockIn: false,
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
