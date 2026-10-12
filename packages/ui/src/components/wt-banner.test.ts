import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtBanner } from "./wt-banner.js";
import "./wt-banner.js";

afterEach(cleanup);

const action = (el: WtBanner) => el.shadowRoot!.querySelector("wt-button");
const button = (el: WtBanner) => action(el)?.shadowRoot!.querySelector("button") ?? null;
const message = (el: WtBanner) => el.shadowRoot!.querySelector(".message")!.textContent;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const shown = async (el: WtBanner) => {
  await nextFrame();
  await nextFrame();
  await el.updateComplete;
};

test("shows its message and its action, and is announced politely", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  expect(el.getAttribute("role")).toBe("status");
  await shown(el);
  expect(message(el)).toBe("Waitron was updated.");
  expect(action(el)!.getAttribute("variant")).toBe("primary");
  expect(action(el)!.textContent!.trim()).toBe("Reload");
});

test("draws its live region empty for a whole frame before putting the message in", async () => {
  const el = (await mount('<wt-banner message="Waitron was updated."></wt-banner>')) as WtBanner;
  expect(message(el)).toBe("");
  await nextFrame();
  await el.updateComplete;
  expect(message(el)).toBe("");
  await nextFrame();
  await el.updateComplete;
  expect(message(el)).toBe("Waitron was updated.");
});

test("empties its live region again when it is moved, and refills it two frames later", async () => {
  const el = (await mount('<wt-banner message="Waitron was updated."></wt-banner>')) as WtBanner;
  const move = async () => {
    el.remove();
    host.append(el);
    await el.updateComplete;
  };
  await shown(el);
  await move();
  expect(message(el)).toBe("");
  await nextFrame();
  await move();
  await nextFrame();
  await el.updateComplete;
  expect(message(el)).toBe("");
  await shown(el);
  expect(message(el)).toBe("Waitron was updated.");
});

test("a new message replaces the shown one", async () => {
  const el = (await mount('<wt-banner message="Waitron was updated."></wt-banner>')) as WtBanner;
  await shown(el);
  el.message = "Something else.";
  await el.updateComplete;
  expect(message(el)).toBe("Something else.");
});

test("keeps a role it was given", async () => {
  const el = (await mount('<wt-banner role="alert" message="x"></wt-banner>')) as WtBanner;
  expect(el.getAttribute("role")).toBe("alert");
});

test("draws no button without an action label", async () => {
  const el = (await mount('<wt-banner message="Waitron was updated."></wt-banner>')) as WtBanner;
  expect(action(el)).toBeNull();
  expect(el.shadowRoot!.querySelector("button")).toBeNull();
});

test("pressing the action sends one wt-banner-action and stops the click", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  const seen: Event[] = [];
  const record = (event: Event) => seen.push(event);
  for (const type of ["click", "wt-banner-action"]) document.addEventListener(type, record);
  try {
    await userEvent.click(button(el)!);
  } finally {
    for (const type of ["click", "wt-banner-action"]) document.removeEventListener(type, record);
  }
  expect(seen.map((event) => event.type)).toEqual(["wt-banner-action"]);
  const action = seen[0] as CustomEvent;
  expect(action.bubbles).toBe(true);
  expect(action.composed).toBe(true);
  expect(action.detail).toEqual({});
});

test.each(["{Enter}", " "])("the keyboard presses the action too (%s)", async (key) => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  const pressed = vi.fn();
  el.addEventListener("wt-banner-action", pressed);
  button(el)!.focus();
  await userEvent.keyboard(key);
  expect(pressed).toHaveBeenCalledOnce();
});

test("paints the strip and its action from tokens", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  host.style.setProperty("--wt-color-surface-raised", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-primary", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-on-primary", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-tap-min", "51px");
  const strip = getComputedStyle(el);
  expect(strip.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(strip.color).toBe("rgb(4, 5, 6)");
  expect(strip.borderBottomColor).toBe("rgb(7, 8, 9)");
  expect(strip.borderLeftColor).toBe("rgb(10, 11, 12)");
  const painted = getComputedStyle(button(el)!);
  expect(painted.backgroundColor).toBe("rgb(10, 11, 12)");
  expect(painted.color).toBe("rgb(13, 14, 15)");
  expect(painted.minHeight).toBe("51px");
});
