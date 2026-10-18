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
import {
  openSentDish,
  openSentMore,
  sentPanelFor,
} from "./till-table-order-screen.sent.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { mount } from "./till-table-order-screen.test-helpers.js";
import { storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";

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

it.each(["fired", "served"] as const)(
  "offers one Comp window from Sent instead of duplicate %s drawer adjustments",
  async (kind) => {
    const line = {
      ...storedDish,
      groupId: null,
      firedAt: "2026-09-28T19:50:00.000Z",
      sentAt: "2026-09-28T19:50:00.000Z",
      servedAt: kind === "served" ? "2026-09-28T20:00:00.000Z" : null,
    };
    const { el } = await mount({
      orderId: "wo-4",
      lines: [line, { ...storedExtra, groupId: null }],
      party: {
        id: "v1",
        revision: 4,
        guestCount: 2,
        state: "open",
        name: null,
        displayName: "4",
        mainBillId: "wo-4",
        outstanding: "8.00",
        billCount: 1,
        tableIds: ["t4"],
        unsentDrafts: [],
        reminder: null,
        kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
      },
      currentOrders: current({
        groups: [],
        reminder: null,
        ungrouped: [
          row(line.id, "Recorded dish", "2.000", {
            netAmount: "6.50",
            servedAt: line.servedAt,
            servedQuantity: kind === "served" ? "2.000" : "0.000",
            extras: [
              {
                lineId: storedExtra.id,
                name: storedExtra.name!,
                quantity: "2.000",
                unitPriceGross: "0.75",
                priceQuantity: "1.000",
                netAmount: "1.50",
              },
            ],
          }),
        ],
      }),
    });
    const commands: CustomEvent[] = [];
    el.addEventListener("adjust", (event) => commands.push(event as CustomEvent));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    const drawer = el.shadowRoot!.querySelector("[data-drawer]")!;
    expect(drawer.textContent).toContain("Recorded dish");
    expect(drawer.querySelector("[data-comp-line], [data-discount-line]")).toBeNull();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    await openSentDish(el, line.id, kind);
    await openSentMore(el);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-comp]")!);
    await el.updateComplete;
    expect(
      commands.map((event) => ({
        detail: event.detail,
        bubbles: event.bubbles,
        composed: event.composed,
      })),
    ).toEqual([
      {
        detail: {
          kind: "comp",
          combined: true,
          target: {
            lineId: "stored-dish",
            name: "Recorded dish",
            quantity: "2",
            total: "8.00",
            unitTotal: "4.00",
            started: false,
            extras: [
              {
                lineId: "stored-extra",
                name: "Recorded extra (with Recorded dish)",
                quantity: "2",
                total: "1.50",
                unitTotal: null,
                started: false,
                extra: true,
                kitchenTold: true,
              },
            ],
          },
        },
        bubbles: true,
        composed: true,
      },
    ]);
  },
);
