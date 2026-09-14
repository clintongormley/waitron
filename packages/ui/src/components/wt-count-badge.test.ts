import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtCountBadge } from "./wt-count-badge.js";
import "./wt-count-badge.js";

afterEach(cleanup);

const badge = (el: Element) => el.shadowRoot!.querySelector("span");

test("shows the count, capped at 99+", async () => {
  const el = (await mount('<wt-count-badge count="3"></wt-count-badge>')) as WtCountBadge;
  expect(badge(el)!.textContent).toBe("3");
  el.count = 120;
  await el.updateComplete;
  expect(badge(el)!.textContent).toBe("99+");
});

test("renders nothing at zero", async () => {
  const el = await mount('<wt-count-badge count="0"></wt-count-badge>');
  expect(badge(el)).toBeNull();
});

test.each([
  ["error", "--wt-color-danger", "--wt-color-on-danger"],
  ["warning", "--wt-color-warning", "--wt-color-on-warning"],
  ["neutral", "--wt-color-surface-raised", "--wt-color-text"],
] as const)("a %s badge paints from its tokens", async (tone, background, text) => {
  const el = await mount(`<wt-count-badge count="2" tone="${tone}"></wt-count-badge>`);
  host.style.setProperty(background, "rgb(1, 2, 3)");
  host.style.setProperty(text, "rgb(4, 5, 6)");
  const style = getComputedStyle(badge(el)!);
  expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(style.color).toBe("rgb(4, 5, 6)");
});
