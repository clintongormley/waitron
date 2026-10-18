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
import { sentPanelFor } from "./till-table-order-screen.sent.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { mount } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it.each(["held", "fired"] as const)(
  "keeps %s firing and serving controls in Sent when opening the drawer",
  async (state) => {
    const dish = row("dish", "Recorded dish", "2.000", {
      released: state === "fired",
      servedQuantity: state === "fired" ? "1.000" : "0.000",
      netAmount: "8.00",
    });
    const { el } = await mount({
      orderId: "wo-4",
      fireControl: "waiter",
      groups: [orderGroup("group", 1, state)],
      currentOrders: current({
        groups: [currentGroup("group", 1, state, [dish])],
        ungrouped: [],
        reminder: null,
      }),
    });
    const panel = await sentPanelFor(el);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    const drawer = el.shadowRoot!.querySelector("[data-drawer]")!;
    expect(
      drawer.querySelector(
        "[data-group-fire], [data-serve-group], [data-serve-row], [data-unserve-row]",
      ),
    ).toBeNull();
    for (const selector of [
      "[data-sent-toggle]",
      ...(state === "held" ? ["[data-held-toggle]"] : []),
    ]) {
      const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
      if (toggle.getAttribute("aria-expanded") === "false") {
        await userEvent.click(toggle);
        await panel.updateComplete;
      }
    }
    const shown = panel.shadowRoot!.querySelector<HTMLElement>(`[data-${state}-line="dish"]`)!;
    expect(shown.textContent).toContain("Recorded dish");
    expect(shown.querySelector("[data-sent-info]")).not.toBeNull();
    const commands: CustomEvent[] = [];
    el.addEventListener(state === "held" ? "fire-group" : "serve-lines", (event) =>
      commands.push(event as CustomEvent),
    );
    await userEvent.click(
      panel.shadowRoot!.querySelector<HTMLElement>(
        state === "held" ? '[data-group-fire="group"]' : '[data-serve-line="dish"]',
      )!,
    );
    await el.updateComplete;
    if (state === "held") {
      expect(commands).toEqual([]);
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-fire-confirm]")!);
      await el.updateComplete;
    }
    expect(commands.map((event) => event.detail)).toEqual([
      state === "held" ? { groupId: "group" } : { items: [{ lineId: "dish", quantity: "1" }] },
    ]);
    expect(commands[0]!.bubbles && commands[0]!.composed).toBe(true);
  },
);

it.each([null, "fired-group"])(
  "opens the drawer without offering the legacy Send action for group %s",
  async (groupId) => {
    const line = { ...storedDish, groupId, firedAt: null, state: "queued" as const };
    const { el } = await mount({
      orderId: "wo-4",
      lines: [line],
      groups: groupId === null ? [] : [orderGroup(groupId, 1, "fired")],
    });
    const commands: CustomEvent[] = [];
    el.addEventListener("send-lines", (event) => commands.push(event as CustomEvent));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    const drawer = el.shadowRoot!.querySelector("[data-drawer]")!;
    expect(drawer.textContent).toContain("Recorded dish");
    expect(drawer.querySelector("[data-send-line]")).toBeNull();
    expect(commands).toEqual([]);
  },
);
