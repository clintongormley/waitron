import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

const ALWAYS_WIDTH = 300 - 44 - 8;

async function mountBadge(
  attributes = 'mode="help-mode"',
  containerStyle = "",
): Promise<{ container: HTMLElement; span: HTMLElement; badge: WtHelpTooltip }> {
  const container = await mount(
    `<div style="position: relative; display: flex; gap: 8px; width: 300px; ${containerStyle}">` +
      '<span style="flex: 1">Price</span>' +
      `<wt-help-tooltip ${attributes} aria-label="Help: Selling unit">The unit you sell it in.</wt-help-tooltip>` +
      "</div>",
  );
  const badge = container.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  await badge.updateComplete;
  return { container, span: container.querySelector("span")!, badge };
}

function parts(badge: WtHelpTooltip) {
  const root = badge.shadowRoot!;
  return {
    button: root.querySelector("button")!,
    icon: root.querySelector<HTMLElement>(".icon")!,
    popup: root.querySelector<HTMLElement>("[popover]")!,
  };
}

async function turnHelp(on: boolean, badge: WtHelpTooltip): Promise<void> {
  setHelpMode(on);
  await badge.updateComplete;
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

test("while help is off it takes no room and cannot be reached", async () => {
  const { span, badge } = await mountBadge();
  expect(span.getBoundingClientRect().width).toBe(300);
  expect(badge.checkVisibility()).toBe(false);
  parts(badge).button.focus();
  expect(badge.shadowRoot!.activeElement).toBeNull();

  cleanup();
  const always = await mountBadge('mode="always"');
  expect(always.span.getBoundingClientRect().width).toBe(ALWAYS_WIDTH);
});

test("while help is on it hangs over its box's top trailing corner and still takes no room", async () => {
  const { container, span, badge } = await mountBadge();
  await turnHelp(true, badge);
  expect(span.getBoundingClientRect().width).toBe(300);
  const corner = container.getBoundingClientRect();
  const centre = centreOf(parts(badge).button);
  expect(Math.abs(centre.x - corner.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - corner.top)).toBeLessThanOrEqual(1);
});

test("in a right-to-left page it hangs over the top left corner", async () => {
  const { container, badge } = await mountBadge();
  container.setAttribute("dir", "rtl");
  await turnHelp(true, badge);
  const corner = container.getBoundingClientRect();
  const centre = centreOf(parts(badge).button);
  expect(Math.abs(centre.x - corner.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - corner.top)).toBeLessThanOrEqual(1);
});

test("it is a 24px target around a 20px circle", async () => {
  const { badge } = await mountBadge();
  await turnHelp(true, badge);
  const { button, icon } = parts(badge);
  expect(button.getBoundingClientRect()).toMatchObject({ width: 24, height: 24 });
  expect(icon.getBoundingClientRect()).toMatchObject({ width: 20, height: 20 });
});

test("with no mode it is in always mode", async () => {
  const { badge } = await mountBadge("");
  expect(badge.mode).toBe("always");
  expect(badge.getAttribute("mode")).toBe("always");
});

test("larger sizes come from the same two tokens", async () => {
  const { badge } = await mountBadge();
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  await turnHelp(true, badge);
  const { button, icon } = parts(badge);
  expect(button.getBoundingClientRect()).toMatchObject({ width: 32, height: 32 });
  expect(icon.getBoundingClientRect()).toMatchObject({ width: 24, height: 24 });
});

test("paints from the primary tokens", async () => {
  const { badge } = await mountBadge();
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-on-primary", "rgb(4, 5, 6)");
  await turnHelp(true, badge);
  const style = getComputedStyle(parts(badge).icon);
  expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(style.color).toBe("rgb(4, 5, 6)");
});

test("turning help on and off shows and hides it again", async () => {
  const { badge } = await mountBadge();
  expect(badge.checkVisibility()).toBe(false);
  await turnHelp(true, badge);
  expect(badge.checkVisibility()).toBe(true);
  await turnHelp(false, badge);
  expect(badge.checkVisibility()).toBe(false);
});

test("tapping it opens its box, as always mode does", async () => {
  const { badge } = await mountBadge();
  await turnHelp(true, badge);
  const { button, popup } = parts(badge);
  await userEvent.click(button);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await badge.updateComplete;
  expect(button.getAttribute("aria-describedby")).toBe(popup.id);
});

test("turning help off closes an open box and stops watching for Escape", async () => {
  const { badge } = await mountBadge();
  await turnHelp(true, badge);
  const { button, popup } = parts(badge);
  await userEvent.click(button);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));

  await turnHelp(false, badge);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("false"));
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
});

test("hide() closes an open box, and does nothing before the first render", async () => {
  const { badge } = await mountBadge();
  await turnHelp(true, badge);
  const { button, popup } = parts(badge);
  await userEvent.click(button);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));

  badge.hide();
  expect(popup.matches(":popover-open")).toBe(false);
  await vi.waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("false"));

  const bare = document.createElement("wt-help-tooltip");
  expect(() => bare.hide()).not.toThrow();
});

test("always mode ignores the switch", async () => {
  const { span, badge } = await mountBadge('mode="always"');
  expect(badge.checkVisibility()).toBe(true);
  await turnHelp(true, badge);
  expect(badge.checkVisibility()).toBe(true);
  expect(span.getBoundingClientRect().width).toBe(ALWAYS_WIDTH);
  expect(getComputedStyle(parts(badge).icon).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

test("a mode it does not know draws as always", async () => {
  const { span, badge } = await mountBadge('mode="banana"');
  expect(badge.checkVisibility()).toBe(true);
  expect(span.getBoundingClientRect().width).toBe(ALWAYS_WIDTH);
});

test("a badge put back after help changed shows the current state", async () => {
  const { container, badge } = await mountBadge();
  expect(badge.checkVisibility()).toBe(false);
  badge.remove();
  setHelpMode(true);
  container.append(badge);
  await badge.updateComplete;
  expect(badge.checkVisibility()).toBe(true);
});
