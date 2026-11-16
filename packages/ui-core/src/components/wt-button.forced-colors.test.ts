import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-button.js";

afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

test("a link keeps its size and has system text, no border box and a visible focus in contrast themes", async () => {
  const el = await mount('<wt-button variant="link">Another shift…</wt-button>');
  const button = el.shadowRoot!.querySelector("button")!;
  const { width, height } = button.getBoundingClientRect();
  await emulateForcedColours("active");
  const system = document.createElement("span");
  el.parentElement!.append(system);
  system.style.color = "Canvas";
  expect(getComputedStyle(button).borderTopColor).toBe(getComputedStyle(system).color);
  system.style.color = "ButtonText";
  expect(getComputedStyle(button).color).toBe(getComputedStyle(system).color);
  expect(button.getBoundingClientRect().width).toBe(width);
  expect(button.getBoundingClientRect().height).toBe(height);
  await userEvent.tab();
  expect(button.matches(":focus-visible")).toBe(true);
  system.style.color = "Highlight";
  expect(getComputedStyle(button).outlineColor).toBe(getComputedStyle(system).color);
  expect(parseFloat(getComputedStyle(button).outlineWidth)).toBeGreaterThan(0);
  el.setAttribute("disabled", "");
  await (el as HTMLElementTagNameMap["wt-button"]).updateComplete;
  system.style.color = "GrayText";
  expect(getComputedStyle(button).color).toBe(getComputedStyle(system).color);
});
