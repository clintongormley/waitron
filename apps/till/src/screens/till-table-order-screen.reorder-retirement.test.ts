import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it.each([390, 1280])(
  "reorders from Sent alone at %s px, including when the bill drawer opens",
  async (width) => {
    const { el } = await mount({ orderId: "wo-4", groups, currentOrders: current(), now });
    el.style.width = `${width}px`;
    await resized(el);
    const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) {
      await userEvent.click(review);
      await el.updateComplete;
    }
    const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
    await panel.updateComplete;
    for (const selector of ["[data-sent-toggle]", "[data-held-toggle]"]) {
      const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
      if (toggle.getAttribute("aria-expanded") === "false") {
        await userEvent.click(toggle);
        await panel.updateComplete;
      }
    }
    const reorders: CustomEvent[] = [];
    el.addEventListener("reorder-groups", (event) => reorders.push(event as CustomEvent));
    const menu = panel.shadowRoot!.querySelector<WtRowActions>('[data-group-more="g3"]')!;
    await menu.updateComplete;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
    await userEvent.click(menu.querySelector<HTMLElement>("[data-group-later]")!);
    expect(reorders.map((event) => event.detail)).toEqual([{ heldGroupIds: ["g4", "g3"] }]);
    expect(reorders[0]!.bubbles && reorders[0]!.composed).toBe(true);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-drawer]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-group-up], [data-group-down]")).toBeNull();
  },
);
