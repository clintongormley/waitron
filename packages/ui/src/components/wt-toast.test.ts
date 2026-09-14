import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { WtToast } from "./wt-toast.js";
import "./wt-toast.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const part = (el: Element, selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector);

test("shows the message in a polite region, or an assertive one for an error", async () => {
  const el = (await mount(
    '<wt-toast open message="3 new alerts" close-label="Close"></wt-toast>',
  )) as WtToast;
  expect(part(el, '[role="status"] .message')!.textContent).toBe("3 new alerts");
  expect(part(el, '[role="alert"] .toast')).toBeNull();
  el.tone = "error";
  await el.updateComplete;
  expect(part(el, '[role="alert"] .message')!.textContent).toBe("3 new alerts");
  expect(part(el, '[role="status"] .toast')).toBeNull();
});

test("renders nothing inside its regions while closed", async () => {
  const el = await mount('<wt-toast message="Hidden"></wt-toast>');
  expect(part(el, ".toast")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(2);
});

test("closes itself after its duration and says so", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="8000"></wt-toast>')) as WtToast;
  const closed = vi.fn();
  el.addEventListener("wt-close", closed);
  vi.advanceTimersByTime(7_999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
  expect(closed).toHaveBeenCalledOnce();
});

test("pauses while hovered and restarts the full duration after", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  const toast = part(el, ".toast")!;
  vi.advanceTimersByTime(900);
  toast.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
  toast.dispatchEvent(new MouseEvent("mouseleave"));
  vi.advanceTimersByTime(999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
});

test("keyboard focus inside pauses the timer until focus leaves", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  part(el, ".message")!.focus();
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
  part(el, ".message")!.blur();
  vi.advanceTimersByTime(999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
});

test("a new message while hovered does not start the countdown", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  part(el, ".toast")!.dispatchEvent(new MouseEvent("mouseenter"));
  el.message = "Two new alerts";
  await el.updateComplete;
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
});

test("focus leaving while hovered stays paused", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  const toast = part(el, ".toast")!;
  toast.dispatchEvent(new MouseEvent("mouseenter"));
  part(el, ".message")!.focus();
  part(el, ".message")!.blur();
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
  toast.dispatchEvent(new MouseEvent("mouseleave"));
  vi.advanceTimersByTime(999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
});

test("the pointer leaving while focus stays inside stays paused", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  const toast = part(el, ".toast")!;
  part(el, ".message")!.focus();
  toast.dispatchEvent(new MouseEvent("mouseenter"));
  toast.dispatchEvent(new MouseEvent("mouseleave"));
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
  part(el, ".message")!.blur();
  vi.advanceTimersByTime(999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
});

test("show() opens it, and on an open toast restarts the full countdown", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast message="Hi" duration="1000"></wt-toast>')) as WtToast;
  el.show();
  await el.updateComplete;
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(900);
  // The same message again changes no property, so only show() can restart the countdown.
  el.show();
  await el.updateComplete;
  vi.advanceTimersByTime(999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
});

test("show() does not start the countdown while hovered", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  part(el, ".toast")!.dispatchEvent(new MouseEvent("mouseenter"));
  el.show();
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
});

test("closing while hovered does not leave a reopened toast paused", async () => {
  // Closing removes the hovered element, so no mouseleave ever arrives for it.
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  part(el, ".toast")!.dispatchEvent(new MouseEvent("mouseenter"));
  part(el, ".close")!.click();
  await el.updateComplete;
  el.show();
  await el.updateComplete;
  vi.advanceTimersByTime(1_000);
  expect(el.open).toBe(false);
});

test("its events cross shadow boundaries and swallow the click that caused them", async () => {
  // Inside a shadow root, only a composed event reaches a document listener.
  const el = (await mountInShadowRoot(
    '<wt-toast open message="Hi" close-label="Close"></wt-toast>',
  )) as WtToast;
  const seen: string[] = [];
  const record = (event: Event) => seen.push(event.type);
  for (const type of ["wt-activate", "wt-close", "click"]) document.addEventListener(type, record);
  try {
    part(el, ".message")!.click();
    el.open = true;
    await el.updateComplete;
    part(el, ".close")!.click();
  } finally {
    for (const type of ["wt-activate", "wt-close", "click"])
      document.removeEventListener(type, record);
  }
  expect(seen).toEqual(["wt-activate", "wt-close", "wt-close"]);
});

test("pressing the message activates and closes; the close button only closes", async () => {
  const el = (await mount(
    '<wt-toast open message="Hi" close-label="Close"></wt-toast>',
  )) as WtToast;
  const activated = vi.fn();
  const closed = vi.fn();
  host.addEventListener("wt-activate", activated);
  host.addEventListener("wt-close", closed);
  part(el, ".message")!.click();
  expect(activated).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledOnce();
  el.open = true;
  await el.updateComplete;
  part(el, ".close")!.click();
  expect(activated).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledTimes(2);
});

test("an error toast marks its edge with the danger token", async () => {
  const el = await mount('<wt-toast open tone="error" message="Hi"></wt-toast>');
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");
  expect(getComputedStyle(part(el, ".toast")!).borderInlineStartColor).toBe("rgb(1, 2, 3)");
});

test("an info toast marks its edge with the primary token", async () => {
  const el = await mount('<wt-toast open message="Hi"></wt-toast>');
  host.style.setProperty("--wt-color-primary", "rgb(4, 5, 6)");
  expect(getComputedStyle(part(el, ".toast")!).borderInlineStartColor).toBe("rgb(4, 5, 6)");
});
