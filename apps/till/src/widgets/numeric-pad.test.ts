import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillNumericPad, nextPadValue } from "./numeric-pad.js";

afterEach(cleanupWidgets);

// The pure string-builder the pad emits on each key. It is exported and tested directly so every
// branch (leading-zero suppression, the single decimal point, the transient trailing dot) is
// pinned independently of the DOM plumbing that carries its result to the parent.
describe("nextPadValue", () => {
  it("appends a digit to a fresh pad", () => {
    expect(nextPadValue("", "5")).toBe("5");
  });

  it("appends a digit to an existing number", () => {
    expect(nextPadValue("12", "3")).toBe("123");
  });

  it("replaces a lone leading zero rather than keeping it", () => {
    expect(nextPadValue("0", "5")).toBe("5");
  });

  it("keeps a single zero when zero is pressed on zero", () => {
    expect(nextPadValue("0", "0")).toBe("0");
  });

  it("appends a digit after the decimal point", () => {
    expect(nextPadValue("0.", "3")).toBe("0.3");
  });

  it("starts a decimal from empty as 0.", () => {
    expect(nextPadValue("", ".")).toBe("0.");
  });

  it("adds a decimal point to a whole number", () => {
    expect(nextPadValue("5", ".")).toBe("5.");
  });

  it("ignores a second decimal point", () => {
    expect(nextPadValue("0.3", ".")).toBe("0.3");
  });

  it("backspaces the last character", () => {
    expect(nextPadValue("0.3", "backspace")).toBe("0.");
  });

  it("backspacing an empty value stays empty", () => {
    expect(nextPadValue("", "backspace")).toBe("");
  });
});

describe("till-numeric-pad", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-numeric-pad")).toBe(TillNumericPad);
  });

  it("renders a key for every digit, the decimal point and backspace", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", { value: "" });
    for (const key of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "backspace"]) {
      expect(el.shadowRoot!.querySelector(`[data-key="${key}"]`), key).not.toBeNull();
    }
  });

  it("emits wt-change with the next value when a digit is pressed", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", { value: "1" });
    const spy = vi.fn();
    el.addEventListener("wt-change", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-key="2"]')!.click();
    expect(spy).toHaveBeenCalledWith({ value: "12" });
  });

  it("emits the decimal-point key as 0. from an empty pad", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", { value: "" });
    const spy = vi.fn();
    el.addEventListener("wt-change", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-key="."]')!.click();
    expect(spy).toHaveBeenCalledWith({ value: "0." });
  });

  it("emits backspace removing the last character", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", { value: "12" });
    const spy = vi.fn();
    el.addEventListener("wt-change", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-key="backspace"]')!.click();
    expect(spy).toHaveBeenCalledWith({ value: "1" });
  });
});
