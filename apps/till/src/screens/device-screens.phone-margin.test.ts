import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import indexHtml from "../../index.html?raw";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import type { TillApi } from "../api/client.js";
import { mount as mountTableOrder } from "./till-table-order-screen.test-helpers.js";
import "./till-floor-screen.js";
import "./till-expo-screen.js";
import "./till-station-screen.js";
import "./till-counter-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";

const DEFAULT_FRAME = [414, 896] as const;

const pageStyleText = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
let pageStyle: HTMLStyleElement | undefined;

afterEach(async () => {
  cleanupWidgets();
  pageStyle?.remove();
  pageStyle = undefined;
  document.documentElement.removeAttribute("data-wt-theme-root");
  await page.viewport(...DEFAULT_FRAME);
});

/** An api whose every call stays pending, so a screen renders its frame and nothing it fetches. */
const pendingApi = new Proxy(
  {},
  { get: (_target, key) => (key === "then" ? undefined : () => new Promise(() => {})) },
) as TillApi;

async function onPage(width: number): Promise<void> {
  await page.viewport(width, 900);
  expect(window.innerWidth).toBe(width);
  pageStyle = document.createElement("style");
  pageStyle.textContent = pageStyleText;
  document.head.append(pageStyle);
  applyTokens(document.documentElement);
}

/** Where the screen's content starts and how wide it is, after every padding around it. */
function contentBox(el: HTMLElement, selector: string): { left: number; width: number } {
  const box = el.shadowRoot!.querySelector<HTMLElement>(selector)!;
  const rect = box.getBoundingClientRect();
  const style = getComputedStyle(box);
  const left = parseFloat(style.paddingLeft);
  const right = parseFloat(style.paddingRight);
  return { left: rect.left + left, width: rect.width - left - right };
}

const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [{ type: "basket", colSpan: 12, rowSpan: 1, config: {} }],
};

const screens: [string, () => Promise<HTMLElement>, string][] = [
  [
    "floor",
    async () =>
      (await mountWidget("till-floor-screen", { embedded: true, zones: [], tables: [] } as never))
        .el,
    ".screen",
  ],
  ["table order", async () => (await mountTableOrder({ embedded: true })).el, ".screen"],
  [
    "expo",
    async () =>
      (await mountWidget("till-expo-screen", { embedded: true, api: pendingApi } as never)).el,
    ".screen",
  ],
  [
    "station",
    async () => (await mountWidget("till-station-screen", { api: pendingApi } as never)).el,
    ".screen",
  ],
  [
    "counter",
    async () =>
      (
        await mountWidget("till-counter-screen", {
          counterTab,
          store: new WorkingOrderStore(),
          operatorName: "Ana",
        } as never)
      ).el,
    ".body.grid-body",
  ],
];

describe("device screens at phone width", () => {
  it("index.html narrows its body at the till's own phone width", () => {
    expect(pageStyleText).toContain(`@media ${PHONE_WIDTH}`);
  });

  for (const [name, mount, selector] of screens) {
    it(`the ${name} screen's content starts 8px from the edge of a 411px phone`, async () => {
      await onPage(411);
      const el = await mount();
      expect(contentBox(el, selector)).toEqual({ left: 8, width: 395 });
    });

    it(`the ${name} screen keeps its 1280px till spacing`, async () => {
      await onPage(1280);
      const el = await mount();
      expect(contentBox(el, selector)).toEqual({ left: 40, width: 1200 });
    });
  }
});
