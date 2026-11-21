import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtDialog } from "@waitron/ui";
import { blurAll, cleanupWidgets, mountWidget } from "./test-helpers.js";
import { pressIfEnabled } from "../state/pad-keys.js";
import "./numeric-pad.js";
import type { TillNumericPad } from "./numeric-pad.js";

afterEach(cleanupWidgets);

/** A host on the page, removed when the test ends. */
function pageHost(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  onTestFinished(() => host.remove());
  return host;
}

function newPad(mode: "decimal" | "pin" = "decimal"): TillNumericPad {
  const pad = document.createElement("till-numeric-pad");
  pad.mode = mode;
  return pad;
}

/** Records what `pad` emits, keeping its `value` in step as a parent would. */
function watch(pad: TillNumericPad) {
  const values: string[] = [];
  let enters = 0;
  let escapes = 0;
  pad.addEventListener("wt-change", (event) => {
    const { value } = (event as CustomEvent<{ value: string }>).detail;
    values.push(value);
    pad.value = value;
  });
  pad.addEventListener("pad-enter", () => enters++);
  pad.addEventListener("pad-escape", () => escapes++);
  return {
    values,
    get enters() {
      return enters;
    },
    get escapes() {
      return escapes;
    },
  };
}

async function mountPad(mode: "decimal" | "pin" = "decimal") {
  const { el } = await mountWidget<TillNumericPad>("till-numeric-pad", { mode, value: "" });
  await blurAll();
  return { pad: el, seen: watch(el) };
}

const keyOf = (pad: TillNumericPad, key: string) =>
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!;

describe("a keyboard on the number pad", () => {
  it("typing digits with nothing focused emits each value", async () => {
    const { seen } = await mountPad();
    await userEvent.keyboard("12,5");
    expect(seen.values).toEqual(["1", "12", "12.", "12.5"]);
  });

  it("pin pad: Delete clears, comma does nothing", async () => {
    const { seen } = await mountPad("pin");
    await userEvent.keyboard("07,{Delete}");
    expect(seen.values).toEqual(["0", "07", ""]);
  });

  it("ignores keys while a text field has focus", async () => {
    const { pad, seen } = await mountPad();
    const field = document.createElement("wt-input");
    pad.after(field);
    await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    await userEvent.click(field);
    await userEvent.keyboard("12{Enter}{Escape}");
    expect(seen.values).toEqual([]);
    expect(seen.enters).toBe(0);
    expect(seen.escapes).toBe(0);
  });

  it("ignores keys while an open wt-dialog does not hold the pad", async () => {
    const { seen } = await mountPad();
    const dialog = document.createElement("wt-dialog");
    dialog.heading = "Above";
    pageHost().append(dialog);
    dialog.open = true;
    await dialog.updateComplete;
    await userEvent.keyboard("12{Enter}");
    expect(seen.values).toEqual([]);
    expect(seen.enters).toBe(0);
  });

  it("delivers to a pad inside the open wt-dialog", async () => {
    const dialog = document.createElement("wt-dialog");
    dialog.heading = "Count";
    const pad = newPad();
    dialog.append(pad);
    pageHost().append(dialog);
    const seen = watch(pad);
    dialog.open = true;
    await dialog.updateComplete;
    await pad.updateComplete;
    await userEvent.keyboard("12");
    expect(seen.values).toEqual(["1", "12"]);
  });

  it("ignores keys while an open popover does not hold the pad, and Escape closes the popover", async () => {
    const { seen } = await mountPad();
    const popover = document.createElement("div");
    popover.popover = "auto";
    popover.textContent = "Menu";
    pageHost().append(popover);
    popover.showPopover();
    await userEvent.keyboard("12");
    expect(seen.values).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(popover.matches(":popover-open")).toBe(false));
    expect(seen.escapes).toBe(0);
  });

  it("ignores keys for a pad inside an inert container", async () => {
    const container = pageHost();
    container.inert = true;
    const pad = newPad();
    container.append(pad);
    await pad.updateComplete;
    const seen = watch(pad);
    await userEvent.keyboard("12{Enter}");
    expect(seen.values).toEqual([]);
    expect(seen.enters).toBe(0);
  });

  it("the later visible pad receives keys; a hidden later pad does not", async () => {
    const first = await mountPad();
    const second = await mountPad();
    await userEvent.keyboard("1");
    expect(first.seen.values).toEqual([]);
    expect(second.seen.values).toEqual(["1"]);

    const hidden = await mountPad();
    hidden.pad.style.display = "none";
    await userEvent.keyboard("2");
    expect(hidden.seen.values).toEqual([]);
    expect(second.seen.values).toEqual(["1", "12"]);
  });

  it("a browser without checkVisibility judges a pad by its boxes", async () => {
    const own = Object.getOwnPropertyDescriptor(Element.prototype, "checkVisibility")!;
    Object.defineProperty(Element.prototype, "checkVisibility", {
      value: undefined,
      configurable: true,
    });
    onTestFinished(() => {
      Object.defineProperty(Element.prototype, "checkVisibility", own);
    });
    const shown = await mountPad();
    const hidden = await mountPad();
    hidden.pad.style.display = "none";
    await userEvent.keyboard("3");
    expect(hidden.seen.values).toEqual([]);
    expect(shown.seen.values).toEqual(["3"]);
  });

  it("tapping the earlier pad brings it to the front", async () => {
    const first = await mountPad();
    const second = await mountPad();
    await userEvent.click(keyOf(first.pad, "4"));
    await blurAll();
    await userEvent.keyboard("5");
    expect(first.seen.values).toEqual(["4", "45"]);
    expect(second.seen.values).toEqual([]);
  });

  it("Enter after tapping a pad key fires pad-enter and types nothing", async () => {
    const { pad, seen } = await mountPad();
    await userEvent.click(keyOf(pad, "7"));
    await userEvent.keyboard("{Enter}");
    expect(seen.values).toEqual(["7"]);
    expect(seen.enters).toBe(1);
  });

  it("Enter while a button in the pad's own screen has focus is left to that button", async () => {
    const root = pageHost().attachShadow({ mode: "open" });
    const pad = newPad();
    const cancel = document.createElement("wt-button");
    cancel.textContent = "Cancel";
    root.append(pad, cancel);
    await cancel.updateComplete;
    const seen = watch(pad);
    const clicked = vi.fn();
    cancel.addEventListener("click", clicked);
    cancel.shadowRoot!.querySelector("button")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(clicked).toHaveBeenCalledOnce();
    expect(seen.enters).toBe(0);
  });

  it("Enter while a button in another component has focus goes to the pad", async () => {
    const root = pageHost().attachShadow({ mode: "open" });
    const pad = newPad();
    root.append(pad);
    const tile = document.createElement("wt-button");
    tile.textContent = "Ham";
    pageHost().attachShadow({ mode: "open" }).append(tile);
    await tile.updateComplete;
    const seen = watch(pad);
    const clicked = vi.fn();
    tile.addEventListener("click", clicked);
    tile.shadowRoot!.querySelector("button")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(seen.enters).toBe(1);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("Escape for a pad inside an open wt-dialog is left to the window", async () => {
    const dialog = document.createElement("wt-dialog") as WtDialog;
    dialog.heading = "Count";
    const pad = newPad();
    dialog.append(pad);
    pageHost().append(dialog);
    const seen = watch(pad);
    dialog.open = true;
    await dialog.updateComplete;
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(seen.escapes).toBe(0);
  });

  it("Escape with no window open fires pad-escape", async () => {
    const { seen } = await mountPad();
    await userEvent.keyboard("{Escape}");
    expect(seen.escapes).toBe(1);
  });

  it("held digit types once, held Backspace repeats", async () => {
    const { seen } = await mountPad();
    await userEvent.keyboard("{5>3/}");
    expect(seen.values).toEqual(["5"]);
    await userEvent.keyboard("123{Backspace>3/}");
    expect(seen.values).toEqual(["5", "51", "512", "5123", "512", "51", "5"]);
  });

  it("Ctrl+1 and Meta+R type nothing", async () => {
    const { seen } = await mountPad();
    await userEvent.keyboard("{Control>}1{/Control}{Meta>}r{/Meta}");
    expect(seen.values).toEqual([]);
  });

  it("stops listening once the last pad leaves", async () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    onTestFinished(() => {
      added.mockRestore();
      removed.mockRestore();
    });
    const { pad } = await mountPad();
    const router = added.mock.calls.find(([type]) => type === "keydown")?.[1];
    expect(router).toBeDefined();
    pad.remove();
    expect(removed).toHaveBeenCalledWith("keydown", router);
  });
});

describe("pressIfEnabled", () => {
  async function button(props: Partial<WtButton> = {}) {
    const el = document.createElement("wt-button");
    Object.assign(el, props);
    pageHost().append(el);
    await el.updateComplete;
    const clicked = vi.fn();
    el.addEventListener("click", clicked);
    return { el, clicked };
  }

  it("clicks an enabled button", async () => {
    const { el, clicked } = await button();
    pressIfEnabled(el);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("does not click a disabled button", async () => {
    const { el, clicked } = await button({ disabled: true });
    pressIfEnabled(el);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("does not click a busy button", async () => {
    const { el, clicked } = await button({ loading: true });
    pressIfEnabled(el);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("does nothing without a button", () => {
    expect(() => pressIfEnabled(null)).not.toThrow();
  });
});
