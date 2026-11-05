import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { decimal, formatMoney } from "@waitron/shared";
import type { BillBalance, Draft, PartyBill, TabLine } from "../api/client.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { paidQuantities } from "../state/bill-payment.js";
import { tabLinePortionKey } from "../state/portion-groups.js";
import { pickGroups } from "../state/portion-selection.js";
import {
  pickOnBill,
  splitSourcesFrom,
  type SplitPicks,
  type SplitSource,
} from "../state/split-selection.js";
import { billGross } from "../state/adjust-target.js";
import type { TillPortionPicker } from "./portion-picker.js";
import { TillSplitPicker } from "./split-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Beer",
    productId: "beer",
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
    menuItemId: "offer-beer",
    portion: true,
    ...over,
  };
}

const ham = (id: string, lineNo: number) =>
  line(id, lineNo, { name: "Ham", productId: "ham", menuItemId: "ham", unitPriceGross: "9.00" });

const BEERS = [line("c1", 1), line("c2", 2), line("c3", 3)];
const DISHES = [...BEERS, ham("h1", 4)];

interface SourceOptions {
  received?: string;
  reserved?: string;
  paid?: string[];
  status?: PartyBill["status"];
  billName?: string;
  held?: SplitSource["held"];
  ownUnsent?: boolean;
}

function balanceOf(
  id: string,
  lines: readonly TabLine[],
  options: SourceOptions = {},
): BillBalance {
  return {
    workingOrderId: id,
    status: options.status ?? "open",
    total: billGross(lines),
    received: options.received ?? "0.00",
    reserved: options.reserved ?? "0.00",
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines: (options.paid ?? []).map((lineId) => ({
      lineId,
      lineNo: lines.find((row) => row.id === lineId)!.lineNo,
      paidQuantity: "1.000",
    })),
  };
}

const keyFor = (lines: readonly TabLine[], balance: BillBalance) => (row: TabLine) =>
  tabLinePortionKey(row, lines, paidQuantities(balance).get(row.lineNo) ?? null);

function source(
  id: string,
  number: number,
  lines: readonly TabLine[],
  options: SourceOptions = {},
): SplitSource {
  const balance = balanceOf(id, lines, options);
  return {
    bill: {
      workingOrderId: id,
      revision: 0,
      invoiceType: "F2",
      recipient: null,
      partyId: "party",
      label: null,
      billNumber: number,
      billName: options.billName ?? null,
      status: options.status ?? "open",
      total: balance.total,
      outstanding: balance.total,
      hasPayments: (options.received ?? "0.00") !== "0.00",
      receiptAvailable: false,
    },
    groups: pickGroups(lines, keyFor(lines, balance), balance, new Set()),
    held: options.held ?? null,
    ownUnsent: options.ownUnsent ?? false,
    refundPending: false,
  };
}

const NOTHING: SplitPicks = { whole: new Set(), picks: new Map() };
const wholeOf = (...ids: string[]): SplitPicks => ({ whole: new Set(ids), picks: new Map() });
const looseOf = (id: string, ...picks: string[]): SplitPicks => ({
  whole: new Set(),
  picks: new Map([[id, new Set(picks)]]),
});

const luis = { draftId: "draft-luis", revision: 7, ownerName: "Luis", takenFromYou: false };
const nobody = { draftId: "draft-x", revision: 3, ownerName: null, takenFromYou: false };

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const nameOf = (dish: TabLine) => dish.name ?? "";

async function picker(
  sources: readonly SplitSource[],
  split: SplitPicks = NOTHING,
  over: Partial<TillSplitPicker> = {},
) {
  const { el, host } = await mountWidget<TillSplitPicker>("till-split-picker", {
    sources,
    split,
    nameOf,
    money,
    ...over,
  });
  const emitted: SplitPicks[] = [];
  el.addEventListener("split-picks", (event) => {
    emitted.push((event as CustomEvent<{ split: SplitPicks }>).detail.split);
  });
  return { el, host, emitted };
}

const q = <T extends Element>(el: TillSplitPicker, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const header = (el: TillSplitPicker, id: string) =>
  q<HTMLInputElement>(el, `input[data-split-tick="${id}"]`)!;
const inner = (el: TillSplitPicker, id: string) =>
  q<TillPortionPicker>(el, `[data-split-bill="${id}"] till-portion-picker`);
const rowTick = (el: TillSplitPicker, bill: string, row: string) =>
  inner(el, bill)!.shadowRoot!.querySelector<HTMLInputElement>(`[data-pick="${row}"]`)!;
const text = (el: TillSplitPicker, selector: string) => q(el, selector)?.textContent?.trim();
const billText = (el: TillSplitPicker, id: string) =>
  q(el, `[data-split-bill="${id}"]`)!.textContent!.replace(/\s+/g, " ");

afterEach(cleanupWidgets);

describe("till-split-picker", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-split-picker")).toBe(TillSplitPicker);
  });

  it("A803 selection: the header tick reads none, some and all, named by the bill's label", async () => {
    const { el } = await picker(
      [
        source("b1", 1, DISHES),
        source("b2", 2, DISHES, { billName: "Clint" }),
        source("b3", 3, DISHES),
      ],
      { whole: new Set(["b3"]), picks: new Map([["b2", new Set(["c1"])]]) },
    );
    expect(header(el, "b1").checked).toBe(false);
    expect(header(el, "b1").indeterminate).toBe(false);
    expect(header(el, "b2").checked).toBe(false);
    expect(header(el, "b2").indeterminate).toBe(true);
    expect(header(el, "b3").checked).toBe(true);
    expect(header(el, "b3").indeterminate).toBe(false);
    await expect
      .element(
        page.elementLocator(el).getByRole("checkbox", { name: "Bill 2 · Clint", exact: true }),
      )
      .toBe(header(el, "b2"));
  });

  it("A803 selection: ticking a header emits the model's whole bill", async () => {
    const { el, emitted } = await picker([source("b1", 1, DISHES)], looseOf("b1", "c1"));
    await userEvent.click(header(el, "b1"));
    expect(emitted).toHaveLength(1);
    expect([...emitted[0]!.whole]).toEqual(["b1"]);
    expect(emitted[0]!.picks.size).toBe(0);
  });

  it("A803 selection: a whole bill's rows draw ticked and quiet with no stepper, each tick usable", async () => {
    const { el } = await picker([source("b1", 1, DISHES)], wholeOf("b1"));
    const rows = inner(el, "b1")!;
    expect(rows.whole).toBe(true);
    expect(rowTick(el, "b1", "c1").checked).toBe(true);
    expect(rowTick(el, "b1", "c1").disabled).toBe(false);
    expect(rowTick(el, "b1", "h1").checked).toBe(true);
    expect(rowTick(el, "b1", "h1").disabled).toBe(false);
    expect(rows.shadowRoot!.querySelector('[data-pick-dec="c1"]')).toBeNull();
    expect(rows.shadowRoot!.querySelector('[data-pick-row="c1"]')!.className).toContain("quiet");
    expect(rows.shadowRoot!.querySelector('[data-pick-count="c1"]')).toBeNull();
  });

  it("A803 selection: unticking a row of a whole bill emits the model's result", async () => {
    const sources = [source("b1", 1, DISHES)];
    const { el, emitted } = await picker(sources, wholeOf("b1"));
    await userEvent.click(rowTick(el, "b1", "h1"));
    expect(emitted).toHaveLength(1);
    const expected = pickOnBill(sources[0]!, wholeOf("b1"), new Set(["c1", "c2", "c3"]));
    expect([...emitted[0]!.whole]).toEqual([...expected.whole]);
    expect([...emitted[0]!.picks.get("b1")!]).toEqual(["c1", "c2", "c3"]);
  });

  it("A803 selection: a paid row in a whole bill is ticked and disabled, its reason tied to the tick", async () => {
    const { el } = await picker(
      [source("b1", 1, [ham("p1", 1), line("c1", 2)], { received: "9.00", paid: ["p1"] })],
      wholeOf("b1"),
    );
    const tick = rowTick(el, "b1", "p1");
    expect(tick.checked).toBe(true);
    expect(tick.disabled).toBe(true);
    const reason = inner(el, "b1")!.shadowRoot!.getElementById(
      tick.getAttribute("aria-describedby")!,
    );
    expect(reason!.textContent).toBe(t("bill_pay.paid"));
  });

  it("a part-paid bill says what is paid in its header; another bill says nothing", async () => {
    const { el } = await picker([
      source("b1", 1, DISHES, { received: "5.00" }),
      source("b2", 2, DISHES),
    ]);
    expect(text(el, '[data-split-bill="b1"] [data-split-paid]')).toBe(
      fill(t("table.split_bill_part_paid"), { amount: money("5.00") }),
    );
    expect(q(el, '[data-split-bill="b2"] [data-split-paid]')).toBeNull();
  });

  it("money only reserved by a card in progress is not called paid, and still keeps its dishes on the bill", async () => {
    const { el } = await picker(
      [source("b1", 1, DISHES, { reserved: "5.00" })],
      looseOf("b1", "c1", "c2", "c3"),
    );
    expect(text(el, '[data-split-bill="b1"] [data-split-paid]')).toBeUndefined();
    const tick = rowTick(el, "b1", "h1");
    expect(tick.disabled).toBe(true);
    const reason = inner(el, "b1")!.shadowRoot!.getElementById(
      tick.getAttribute("aria-describedby")!,
    );
    expect(reason!.textContent).toBe(fill(t("table.move_dishes_floor"), { amount: money("5.00") }));
  });

  it("a bill with money received and a card in progress says only what was received", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { received: "3.00", reserved: "5.00" })]);
    expect(text(el, '[data-split-bill="b1"] [data-split-paid]')).toBe(
      fill(t("table.split_bill_part_paid"), { amount: money("3.00") }),
    );
  });

  it("a presented bill's disabled ticks carry the note's words, whole or not", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { status: "placed" })]);
    expect(rowTick(el, "b1", "c1").getAttribute("aria-description")).toBe(
      t("table.split_presented"),
    );
    el.split = wholeOf("b1");
    await el.updateComplete;
    await inner(el, "b1")!.updateComplete;
    expect(rowTick(el, "b1", "c1").disabled).toBe(true);
    expect(rowTick(el, "b1", "c1").getAttribute("aria-description")).toBe(
      t("table.split_presented"),
    );
  });

  it("a bill that is not presented puts no such words on its ticks", async () => {
    const { el } = await picker([source("b1", 1, DISHES)]);
    expect(rowTick(el, "b1", "c1").hasAttribute("aria-description")).toBe(false);
  });

  it("a presented bill has its note, a usable header and greyed rows", async () => {
    const { el, emitted } = await picker([source("b1", 1, DISHES, { status: "placed" })]);
    expect(billText(el, "b1")).toContain(t("table.split_presented"));
    expect(header(el, "b1").disabled).toBe(false);
    expect(rowTick(el, "b1", "c1").checked).toBe(false);
    expect(rowTick(el, "b1", "c1").disabled).toBe(true);
    const name = inner(el, "b1")!.shadowRoot!.querySelector('[data-pick-row="c1"] .name')!;
    expect(getComputedStyle(name).opacity).toBe("0.5");
    await userEvent.click(header(el, "b1"));
    expect([...emitted[0]!.whole]).toEqual(["b1"]);
  });

  it("no note on a bill that is neither presented, held nor holding this person's dishes", async () => {
    const { el } = await picker([source("b1", 1, DISHES)]);
    const words = billText(el, "b1");
    expect(words).not.toContain(t("table.split_presented"));
    expect(words).not.toContain(t("table.split_own_unsent"));
    expect(words).not.toContain(t("table.split_take_over_first"));
    expect(q(el, '[data-split-bill="b1"] [data-split-take-over]')).toBeNull();
    expect(header(el, "b1").hasAttribute("aria-describedby")).toBe(false);
  });

  it("a held bill that is not selected: the holder's row, a Take over button, its disabled tick's reason, and no rows", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { held: luis })]);
    expect(billText(el, "b1")).toContain(fill(t("table.others_draft"), { name: "Luis" }));
    const button = q<HTMLElement>(el, '[data-split-take-over="b1"]')!;
    expect(button.getAttribute("aria-label")).toBe(`${t("table.take_over")} · Bill 1`);
    expect(button.textContent!.trim()).toBe(t("table.take_over"));
    const tick = header(el, "b1");
    expect(tick.disabled).toBe(true);
    expect(tick.checked).toBe(false);
    const reason = el.shadowRoot!.getElementById(tick.getAttribute("aria-describedby")!);
    expect(reason!.textContent).toBe("Take over the draft to tick this bill.");
    expect(inner(el, "b1")).toBeNull();
    expect(billText(el, "b1")).not.toContain("Beer");
    expect(billText(el, "b1")).not.toContain(t("table.move_dishes_none"));
  });

  it("a held bill's reason for its disabled tick, in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await picker([source("b1", 1, DISHES, { held: luis })]);
      const reason = el.shadowRoot!.getElementById(
        header(el, "b1").getAttribute("aria-describedby")!,
      );
      expect(reason!.textContent).toBe("Toma el pedido para marcar esta cuenta.");
    } finally {
      setLocale(before);
    }
  });

  it.each([
    ["whole", wholeOf("b1"), true, false],
    ["with picks", looseOf("b1", "c1"), false, true],
  ])(
    "A803 selection: a held bill selected %s keeps its row, usable tick and no rows, and unticking clears it",
    async (_name, split, checked, indeterminate) => {
      const { el, emitted } = await picker([source("b1", 1, DISHES, { held: luis })], split);
      expect(billText(el, "b1")).toContain(fill(t("table.others_draft"), { name: "Luis" }));
      expect(q(el, '[data-split-take-over="b1"]')).not.toBeNull();
      expect(billText(el, "b1")).not.toContain(t("table.split_take_over_first"));
      expect(inner(el, "b1")).toBeNull();
      const tick = header(el, "b1");
      expect(tick.disabled).toBe(false);
      expect(tick.checked).toBe(checked);
      expect(tick.indeterminate).toBe(indeterminate);
      expect(tick.hasAttribute("aria-describedby")).toBe(false);
      await userEvent.click(tick);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.whole.size).toBe(0);
      expect(emitted[0]!.picks.size).toBe(0);
    },
  );

  it("unticking a held bill disables its tick, so focus goes to the bill's Take over", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { held: luis })], wholeOf("b1"));
    el.addEventListener("split-picks", (event) => {
      el.split = (event as CustomEvent<{ split: SplitPicks }>).detail.split;
    });
    await userEvent.click(header(el, "b1"));
    await el.updateComplete;
    expect(header(el, "b1").disabled).toBe(true);
    await expect
      .poll(() => el.shadowRoot!.activeElement)
      .toBe(q(el, '[data-split-take-over="b1"]'));
  });

  describe("a read that takes away the bill holding focus", () => {
    const two = () => [source("b1", 1, DISHES), source("b2", 2, DISHES)];
    const active = (el: TillSplitPicker) => el.shadowRoot!.activeElement;

    it("from a dish of the first bill, focus goes to the next bill's tick, not its dish", async () => {
      const [first, second] = two();
      const { el } = await picker([first!, second!]);
      rowTick(el, "b1", "c1").focus();
      el.sources = [second!];
      await expect.poll(() => active(el) === header(el, "b2")).toBe(true);
      expect(inner(el, "b2")!.shadowRoot!.activeElement).toBeNull();
    });

    it("from the last bill's tick, focus goes to the bill now last", async () => {
      const [first, second] = two();
      const { el } = await picker([first!, second!]);
      header(el, "b2").focus();
      el.sources = [first!];
      await expect.poll(() => active(el) === header(el, "b1")).toBe(true);
    });

    it("to a bill someone else holds, focus goes to its Take over", async () => {
      const [first] = two();
      const { el } = await picker([first!, source("b2", 2, DISHES, { held: luis })]);
      header(el, "b1").focus();
      el.sources = [source("b2", 2, DISHES, { held: luis })];
      await expect.poll(() => active(el) === q(el, '[data-split-take-over="b2"]')).toBe(true);
    });

    it("with no bill left, it says so for the screen to place focus", async () => {
      const [first] = two();
      const { el } = await picker([first!]);
      const seen: Event[] = [];
      el.addEventListener("split-bills-gone", (event) => seen.push(event));
      header(el, "b1").focus();
      el.sources = [];
      await expect.poll(() => seen.length).toBe(1);
      expect(seen[0]!.bubbles).toBe(true);
      expect(seen[0]!.composed).toBe(true);
    });

    it("with focus elsewhere, nothing moves and nothing is said", async () => {
      const [first, second] = two();
      const { el } = await picker([first!, second!]);
      const seen: Event[] = [];
      el.addEventListener("split-bills-gone", (event) => seen.push(event));
      el.sources = [];
      await el.updateComplete;
      expect(active(el)).toBeNull();
      expect(seen).toHaveLength(0);
    });
  });

  it("a holder with no name draws the unnamed words", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { held: nobody })]);
    expect(billText(el, "b1")).toContain(t("table.others_draft_unnamed"));
  });

  it("an order taken from this person draws the taken-over words, named and unnamed", async () => {
    const { el } = await picker(
      [
        source("b1", 1, DISHES, { held: { ...luis, takenFromYou: true } }),
        source("b2", 2, DISHES, { held: { ...nobody, takenFromYou: true } }),
      ],
      NOTHING,
    );
    expect(billText(el, "b1")).toContain(fill(t("table.draft_taken_by"), { name: "Luis" }));
    expect(billText(el, "b1")).not.toContain(fill(t("table.others_draft"), { name: "Luis" }));
    expect(billText(el, "b2")).toContain(t("table.draft_taken_by_unnamed"));
  });

  it("the panel's read decides the taken-over words: only a draft taken from this person draws them", async () => {
    const billIds = ["b1", "b2", "b3"];
    const held = (billId: string, takenOverFrom: Draft["takenOverFrom"]): Draft => ({
      id: `draft-${billId}`,
      partyId: "party",
      billId,
      ownerId: "luis",
      ownerName: "Luis",
      revision: 2,
      lines: [],
      takenOverFrom,
    });
    const sources = splitSourcesFrom(
      {
        bills: billIds.map((billId) => ({
          billId,
          lines: DISHES,
          balance: balanceOf(billId, DISHES),
        })),
      },
      billIds.map((billId, index) => source(billId, index + 1, DISHES).bill),
      [
        held("b1", { personId: "ana", name: "Ana" }),
        held("b2", { personId: "marta", name: "Marta" }),
        held("b3", null),
      ],
      "ana",
      new Set(),
      keyFor,
    );
    const { el } = await picker(sources);
    expect(billText(el, "b1")).toContain("Taken over by Luis");
    expect(billText(el, "b1")).not.toContain("Luis has an unsent order");
    expect(billText(el, "b2")).toContain("Luis has an unsent order");
    expect(billText(el, "b3")).toContain("Luis has an unsent order");
  });

  it("Take over emits the bill and the draft as read, once, bubbling and composed", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { held: luis })]);
    const seen: CustomEvent[] = [];
    el.addEventListener("split-take-over", (event) => seen.push(event as CustomEvent));
    await userEvent.click(q<HTMLElement>(el, '[data-split-take-over="b1"]')!);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.detail).toEqual({
      billId: "b1",
      draftId: "draft-luis",
      revision: 7,
      ownerName: "Luis",
    });
    expect(seen[0]!.bubbles).toBe(true);
    expect(seen[0]!.composed).toBe(true);
  });

  it("this person's own unsent dishes draw their note beside the rows", async () => {
    const { el } = await picker([source("b1", 1, DISHES, { ownUnsent: true })]);
    expect(billText(el, "b1")).toContain(t("table.split_own_unsent"));
    expect(inner(el, "b1")).not.toBeNull();
  });

  it("a bill's total is drawn with `money`", async () => {
    const { el } = await picker([source("b1", 1, DISHES)], NOTHING, {
      money: (amount) => `M${amount}`,
    });
    expect(text(el, '[data-split-bill="b1"] [data-split-total]')).toBe("M24.00");
  });

  it("a long name wraps inside the header", async () => {
    const { el, host } = await picker([source("b1", 1, DISHES, { billName: "x".repeat(200) })]);
    host.style.inlineSize = "200px";
    const row = q<HTMLElement>(el, '[data-split-bill="b1"] [data-split-header]')!;
    const nameBox = q<HTMLElement>(el, '[data-split-bill="b1"] [data-split-name]')!;
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    expect(nameBox.getBoundingClientRect().height).toBeGreaterThan(
      2 * parseFloat(getComputedStyle(nameBox).fontSize),
    );
  });

  it("a bill with no sent dishes draws its header and the no-dishes words", async () => {
    const { el } = await picker([source("b1", 1, [])]);
    expect(header(el, "b1")).toBeTruthy();
    expect(inner(el, "b1")!.shadowRoot!.textContent).toContain(t("table.move_dishes_none"));
  });

  it("A803 selection: it holds no picks: a tick the screen does not answer goes back, and it redraws from its properties", async () => {
    const { el, emitted } = await picker([source("b1", 1, DISHES)], looseOf("b1", "c1"));
    await userEvent.click(header(el, "b1"));
    expect(emitted).toHaveLength(1);
    await el.updateComplete;
    expect(header(el, "b1").checked).toBe(false);
    expect(header(el, "b1").indeterminate).toBe(true);
    await userEvent.click(rowTick(el, "b1", "h1"));
    expect(emitted).toHaveLength(2);
    await inner(el, "b1")!.updateComplete;
    expect(rowTick(el, "b1", "h1").checked).toBe(false);
    el.split = wholeOf("b1");
    await el.updateComplete;
    expect(header(el, "b1").checked).toBe(true);
    expect(header(el, "b1").indeterminate).toBe(false);
  });

  it("split-picks bubbles composed, and the rows' own portion-picks stops at the widget", async () => {
    const { el, host } = await picker([source("b1", 1, DISHES)]);
    const seen: CustomEvent[] = [];
    const leaked: Event[] = [];
    host.addEventListener("split-picks", (event) => seen.push(event as CustomEvent));
    host.addEventListener("portion-picks", (event) => leaked.push(event));
    await userEvent.click(rowTick(el, "b1", "h1"));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.composed).toBe(true);
    expect([...seen[0]!.detail.split.picks.get("b1")]).toEqual(["h1"]);
    expect(leaked).toEqual([]);
  });
});
