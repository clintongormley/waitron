import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { openSentDish, openSentMore } from "./till-table-order-screen.sent.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { mount } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it.each(["detailed", "fallback"] as const)(
  "%s held dishes use Recall instead of the drawer's direct group Move and Split",
  async (read) => {
    const { el } = await mount({
      orderId: "wo-4",
      editSentLines: true,
      lines: [storedDish],
      groups: [{ ...orderGroup("held", 1, "held"), lineIds: [storedDish.id] }],
      currentOrders:
        read === "fallback"
          ? null
          : current({
              groups: [
                currentGroup("held", 1, "held", [
                  row(storedDish.id, "Recorded dish", "2.000", {
                    lineNo: 1,
                    released: false,
                    kitchen: null,
                    netAmount: "6.50",
                  }),
                ]),
              ],
              ungrouped: [],
              reminder: null,
            }),
    });
    const recalls: CustomEvent[] = [];
    const direct: CustomEvent[] = [];
    el.addEventListener("recall-lines", (event) => recalls.push(event as CustomEvent));
    for (const type of ["move-group-line", "split-group-line"]) {
      el.addEventListener(type, (event) => direct.push(event as CustomEvent));
    }
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    const drawer = el.shadowRoot!.querySelector("[data-drawer]")!;
    expect(drawer.querySelector("[data-move-line], [data-split-group-line]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-move-dialog]")).toBeNull();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    if (read === "fallback") {
      const fallback = el.shadowRoot!.querySelector('[data-sent-fallback-line="stored-dish"]')!;
      expect(fallback.textContent).toContain("Recorded dish");
      expect(fallback.querySelector("button, wt-button, wt-row-actions")).toBeNull();
      expect(recalls).toEqual([]);
      expect(direct).toEqual([]);
      return;
    }
    await openSentDish(el, storedDish.id, "held");
    await openSentMore(el);
    const recall = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-recall]")!;
    expect(recall.checkVisibility()).toBe(true);
    await userEvent.click(recall);
    expect(recalls.map((event) => event.detail)).toEqual([{ lineNos: [1] }]);
    expect(recalls[0]!.bubbles && recalls[0]!.composed).toBe(true);
    expect(direct).toEqual([]);
  },
);
