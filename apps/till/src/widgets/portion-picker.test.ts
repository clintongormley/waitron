import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { decimal, formatMoney } from "@waitron/shared";
import type { BillBalance, TabLine } from "../api/client.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { paidQuantities } from "../state/bill-payment.js";
import { tabLinePortionKey } from "../state/portion-groups.js";
import { pickRows, type PickRow, type Picks } from "../state/portion-selection.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillPortionPicker } from "./portion-picker.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "5.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

function dish(id: string, lineNo: number, name: string, price: string): TabLine {
  return line(id, lineNo, { name, productId: name, menuItemId: name, unitPriceGross: price });
}

function balance(
  total: string,
  received: string,
  paidLines: BillBalance["paidLines"] = [],
): BillBalance {
  return {
    workingOrderId: "bill-1",
    status: "open",
    total,
    received,
    reserved: "0.00",
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines,
  };
}

function rowsOf(lines: readonly TabLine[], paid: BillBalance | null, picks: Picks): PickRow[] {
  const keyOf = (row: TabLine) =>
    tabLinePortionKey(
      row,
      lines,
      paid === null ? null : (paidQuantities(paid).get(row.lineNo) ?? null),
    );
  return pickRows(lines, keyOf, paid, new Set(), picks);
}

const CANAS = [line("c1", 1), line("c2", 2), line("c3", 3), line("c4", 4)];
const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const nameOf = (row: PickRow) => row.members[0]!.name ?? "";

/** Mounts the picker and plays the screen's part: each emitted pick set is redrawn. */
async function picker(lines: readonly TabLine[], paid: BillBalance | null = null, picks?: Picks) {
  const start = picks ?? new Set<string>();
  const { el, host } = await mountWidget<TillPortionPicker>("till-portion-picker", {
    rows: rowsOf(lines, paid, start),
    picks: start,
    nameOf,
    money,
  });
  const emitted: CustomEvent<{ picks: string[] }>[] = [];
  el.addEventListener("portion-picks", (event) => {
    const picked = event as CustomEvent<{ picks: string[] }>;
    emitted.push(picked);
    const next = new Set(picked.detail.picks);
    el.picks = next;
    el.rows = rowsOf(lines, paid, next);
  });
  return { el, host, emitted, last: () => emitted.at(-1)?.detail.picks };
}

const q = <T extends Element>(el: TillPortionPicker, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const tick = (el: TillPortionPicker, id: string) =>
  q<HTMLInputElement>(el, `input[type="checkbox"][data-pick="${id}"]`)!;
const dec = (el: TillPortionPicker, id: string) => q<HTMLElement>(el, `[data-pick-dec="${id}"]`);
const inc = (el: TillPortionPicker, id: string) => q<HTMLElement>(el, `[data-pick-inc="${id}"]`);
const disabled = (button: HTMLElement | null) => button?.hasAttribute("disabled") ?? null;

afterEach(cleanupWidgets);

describe("till-portion-picker", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-portion-picker")).toBe(TillPortionPicker);
  });

  it("A803 picker: ticking a grouped row of four emits all four, bubbling and composed", async () => {
    const { el, emitted, last } = await picker(CANAS);
    expect(el.shadowRoot!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    await userEvent.click(tick(el, "c1"));
    expect(last()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(emitted[0]!.bubbles).toBe(true);
    expect(emitted[0]!.composed).toBe(true);
    await el.updateComplete;
    expect(tick(el, "c1").checked).toBe(true);
    expect(q(el, '[data-pick-count="c1"]')!.textContent!.trim()).toBe(
      fill(t("table.pick_count"), { count: "4", total: "4" }),
    );
  });

  it("A803 picker: − then emits the first three; + at the member count is disabled", async () => {
    const { el, last } = await picker(CANAS, null, new Set(["c1", "c2", "c3", "c4"]));
    expect(disabled(inc(el, "c1"))).toBe(true);
    await userEvent.click(dec(el, "c1")!);
    expect(last()).toEqual(["c1", "c2", "c3"]);
    await el.updateComplete;
    expect(disabled(inc(el, "c1"))).toBe(false);
    await userEvent.click(inc(el, "c1")!);
    expect(last()).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("A803 picker: − at 1 is disabled, and an unticked row shows no count control", async () => {
    const { el } = await picker(CANAS, null, new Set(["c1"]));
    expect(disabled(dec(el, "c1"))).toBe(true);
    expect(disabled(inc(el, "c1"))).toBe(false);
    const unticked = await picker(CANAS);
    expect(dec(unticked.el, "c1")).toBeNull();
    expect(inc(unticked.el, "c1")).toBeNull();
  });

  it("A803 picker: toggling a ticked row clears it", async () => {
    const { el, last } = await picker(CANAS, null, new Set(["c1", "c2"]));
    await userEvent.click(tick(el, "c1"));
    expect(last()).toEqual([]);
  });

  it("A803 picker: a weighed row is a tick with no count control", async () => {
    const lines = [
      line("w1", 1, {
        name: "Pulpo",
        productId: "pulpo",
        menuItemId: "pulpo",
        quantity: "0.350",
        priceQuantity: "0.350",
        unitPrecision: 3,
        unitPriceGross: "40.00",
      }),
    ];
    const { el, last } = await picker(lines);
    await userEvent.click(tick(el, "w1"));
    expect(last()).toEqual(["w1"]);
    await el.updateComplete;
    expect(tick(el, "w1").checked).toBe(true);
    expect(dec(el, "w1")).toBeNull();
    expect(inc(el, "w1")).toBeNull();
    expect(q(el, '[data-pick-count="w1"]')).toBeNull();
  });

  it("A803 picker: a paid row's tick is disabled and its reason reads Paid, tied to the tick", async () => {
    const lines = [
      dish("k1", 1, "Croqueta", "3.00"),
      dish("k2", 2, "Croqueta", "3.00"),
      dish("k3", 3, "Croqueta", "3.00"),
    ];
    const paid = balance("9.00", "3.00", [{ lineId: "k1", lineNo: 1, paidQuantity: "1.000" }]);
    const { el, emitted } = await picker(lines, paid);
    const paidTick = tick(el, "k1");
    expect(paidTick.disabled).toBe(true);
    const reasonId = paidTick.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reason = el.shadowRoot!.getElementById(reasonId!)!;
    expect(reason.textContent!.trim()).toBe(t("bill_pay.paid"));
    expect(reason.checkVisibility()).toBe(true);
    await userEvent.click(paidTick, { force: true });
    expect(emitted).toHaveLength(0);
    expect(tick(el, "k2").disabled).toBe(false);
    expect(tick(el, "k2").hasAttribute("aria-describedby")).toBe(false);
  });

  it("A803 picker: a floor-blocked row says what is already paid, in English and Spanish", async () => {
    const lines = [...CANAS, dish("s1", 5, "Steak", "32.00")];
    const paid = balance("52.00", "40.00");
    const previous = currentLocale();
    try {
      setLocale("en-GB");
      const { el } = await picker(lines, paid);
      const steak = tick(el, "s1");
      expect(steak.disabled).toBe(true);
      const reason = el.shadowRoot!.getElementById(steak.getAttribute("aria-describedby")!)!;
      expect(reason.textContent!.trim()).toBe("€40.00 is already paid on this bill");
      setLocale("es-ES");
      await el.updateComplete;
      expect(reason.isConnected).toBe(true);
      const spanish = el.shadowRoot!.getElementById(steak.getAttribute("aria-describedby")!)!;
      expect(spanish.textContent!.trim()).toBe(
        `Ya se han pagado ${formatMoney(decimal("40.00"), "es-ES")} en esta cuenta`,
      );
    } finally {
      setLocale(previous);
    }
  });

  it("A803 picker: a ticked row whose next member would break the floor has + disabled", async () => {
    const lines = [...CANAS, dish("s1", 5, "Steak", "32.00")];
    const { el, last } = await picker(lines, balance("52.00", "40.00"));
    await userEvent.click(tick(el, "c1"));
    expect(last()).toEqual(["c1", "c2"]);
    await el.updateComplete;
    expect(q(el, '[data-pick-count="c1"]')!.textContent!.trim()).toBe(
      fill(t("table.pick_count"), { count: "2", total: "4" }),
    );
    expect(disabled(inc(el, "c1"))).toBe(true);
    expect(disabled(dec(el, "c1"))).toBe(false);
    const reasonId = tick(el, "c1").getAttribute("aria-describedby");
    expect(el.shadowRoot!.getElementById(reasonId!)!.textContent!.trim()).toBe(
      "€40.00 is already paid on this bill",
    );
  });

  it("A803 picker: Space toggles a tick and Tab reaches − and +", async () => {
    const { el, last } = await picker(CANAS, null, new Set(["c1", "c2"]));
    tick(el, "c1").focus();
    expect(el.shadowRoot!.activeElement).toBe(tick(el, "c1"));
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(dec(el, "c1"));
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(inc(el, "c1"));
    tick(el, "c1").focus();
    await userEvent.keyboard(" ");
    expect(last()).toEqual([]);
  });

  it("A803 picker: the event detail is in line order", async () => {
    const lines = [line("c1", 1), dish("h1", 2, "Ham", "9.00"), line("c3", 3)];
    const { el, last } = await picker(lines, null, new Set(["h1"]));
    await userEvent.click(tick(el, "c1"));
    expect(last()).toEqual(["c1", "h1", "c3"]);
  });

  it("A803 picker: every tick is named by its visible text", async () => {
    const lines = [...CANAS, dish("h1", 5, "Ham", "9.00")];
    const { el } = await picker(lines, null, new Set(["c1"]));
    for (const box of el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      const label = box.closest("label")!;
      expect(label).not.toBeNull();
      expect(label.textContent).toContain(box.dataset.pick === "c1" ? "Caña" : "Ham");
    }
    for (const button of el.shadowRoot!.querySelectorAll<HTMLElement>(
      "[data-pick-dec], [data-pick-inc]",
    )) {
      expect(button.getAttribute("aria-label")).toContain("Caña");
    }
  });

  it("A803 picker: shows the row's amount and, with no dishes, says there are none", async () => {
    const { el } = await picker([...CANAS, dish("h1", 5, "Ham", "9.00")]);
    expect(q(el, '[data-pick-amount="c1"]')!.textContent!.trim()).toBe(money("20.00"));
    expect(q(el, '[data-pick-amount="h1"]')!.textContent!.trim()).toBe(money("9.00"));
    const empty = await picker([]);
    expect(empty.el.shadowRoot!.textContent).toContain(t("table.move_dishes_none"));
    expect(empty.el.shadowRoot!.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
