import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

afterEach(cleanup);

async function mountCombobox(html = '<wt-combobox label="Dietary tags"></wt-combobox>') {
  const el = (await mount(html)) as WtCombobox;
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
  const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  return { el, trigger, popup };
}

test("renders its label", async () => {
  const { el } = await mountCombobox();
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Dietary tags");
});

test("opens the panel on trigger click and reflects aria-expanded", async () => {
  const { trigger, popup } = await mountCombobox();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  expect(popup.matches(":popover-open")).toBe(true);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
});

test("closes on Escape and returns focus to the trigger", async () => {
  const { el, trigger, popup } = await mountCombobox();
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("positions the popup against the trigger before the first painted frame", async () => {
  const { trigger, popup } = await mountCombobox();
  const firstFrame = new Promise<DOMRect>((resolve) => {
    trigger.addEventListener(
      "click",
      () => requestAnimationFrame(() => resolve(popup.getBoundingClientRect())),
      { once: true },
    );
  });
  await userEvent.click(trigger);
  const bounds = await firstFrame;
  const anchor = trigger.getBoundingClientRect();
  expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
  expect(bounds.left).toBeCloseTo(anchor.left, 0);
});

test("does not open when disabled", async () => {
  const { trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" disabled></wt-combobox>',
  );
  await userEvent.click(trigger, { force: true });
  expect(popup.matches(":popover-open")).toBe(false);
});

test("meets the tap target and paints from the theme tokens", async () => {
  const { trigger } = await mountCombobox();
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(trigger).borderColor).toBe("rgb(1, 2, 3)");
});
