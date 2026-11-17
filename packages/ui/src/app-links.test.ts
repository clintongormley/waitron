import { isDashboardPath } from "@waitron/shared";
import { afterEach, expect, it, vi } from "vitest";
import { captureAppLinks, leftToBrowser } from "./app-links.js";
import { NavigationGuard } from "./navigation-guard.js";

const originalUrl = location.href;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  history.replaceState(null, "", originalUrl);
});

/** A host with an anchor inside it; `inner` sees every click that reaches the anchor's own
 *  listeners, and `bubbled` every click that bubbles past the host. */
function fixture(attributes: Record<string, string> = { href: "/x?y=1" }) {
  const host = document.createElement("div");
  const anchor = document.createElement("a");
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
  anchor.textContent = "link";
  host.append(anchor);
  document.body.append(host);
  const opened: string[] = [];
  const inner: boolean[] = [];
  const bubbled: boolean[] = [];
  anchor.addEventListener("click", (event) => {
    inner.push(event.defaultPrevented);
    event.preventDefault();
  });
  host.addEventListener("click", (event) => bubbled.push(event.defaultPrevented));
  const release = captureAppLinks(host, isDashboardPath, (url) =>
    opened.push(url.pathname + url.search),
  );
  cleanups.push(() => {
    release();
    host.remove();
  });
  return { host, anchor, opened, inner, bubbled, release };
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

it("captures an in-app link: opens it, cancels the browser's navigation and stops the click", () => {
  const { anchor, opened, inner, bubbled } = fixture();
  const event = click(anchor);
  expect(opened).toEqual(["/x?y=1"]);
  expect(event.defaultPrevented).toBe(true);
  expect(inner).toEqual([]);
  expect(bubbled).toEqual([]);
});

it("captures the bare root address", () => {
  const { anchor, opened } = fixture({ href: "/" });
  click(anchor);
  expect(opened).toEqual(["/"]);
});

it("captures a link whose target is _self", () => {
  const { anchor, opened } = fixture({ href: "/x", target: "_self" });
  click(anchor);
  expect(opened).toEqual(["/x"]);
});

it("captures a link inside a shadow root through the composed path", () => {
  const host = document.createElement("div");
  const inside = document.createElement("span");
  const root = inside.attachShadow({ mode: "open" });
  const anchor = document.createElement("a");
  anchor.href = "/shadow";
  const label = document.createElement("b");
  anchor.append(label);
  root.append(anchor);
  host.append(inside);
  document.body.append(host);
  const opened: string[] = [];
  const release = captureAppLinks(host, isDashboardPath, (url) => opened.push(url.pathname));
  cleanups.push(() => {
    release();
    host.remove();
  });
  const event = click(label);
  expect(opened).toEqual(["/shadow"]);
  expect(event.defaultPrevented).toBe(true);
});

it("leaves a click another listener already cancelled alone", () => {
  const { anchor, opened, bubbled } = fixture();
  const outer = (event: Event) => event.preventDefault();
  document.addEventListener("click", outer, true);
  cleanups.push(() => document.removeEventListener("click", outer, true));
  click(anchor);
  expect(opened).toEqual([]);
  expect(bubbled).toEqual([true]);
});

it("ignores a click with no anchor in its path", () => {
  const { host, opened, bubbled } = fixture();
  const span = document.createElement("span");
  host.append(span);
  const event = click(span);
  expect(opened).toEqual([]);
  expect(event.defaultPrevented).toBe(false);
  expect(bubbled).toEqual([false]);
});

it("ignores an anchor without an href", () => {
  const { anchor, opened, inner } = fixture({});
  const event = click(anchor);
  expect(opened).toEqual([]);
  expect(inner).toEqual([false]);
  expect(event.defaultPrevented).toBe(true);
});

it("cancels a disabled anchor's navigation without opening it, and its own handler still runs", () => {
  const { anchor, opened, inner, bubbled } = fixture({
    href: "/x",
    "aria-disabled": "true",
  });
  click(anchor);
  expect(opened).toEqual([]);
  expect(inner).toEqual([true]);
  expect(bubbled).toEqual([true]);
});

it("still captures an anchor whose aria-disabled is not true", () => {
  const { anchor, opened } = fixture({ href: "/x", "aria-disabled": "false" });
  click(anchor);
  expect(opened).toEqual(["/x"]);
});

it.each<[string, MouseEventInit]>([
  ["another button", { button: 1 }],
  ["control", { ctrlKey: true }],
  ["meta", { metaKey: true }],
  ["shift", { shiftKey: true }],
  ["alt", { altKey: true }],
])("leaves a click with %s to the browser", (_name, init) => {
  const { anchor, opened, inner, bubbled } = fixture();
  click(anchor, init);
  expect(opened).toEqual([]);
  expect(inner).toEqual([false]);
  expect(bubbled).toEqual([true]);
});

it.each<[string, Record<string, string>]>([
  ["data-own-click", { href: "/x", "data-own-click": "" }],
  ["download", { href: "/x", download: "" }],
  ["a fragment href", { href: "#manage" }],
  ["another target", { href: "/x", target: "_blank" }],
  ["another origin", { href: "https://example.invalid/x" }],
  ["a till path", { href: "/till/" }],
])("leaves an anchor with %s to its own handling", (_name, attributes) => {
  history.replaceState(null, "", "/start");
  const { anchor, opened, inner, bubbled } = fixture(attributes);
  click(anchor);
  expect(opened).toEqual([]);
  expect(inner).toEqual([false]);
  expect(bubbled).toEqual([true]);
});

it("writes through the window's navigation guard by default", () => {
  history.replaceState(null, "", "/start");
  const guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: () => Promise.resolve("proceeded"),
  });
  cleanups.push(() => guard.dispose());
  const host = document.createElement("div");
  const anchor = document.createElement("a");
  anchor.href = "/next?q=1";
  host.append(anchor);
  document.body.append(host);
  const release = captureAppLinks(host, isDashboardPath);
  cleanups.push(() => {
    release();
    host.remove();
  });
  const push = vi.spyOn(history, "pushState");
  cleanups.push(() => push.mockRestore());
  click(anchor);
  expect(push).toHaveBeenCalledTimes(1);
  expect(location.pathname + location.search).toBe("/next?q=1");
});

it("the release function stops capturing", () => {
  const { anchor, opened, inner, release } = fixture();
  release();
  click(anchor);
  expect(opened).toEqual([]);
  expect(inner).toEqual([false]);
});

it("leftToBrowser is true for another button or any modifier and false for a plain click", () => {
  expect(leftToBrowser(new MouseEvent("click"))).toBe(false);
  expect(leftToBrowser(new MouseEvent("click", { button: 2 }))).toBe(true);
  expect(leftToBrowser(new MouseEvent("click", { ctrlKey: true }))).toBe(true);
  expect(leftToBrowser(new MouseEvent("click", { metaKey: true }))).toBe(true);
  expect(leftToBrowser(new MouseEvent("click", { shiftKey: true }))).toBe(true);
  expect(leftToBrowser(new MouseEvent("click", { altKey: true }))).toBe(true);
});
