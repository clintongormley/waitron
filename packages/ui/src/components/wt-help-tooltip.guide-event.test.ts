import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";

let listeners = new AbortController();

afterEach(() => {
  listeners.abort();
  listeners = new AbortController();
  cleanup();
});

const HREF = "/guide/products#selling-unit";

async function openBadge() {
  const container = await mount(
    '<div style="position: relative; padding: var(--wt-space-5)">' +
      `<wt-help-tooltip aria-label="Help: Selling unit" guide-href="${HREF}" guide-label="Read more">` +
      "The unit you sell it in.</wt-help-tooltip></div>",
  );
  const badge = container.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  await badge.updateComplete;
  const root = badge.shadowRoot!;
  const button = root.querySelector("button")!;
  const popup = root.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(button);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  const link = root.querySelector<HTMLAnchorElement>("a[part=guide]")!;
  return { container, badge, popup, link };
}

function click(link: HTMLAnchorElement): boolean {
  return link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
}

/** Records the click's state after the badge has handled it, and keeps the test page from opening it. */
function holdTheLink(link: HTMLAnchorElement): boolean[] {
  const prevented: boolean[] = [];
  link.addEventListener(
    "click",
    (event) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    },
    { signal: listeners.signal },
  );
  return prevented;
}

function cancelGuideOpen(target: EventTarget): CustomEvent<{ href: string }>[] {
  const seen: CustomEvent<{ href: string }>[] = [];
  target.addEventListener(
    "wt-guide-open",
    (event) => {
      seen.push(event as CustomEvent<{ href: string }>);
      event.preventDefault();
    },
    { signal: listeners.signal },
  );
  return seen;
}

test("a click on the guide link dispatches wt-guide-open with its href, from the badge", async () => {
  const { badge, link } = await openBadge();
  const seen = cancelGuideOpen(document);
  const targets: EventTarget[] = [];
  document.addEventListener("wt-guide-open", (event) => targets.push(event.target!), {
    signal: listeners.signal,
  });
  click(link);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.detail).toEqual({ href: HREF });
  expect(seen[0]!.bubbles).toBe(true);
  expect(seen[0]!.composed).toBe(true);
  expect(targets).toEqual([badge]);
});

test("a listener that cancels it stops the link opening", async () => {
  const { container, link } = await openBadge();
  cancelGuideOpen(container);
  expect(click(link)).toBe(false);
});

test("the click does not reach a listener above the badge", async () => {
  const { container, link } = await openBadge();
  cancelGuideOpen(container);
  const clicks: Event[] = [];
  container.addEventListener("click", (event) => clicks.push(event));
  document.addEventListener("click", (event) => clicks.push(event), { signal: listeners.signal });
  click(link);
  expect(clicks).toEqual([]);
});

test("uncancelled, the link opens as before", async () => {
  const { container, link } = await openBadge();
  const seen: Event[] = [];
  container.addEventListener("wt-guide-open", (event) => seen.push(event));
  const prevented = holdTheLink(link);
  click(link);
  expect(seen).toHaveLength(1);
  expect(prevented).toEqual([false]);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("href")).toBe(HREF);
});

test.each([
  ["cancelled", true],
  ["not cancelled", false],
])("the box closes when the event is %s", async (_name, cancel) => {
  const { container, popup, link } = await openBadge();
  if (cancel) cancelGuideOpen(container);
  else holdTheLink(link);
  click(link);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
});

test("Enter on the focused link does the same", async () => {
  const { badge, popup, link } = await openBadge();
  const seen = cancelGuideOpen(host);
  const prevented: boolean[] = [];
  link.addEventListener("click", (event) => prevented.push(event.defaultPrevented));
  await userEvent.keyboard("{Tab}");
  expect(badge.shadowRoot!.activeElement).toBe(link);
  await userEvent.keyboard("{Enter}");
  expect(seen.map((event) => event.detail)).toEqual([{ href: HREF }]);
  expect(prevented).toEqual([true]);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
});
