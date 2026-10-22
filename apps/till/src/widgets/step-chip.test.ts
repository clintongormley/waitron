import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import type { ServiceStepDue } from "@waitron/shared";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { stepChip, stepChipStyles } from "./step-chip.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

class StepChipHost extends LitElement {
  static override styles = stepChipStyles;
  static override properties = { step: { attribute: false }, onDone: { attribute: false } };
  declare step: ServiceStepDue;
  declare onDone: () => void;
  override render() {
    return html`${stepChip(this.step, { onDone: this.onDone })}`;
  }
}
customElements.define("step-chip-test-host", StepChipHost);

const dessert: ServiceStepDue = {
  stepId: "0b6f7c1e-4a43-4a65-9d0c-7c1f4f0f2a11",
  name: "Dessert?",
  dueAt: "2026-10-22T21:42:00.000Z",
};

async function mount(step: ServiceStepDue = dessert, onDone: () => void = () => {}) {
  const { el, host } = await mountWidget<StepChipHost>("step-chip-test-host", { step, onDone });
  const root = el.shadowRoot!;
  return {
    el,
    host,
    chip: root.querySelector<HTMLElement>(".step-chip")!,
    name: root.querySelector<HTMLElement>(".step-name")!,
    done: root.querySelector<HTMLButtonElement>("button.step-done")!,
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

describe("stepChip", () => {
  it("draws the step's bell and name, then Done, keyed by the step", async () => {
    const { chip, name, done } = await mount();
    expect(chip.dataset.chip).toBe("service-step");
    expect(chip.dataset.step).toBe(dessert.stepId);
    expect(name.querySelector("wt-icon")!.getAttribute("name")).toBe("floor-step");
    expect(name.textContent!.trim()).toBe("Dessert?");
    expect(done.type).toBe("button");
    expect(done.dataset.stepDone).toBe(dessert.stepId);
    expect(done.textContent!.trim()).toBe("Done");
  });

  it("names the Done button after the step it clears", async () => {
    const { done } = await mount();
    expect(done.getAttribute("aria-label")).toBe("Done: Dessert?");
  });

  it("names the Done button after a step whose name holds a replacement pattern, as written", async () => {
    const { done } = await mount({ ...dessert, name: "Ask $& or $1" });
    expect(done.getAttribute("aria-label")).toBe("Done: Ask $& or $1");
  });

  it("calls onDone when Done is clicked", async () => {
    const onDone = vi.fn();
    const { done } = await mount(dessert, onDone);
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps Done's click from reaching the chip's ancestors", async () => {
    const onDone = vi.fn();
    const { host, done } = await mount(dessert, onDone);
    const ancestor = vi.fn();
    host.addEventListener("click", ancestor);
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(ancestor).not.toHaveBeenCalled();
  });

  it("paints each segment from its token", async () => {
    const { el, host, chip, name, done } = await mount();
    const tokens = {
      "--wt-color-primary": "rgb(1, 2, 3)",
      "--wt-color-on-primary": "rgb(4, 5, 6)",
      "--wt-color-surface-raised": "rgb(7, 8, 9)",
      "--wt-color-text": "rgb(10, 11, 12)",
      "--wt-radius-sm": "7px",
      "--wt-font-size-sm": "13px",
      "--wt-font-weight-bold": "800",
    };
    for (const [token, value] of Object.entries(tokens)) host.style.setProperty(token, value);
    await el.updateComplete;
    const chipStyle = getComputedStyle(chip);
    expect(chipStyle.borderTopColor).toBe(tokens["--wt-color-primary"]);
    expect(chipStyle.borderTopWidth).toBe("1px");
    expect(chipStyle.borderTopStyle).toBe("solid");
    expect(chipStyle.borderTopLeftRadius).toBe(tokens["--wt-radius-sm"]);
    const nameStyle = getComputedStyle(name);
    expect(nameStyle.backgroundColor).toBe(tokens["--wt-color-primary"]);
    expect(nameStyle.color).toBe(tokens["--wt-color-on-primary"]);
    const doneStyle = getComputedStyle(done);
    expect(doneStyle.backgroundColor).toBe(tokens["--wt-color-surface-raised"]);
    expect(doneStyle.color).toBe(tokens["--wt-color-text"]);
    expect(doneStyle.borderLeftColor).toBe(tokens["--wt-color-primary"]);
    expect(doneStyle.borderLeftWidth).toBe("1px");
    expect(doneStyle.borderLeftStyle).toBe("solid");
    for (const style of [nameStyle, doneStyle]) {
      expect(style.fontSize).toBe(tokens["--wt-font-size-sm"]);
      expect(style.fontWeight).toBe(tokens["--wt-font-weight-bold"]);
    }
  });

  it("gives Done a box at least the touch-target size each way", async () => {
    const { host, done } = await mount();
    const probe = document.createElement("div");
    probe.style.width = "var(--wt-tap-min)";
    probe.style.height = "var(--wt-tap-min)";
    host.appendChild(probe);
    const tap = probe.getBoundingClientRect();
    expect(tap.height).toBeGreaterThan(0);
    const box = done.getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(tap.height);
    expect(box.width).toBeGreaterThanOrEqual(tap.width);
  });

  it("holds Done to the touch-target width even when its label is narrow", async () => {
    const { el, host, done } = await mount();
    host.style.setProperty("--wt-space-3", "0px");
    host.style.setProperty("--wt-tap-min", "80px");
    await el.updateComplete;
    const box = done.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(80);
    expect(box.height).toBeGreaterThanOrEqual(80);
  });

  it("wraps a 40-character name inside the chip at 320 px", async () => {
    await page.viewport(320, 900);
    try {
      const long = { ...dessert, name: "W".repeat(40) };
      const { host, chip, name, done } = await mount(long);
      host.style.width = "100%";
      expect(window.innerWidth).toBe(320);
      expect(name.textContent!.trim()).toBe(long.name);
      const chipBox = chip.getBoundingClientRect();
      expect(chipBox.right).toBeLessThanOrEqual(320);
      expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
      expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(chipBox.right);
      expect(done.getBoundingClientRect().right).toBeLessThanOrEqual(chipBox.right);
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it("reads Done and its name in Spanish", async () => {
    setLocale("es");
    const { name, done } = await mount();
    expect(name.textContent!.trim()).toBe("Dessert?");
    expect(done.textContent!.trim()).toBe(es["floor.step_done"]);
    expect(done.getAttribute("aria-label")).toBe(
      es["floor.step_done_label"].replace("{step}", "Dessert?"),
    );
  });
});
