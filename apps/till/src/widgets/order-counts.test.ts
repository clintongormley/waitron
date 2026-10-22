import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { es, type StringKey } from "../i18n/strings.js";
import { countText, setLocale } from "../i18n/t.js";
import type { OrderStateCounts } from "../api/client.js";
import { orderCountStyles, orderCounts } from "./order-counts.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

class OrderCountsHost extends LitElement {
  static override styles = orderCountStyles;
  static override properties = { counts: { attribute: false } };
  declare counts: OrderStateCounts;
  override render() {
    return html`${orderCounts(this.counts)}`;
  }
}
customElements.define("order-counts-test-host", OrderCountsHost);

const none: OrderStateCounts = { ordered: 0, unsent: 0, held: 0, waiting: 0, ready: 0 };
const all: OrderStateCounts = { ordered: 9, unsent: 1, held: 2, waiting: 3, ready: 2 };

const keys: Record<keyof OrderStateCounts, [StringKey, StringKey]> = {
  ordered: ["order_counts.items", "order_counts.items_one"],
  unsent: ["order_counts.unsent", "order_counts.unsent_one"],
  held: ["order_counts.held", "order_counts.held_one"],
  waiting: ["order_counts.waiting", "order_counts.waiting_one"],
  ready: ["order_counts.ready", "order_counts.ready_one"],
};

async function mount(counts: OrderStateCounts) {
  const { el, host } = await mountWidget<OrderCountsHost>("order-counts-test-host", { counts });
  return { el, host, chips: [...el.shadowRoot!.querySelectorAll<HTMLElement>(".counts > .chip")] };
}

const read = (chips: HTMLElement[]) =>
  chips.map((chip) => [chip.dataset.count, chip.textContent!.trim()]);

beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

describe("orderCounts", () => {
  it("draws items, then each state above zero, worded with the counts", async () => {
    const { chips } = await mount({ ordered: 6, unsent: 0, held: 2, waiting: 0, ready: 2 });
    expect(read(chips)).toEqual([
      ["ordered", countText(6, ...keys.ordered)],
      ["held", countText(2, ...keys.held)],
      ["ready", countText(2, ...keys.ready)],
    ]);
    expect(chips.map((chip) => chip.textContent!.trim())).toEqual(["6 items", "2 held", "2 ready"]);
  });

  it("reads the singular for a count of one", async () => {
    const { chips } = await mount({ ...none, ordered: 1, waiting: 1 });
    expect(read(chips)).toEqual([
      ["ordered", "1 item"],
      ["waiting", "1 waiting"],
    ]);
  });

  it("still says how many items when there are none", async () => {
    const { chips } = await mount(none);
    expect(read(chips)).toEqual([["ordered", "0 items"]]);
  });

  it("draws all five in the order a dish moves, each named by its field, none a signal chip", async () => {
    const { el, chips } = await mount(all);
    expect(read(chips)).toEqual(
      (["ordered", "unsent", "held", "waiting", "ready"] as const).map((field) => [
        field,
        countText(all[field], ...keys[field]),
      ]),
    );
    expect(el.shadowRoot!.querySelectorAll("[data-chip]")).toHaveLength(0);
  });

  it("paints each chip's border and weight from its token", async () => {
    const { el, host } = await mount(all);
    const tokens = {
      "--wt-color-border": "rgb(1, 2, 3)",
      "--wt-color-warning": "rgb(4, 5, 6)",
      "--wt-color-text-muted": "rgb(7, 8, 9)",
      "--wt-color-success": "rgb(10, 11, 12)",
      "--wt-font-weight-normal": "300",
    };
    for (const [token, value] of Object.entries(tokens)) host.style.setProperty(token, value);
    await el.updateComplete;
    const chip = (field: keyof OrderStateCounts) =>
      getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>(`[data-count="${field}"]`)!);
    expect(chip("ordered").borderTopColor).toBe(tokens["--wt-color-border"]);
    expect(chip("ordered").borderTopStyle).toBe("solid");
    expect(chip("unsent").borderTopColor).toBe(tokens["--wt-color-warning"]);
    expect(chip("unsent").borderTopStyle).toBe("dashed");
    expect(chip("held").borderTopColor).toBe(tokens["--wt-color-text-muted"]);
    expect(chip("held").borderTopStyle).toBe("solid");
    expect(chip("waiting").borderTopColor).toBe(tokens["--wt-color-warning"]);
    expect(chip("waiting").borderTopStyle).toBe("solid");
    expect(chip("ready").borderTopColor).toBe(tokens["--wt-color-success"]);
    expect(chip("ready").borderTopStyle).toBe("solid");
    for (const field of ["ordered", "unsent", "held", "waiting", "ready"] as const)
      expect(chip(field).fontWeight).toBe(tokens["--wt-font-weight-normal"]);
  });

  it("reads the Spanish words in Spanish", async () => {
    setLocale("es");
    const { chips } = await mount({ ordered: 4, unsent: 1, held: 2, waiting: 1, ready: 3 });
    expect(chips.map((chip) => chip.textContent!.trim())).toEqual([
      es["order_counts.items"].replace("{n}", "4"),
      es["order_counts.unsent_one"],
      es["order_counts.held"].replace("{n}", "2"),
      es["order_counts.waiting_one"],
      es["order_counts.ready"].replace("{n}", "3"),
    ]);
  });
});
