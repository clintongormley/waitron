import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillNumericPad, nextPadValue, nextPinValue } from "./numeric-pad.js";

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

// The pin-mode string-builder: digit-append with leading zeros preserved, so a PIN round-trips.
// Chained through a whole key sequence to prove the fix (the decimal builder collapses the same run).
describe("nextPinValue", () => {
  const build = (keys: string, next = nextPinValue) => {
    let value = "";
    for (const key of keys) value = next(value, key);
    return value;
  };

  it("keeps every leading zero, so 0,0,0,0 builds 0000", () => {
    expect(build("0000")).toBe("0000");
  });

  it("preserves a leading zero in a mixed PIN, so 0,1,2,3 builds 0123", () => {
    expect(build("0123")).toBe("0123");
  });

  it("decimal mode still collapses that same 0,0,0,0 run to 0 — pin mode is what differs", () => {
    expect(build("0000", nextPadValue)).toBe("0");
  });

  it("appends a digit to a fresh pad", () => {
    expect(nextPinValue("", "7")).toBe("7");
  });

  it("appends a zero onto an existing zero rather than collapsing it", () => {
    expect(nextPinValue("0", "0")).toBe("00");
  });

  it("backspaces the last digit", () => {
    expect(nextPinValue("0000", "backspace")).toBe("000");
  });

  it("backspacing an empty value stays empty", () => {
    expect(nextPinValue("", "backspace")).toBe("");
  });

  it("ignores a decimal point (the pad hides that key in pin mode)", () => {
    expect(nextPinValue("12", ".")).toBe("12");
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

  it("omits the decimal-point key in pin mode but keeps every digit and backspace", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", {
      value: "",
      mode: "pin",
    });
    expect(el.shadowRoot!.querySelector('[data-key="."]')).toBeNull();
    for (const key of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "backspace"]) {
      expect(el.shadowRoot!.querySelector(`[data-key="${key}"]`), key).not.toBeNull();
    }
  });

  it("appends a digit verbatim in pin mode, so a zero onto zeros keeps the leading run", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", {
      value: "000",
      mode: "pin",
    });
    const spy = vi.fn();
    el.addEventListener("wt-change", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-key="0"]')!.click();
    expect(spy).toHaveBeenCalledWith({ value: "0000" });
  });

  it("backspaces in pin mode", async () => {
    const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", {
      value: "0000",
      mode: "pin",
    });
    const spy = vi.fn();
    el.addEventListener("wt-change", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-key="backspace"]')!.click();
    expect(spy).toHaveBeenCalledWith({ value: "000" });
  });
});
