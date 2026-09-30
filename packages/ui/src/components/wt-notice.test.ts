import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { WtNotice } from "./wt-notice.js";
import "./wt-notice.js";

const REDUCE = "(prefers-reduced-motion: reduce)";
let restoreMatchMedia: (() => void) | undefined;

afterEach(() => {
  vi.useRealTimers();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  cleanup();
});

function stubReducedMotion(matches: boolean): void {
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    query === REDUCE
      ? ({ matches, media: REDUCE } as MediaQueryList)
      : original(query)) as typeof window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = original;
  };
}

const fakeTimeouts = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const body = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>("span")!;
const closed = (el: Element) =>
  new Promise<Event>((resolve) => el.addEventListener("wt-notice-gone", resolve, { once: true }));

test("announces its words politely, as a status region", async () => {
  const el = await mount("<wt-notice>Unpaired</wt-notice>");
  expect(el.getAttribute("role")).toBe("status");
  expect(el.textContent).toBe("Unpaired");
  expect(el.hidden).toBe(false);
});

test("keeps a role its consumer gave it", async () => {
  const el = await mount('<wt-notice role="alert">Unpaired</wt-notice>');
  expect(el.getAttribute("role")).toBe("alert");
});

test("stays for four seconds when given no duration", async () => {
  fakeTimeouts();
  const el = (await mount("<wt-notice>Unpaired</wt-notice>")) as WtNotice;
  expect(el.duration).toBe(4000);
  vi.advanceTimersByTime(3_999);
  await el.updateComplete;
  expect(body(el).classList.contains("fading")).toBe(false);
  vi.advanceTimersByTime(1);
  await el.updateComplete;
  expect(body(el).classList.contains("fading")).toBe(true);
});

test("fades over the fade token's time, then hides itself and says it has gone", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  el.reducedMotion = false;
  host.style.setProperty("--wt-duration-fade", "40ms");
  const gone = closed(el);
  vi.advanceTimersByTime(1_000);
  await el.updateComplete;
  const style = getComputedStyle(body(el));
  expect(style.animationName).toBe("wt-notice-fade");
  expect(style.animationDuration).toBe("0.04s");
  expect(el.hidden).toBe(false);
  vi.useRealTimers();
  const event = (await gone) as CustomEvent;
  expect(event.detail).toEqual({});
  expect(el.hidden).toBe(true);
  expect(getComputedStyle(el).display).toBe("none");
});

test("with the reader's reduced-motion preference it goes at once, without fading", async () => {
  stubReducedMotion(true);
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  const gone = vi.fn();
  el.addEventListener("wt-notice-gone", gone);
  vi.advanceTimersByTime(1_000);
  expect(gone).toHaveBeenCalledOnce();
  expect(el.hidden).toBe(true);
  expect(body(el).classList.contains("fading")).toBe(false);
});

test("without that preference it fades rather than going at once", async () => {
  stubReducedMotion(false);
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  const gone = vi.fn();
  el.addEventListener("wt-notice-gone", gone);
  vi.advanceTimersByTime(1_000);
  await el.updateComplete;
  expect(gone).not.toHaveBeenCalled();
  expect(el.hidden).toBe(false);
  expect(body(el).classList.contains("fading")).toBe(true);
});

test("a reduced-motion override set on the element wins over the media query", async () => {
  stubReducedMotion(false);
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  vi.advanceTimersByTime(1_000);
  expect(el.hidden).toBe(true);
});

test("a duration of 0 keeps it until something else takes it away", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="0">Pairing failed</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  vi.advanceTimersByTime(60_000);
  expect(el.hidden).toBe(false);
});

test("a duration set to 0 while it counts down keeps it", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Paired</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  vi.advanceTimersByTime(900);
  el.duration = 0;
  await el.updateComplete;
  vi.advanceTimersByTime(60_000);
  expect(el.hidden).toBe(false);
});

test("a new duration is counted from when it was set", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="0">Pairing…</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  vi.advanceTimersByTime(5_000);
  el.duration = 1000;
  await el.updateComplete;
  vi.advanceTimersByTime(999);
  expect(el.hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(el.hidden).toBe(true);
});

test("taken off the page it stops counting and never says it has gone", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  const gone = vi.fn();
  el.addEventListener("wt-notice-gone", gone);
  el.remove();
  vi.advanceTimersByTime(5_000);
  expect(gone).not.toHaveBeenCalled();
  expect(el.hidden).toBe(false);
});

test("put back on the page it counts its full duration again", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  vi.advanceTimersByTime(900);
  el.remove();
  host.append(el);
  vi.advanceTimersByTime(999);
  expect(el.hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(el.hidden).toBe(true);
});

test("taking it off the page tells a controller the consumer attached to it", async () => {
  const el = (await mount("<wt-notice>Unpaired</wt-notice>")) as WtNotice;
  const gone = vi.fn();
  el.addController({ hostDisconnected: gone });
  el.remove();
  expect(gone).toHaveBeenCalledOnce();
});

test("its going crosses shadow boundaries", async () => {
  fakeTimeouts();
  const el = (await mountInShadowRoot(
    '<wt-notice duration="1000">Unpaired</wt-notice>',
  )) as WtNotice;
  el.reducedMotion = true;
  const seen = vi.fn();
  document.addEventListener("wt-notice-gone", seen);
  try {
    vi.advanceTimersByTime(1_000);
  } finally {
    document.removeEventListener("wt-notice-gone", seen);
  }
  expect(seen).toHaveBeenCalledOnce();
});

test("an animation ending inside its words does not take it away", async () => {
  const el = (await mount('<wt-notice duration="0"><b>Paired</b></wt-notice>')) as WtNotice;
  el.querySelector("b")!.dispatchEvent(new AnimationEvent("animationend", { bubbles: true }));
  await el.updateComplete;
  expect(el.hidden).toBe(false);
});

test("its going is not a wt-close, so a dialog it sits in does not take it for its own", async () => {
  fakeTimeouts();
  const el = (await mount('<wt-notice duration="1000">Unpaired</wt-notice>')) as WtNotice;
  el.reducedMotion = true;
  const close = vi.fn();
  host.addEventListener("wt-close", close);
  vi.advanceTimersByTime(1_000);
  expect(el.hidden).toBe(true);
  expect(close).not.toHaveBeenCalled();
});
