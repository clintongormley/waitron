import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { html } from "lit";
import type { PartyAllergyRead } from "@waitron/module";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { fill, setLocale, t } from "../i18n/t.js";
import type { TillSplitPicker } from "../widgets/split-picker.js";
import "./till-table-order-screen.js";
import type {
  SplitRefusal,
  SplitTableDetail,
  TillTableOrderScreen,
} from "./till-table-order-screen.js";
import type {
  BillBalance,
  BillRefundView,
  Draft,
  SplitSources,
  TabLine,
  TableParty,
  TableState,
} from "../api/client.js";
import { billLabel } from "../state/bill-state.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

function dish(id: string, lineNo: number, price: string, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: id,
    productId: id,
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: price,
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: `offer-${id}`,
    portion: true,
    ...over,
  };
}

const billNumberInSpanish = (n: number) => fill(t("floor.unsent_bill", "es-ES"), { n: String(n) });

const garcia: TableParty = {
  ...switcherParty,
  name: "García",
  guestCount: 5,
  tableIds: ["t7", "t8"],
};

function table(id: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label: id.toUpperCase(),
    shortName: id.toUpperCase(),
    party: garcia,
    signals: [],
    zoneId: null,
    state: "open-tab",
    hasOpenTab: true,
    condition: "held",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    ...over,
  } as TableState;
}

const tables = [table("t7"), table("t8")];

function balanceOf(billId: string, total: string): BillBalance {
  return {
    workingOrderId: billId,
    status: "open",
    total,
    received: "0.00",
    reserved: "0.00",
    outstanding: total,
    tips: "0.00",
    payments: [],
    paidLines: [],
  };
}

const read = (
  rows: Record<string, readonly TabLine[]>,
  totals: Record<string, string>,
  money: Record<string, Partial<BillBalance>> = {},
) =>
  ({
    bills: Object.entries(rows).map(([billId, lines]) => ({
      billId,
      lines: [...lines],
      balance: { ...balanceOf(billId, totals[billId]!), ...money[billId] },
    })),
  }) satisfies SplitSources;

// Board 08's example: three dishes of Bill 1 go, €30, and the €67 dish stays.
const board08 = {
  bills: [partyBill("b1", 1, "97.00"), partyBill("b2", 2, "40.00"), partyBill("b3", 3, "39.00")],
  splitRead: read(
    {
      b1: [
        dish("soup", 1, "10.00"),
        dish("salad", 2, "10.00"),
        dish("bread", 3, "10.00"),
        dish("steak", 4, "67.00"),
      ],
      b2: [dish("wine", 5, "40.00")],
      b3: [dish("fish", 6, "39.00")],
    },
    { b1: "97.00", b2: "40.00", b3: "39.00" },
  ),
};

const draft = (billId: string, ownerId: string, ownerName: string): Draft => ({
  id: `draft-${billId}`,
  partyId: garcia.id,
  billId,
  ownerId,
  ownerName,
  revision: 2,
  lines: [],
  takenOverFrom: null,
});

async function mountScreen(over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [],
    orderId: "b1",
    party: garcia,
    tables,
    personId: "me",
    ...board08,
    ...over,
  });
  return el;
}

const q = <T extends HTMLElement = HTMLElement>(el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

async function click(el: TillTableOrderScreen, selector: string): Promise<void> {
  q(el, selector)!.click();
  await el.updateComplete;
}

async function toPanel(el: TillTableOrderScreen, tableId = "t8"): Promise<void> {
  await click(el, "[data-move-split]");
  await click(el, '[data-action="split-table"]');
  await click(el, `[data-target="${tableId}"]`);
  await settled(el);
}

async function settled(el: TillTableOrderScreen): Promise<void> {
  await el.updateComplete;
  const picker = splitPicker(el);
  await picker?.updateComplete;
  for (const each of picker?.shadowRoot!.querySelectorAll("till-portion-picker") ?? [])
    await each.updateComplete;
}

const splitPicker = (el: TillTableOrderScreen) => q<TillSplitPicker>(el, "till-split-picker");
const billIds = (el: TillTableOrderScreen) =>
  [...splitPicker(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-split-bill]")].map(
    (bill) => bill.dataset.splitBill,
  );
const rowIds = (el: TillTableOrderScreen, billId: string) =>
  [
    ...splitPicker(el)!
      .shadowRoot!.querySelector(`[data-split-bill="${billId}"] till-portion-picker`)!
      .shadowRoot!.querySelectorAll<HTMLElement>("[data-pick-row]"),
  ].map((row) => row.dataset.pickRow);

async function tickBill(el: TillTableOrderScreen, billId: string): Promise<void> {
  splitPicker(el)!
    .shadowRoot!.querySelector<HTMLInputElement>(`[data-split-tick="${billId}"]`)!
    .click();
  await settled(el);
}

async function pickDish(el: TillTableOrderScreen, billId: string, row: string): Promise<void> {
  splitPicker(el)!
    .shadowRoot!.querySelector(`[data-split-bill="${billId}"] till-portion-picker`)!
    .shadowRoot!.querySelector<HTMLInputElement>(`[data-pick="${row}"]`)!
    .click();
  await settled(el);
}

type Side = "staying" | "leaving";
const stepper = (el: TillTableOrderScreen, side: Side) =>
  q<HTMLElementTagNameMap["wt-number-stepper"]>(el, `wt-number-stepper[name="${side}Guests"]`)!;
const nativeInput = (el: TillTableOrderScreen, side: Side) =>
  stepper(el, side).shadowRoot!.querySelector<HTMLInputElement>("input")!;

async function typeCount(el: TillTableOrderScreen, side: Side, value: string): Promise<void> {
  const input = nativeInput(el, side);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

const split = (el: TillTableOrderScreen) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-split-confirm]")!;
const bottom = (el: TillTableOrderScreen) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(el, "[data-split-pick] wt-form-actions")!;
const textOf = (el: TillTableOrderScreen, selector: string) =>
  q(el, selector)?.textContent!.replace(/\s+/g, " ").trim();

function heard<T>(el: TillTableOrderScreen, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("Split a table's panel at phone width", () => {
  let viewport: [number, number];
  beforeEach(() => {
    viewport = [window.innerWidth, window.innerHeight];
  });
  afterEach(() => page.viewport(...viewport));

  it("keeps each part apart, with the guest steppers clear of Back and Split", async () => {
    await page.viewport(390, 844);
    const el = await mountScreen();
    await toPanel(el);
    // The note is the last of the summary lines, so the panel is at its full height.
    await pickDish(el, "b1", "soup");
    await Promise.all([
      stepper(el, "leaving").updateComplete,
      split(el).updateComplete,
      bottom(el).updateComplete,
    ]);
    expect(window.innerWidth).toBe(390);

    const section = q(el, "[data-split-pick]")!;
    const token = (name: string) => parseFloat(getComputedStyle(section).getPropertyValue(name));
    const box = (part: Element) => part.getBoundingClientRect();
    const hint = q(el, "[data-split-hint]")!;
    const picker = splitPicker(el)!;
    const takes = q(el, "[data-split-takes]")!;
    const keeps = q(el, "[data-split-keeps]")!;
    const note = q(el, "[data-split-new-bill-note]")!;
    const guests = q(el, ".split-counts")!;
    const row = bottom(el);
    const stepButton = (step: string) =>
      stepper(el, "leaving").shadowRoot!.querySelector(`[data-step="${step}"]`)!;

    const between = (above: Element, below: Element) => box(below).top - box(above).bottom;
    const gaps = {
      hintToPicker: between(hint, picker),
      pickerToSummary: between(picker, takes),
      noteToGuests: between(note, guests),
      guestsToActions: between(guests, row),
      plusToActions: between(stepButton("1"), row),
      minusToActions: between(stepButton("-1"), row),
    };
    const part = token("--wt-space-4");
    expect(part).toBeGreaterThan(0);
    for (const [name, gap] of Object.entries(gaps))
      expect(gap, `${name} of ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(part);
    // What says what the split will do reads as one part.
    expect(between(takes, keeps)).toBeLessThan(part);
    expect(between(keeps, note)).toBeLessThan(part);
    expect(between(takes, keeps)).toBeGreaterThan(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});

describe("Split a table's panel", () => {
  it("tapping a table opens the pick step and tells the app, with a prompt", async () => {
    const el = await mountScreen();
    const opened = heard<{ tableId: string; prompt: object }>(el, "split-table-open");

    await toPanel(el);

    expect(q(el, "[data-split-pick]")).not.toBeNull();
    expect(opened).toEqual([{ tableId: "t8", prompt: expect.any(Object) }]);
  });

  it.each([
    ["en-GB", "T8 leaves García (T7, T8)", "Split"],
    [
      "es-ES",
      fill(t("table.split_pick_heading", "es-ES"), { table: "T8", party: "García (T7, T8)" }),
      t("table.split_guests_confirm", "es-ES"),
    ],
  ])(
    "names its heading and Split in %s, and the heading has focus",
    async (locale, heading, action) => {
      setLocale(locale);
      const el = await mountScreen();
      await userEvent.click(q(el, "[data-move-split]")!);
      await userEvent.click(q(el, '[data-action="split-table"]')!);
      await el.updateComplete;
      await userEvent.click(q(el, '[data-target="t8"]')!);
      await settled(el);

      const h2 = q(el, "[data-split-pick] h2")!;
      expect(h2.textContent!.trim()).toBe(heading);
      expect(el.shadowRoot!.activeElement).toBe(h2);
      expect(split(el).textContent!.trim()).toBe(action);
    },
  );

  it("names a table renamed for today by its name", async () => {
    const el = await mountScreen({
      tables: [table("t7"), table("t8", { today: { name: "Window" } as TableState["today"] })],
    });
    await toPanel(el);

    expect(q(el, "[data-split-pick] h2")!.textContent!.trim()).toBe(
      "Window leaves García (T7, Window)",
    );
    expect(stepper(el, "leaving").label).toBe("Guests at Window");
  });

  it("starts the staying side empty when the party has no count", async () => {
    const noCount = { ...garcia, guestCount: null };
    const el = await mountScreen({
      party: noCount,
      tables: tables.map((each) => ({ ...each, party: noCount })),
    });
    await toPanel(el);

    expect(nativeInput(el, "staying").value).toBe("");
    expect(nativeInput(el, "leaving").value).toBe("");
  });

  it("the list step's heading names the party, and it lists the party's tables", async () => {
    const el = await mountScreen();
    await click(el, "[data-move-split]");
    await click(el, '[data-action="split-table"]');

    expect(q(el, "[data-split-table] h2")!.textContent!.trim()).toBe(
      "Split a table off García (T7, T8):",
    );
    expect(q(el, '[data-target="t7"]')!.textContent!.trim()).toBe("T7");
    expect(q(el, '[data-target="t8"]')!.textContent!.trim()).toBe("T8");
  });

  it("the list step names a table renamed for today by its name, in its choice and its heading", async () => {
    const el = await mountScreen({
      tables: [table("t7"), table("t8", { today: { name: "Window" } as TableState["today"] })],
    });
    await click(el, "[data-move-split]");
    await click(el, '[data-action="split-table"]');

    expect(q(el, '[data-target="t8"]')!.textContent!.trim()).toBe("Window");
    expect(q(el, "[data-split-table] h2")!.textContent!.trim()).toBe(
      "Split a table off García (T7, Window):",
    );
  });

  it("the hint names the tables that stay", async () => {
    const threeTables = { ...garcia, tableIds: ["t7", "t8", "t9"] };
    const el = await mountScreen({
      party: threeTables,
      tables: [table("t7"), table("t8"), table("t9")],
    });
    await toPanel(el, "t8");

    expect(textOf(el, "[data-split-hint]")).toBe(
      fill(t("table.split_pick_hint"), { table: "T8", kept: "T7, T9" }),
    );
  });

  it("draws its rows from the read, in number order, one per dish", async () => {
    const el = await mountScreen();
    await toPanel(el);

    expect(billIds(el)).toEqual(["b1", "b2", "b3"]);
    expect(rowIds(el, "b1")).toEqual(["soup", "salad", "bread", "steak"]);
    expect(rowIds(el, "b3")).toEqual(["fish"]);
  });

  it("tells this person's own draft from someone else's", async () => {
    const el = await mountScreen({
      partyDrafts: [draft("b1", "me", "Me"), draft("b2", "ana", "Ana")],
    });
    await toPanel(el);

    const sources = splitPicker(el)!.sources;
    expect(sources[0]!.ownUnsent).toBe(true);
    expect(sources[0]!.held).toBeNull();
    expect(sources[1]!.ownUnsent).toBe(false);
    expect(sources[1]!.held).toMatchObject({ draftId: "draft-b2", ownerName: "Ana" });
  });

  it("draws no rows until it knows who the person is, then reads their own draft as theirs", async () => {
    const el = await mountScreen({ personId: "", partyDrafts: [draft("b2", "me", "Me")] });
    await toPanel(el);

    expect(splitPicker(el)).toBeNull();
    expect(split(el).variant).toBe("secondary");
    expect(split(el).disabled).toBe(true);
    expect(bottom(el).error).toBe("");

    el.personId = "me";
    await settled(el);

    const bill2 = splitPicker(el)!.sources.find((source) => source.bill.workingOrderId === "b2")!;
    expect(bill2.held).toBeNull();
    expect(bill2.ownUnsent).toBe(true);
    expect(split(el).variant).toBe("primary");
    expect(split(el).disabled).toBe(false);
  });

  it("labels its two steppers, the staying one from the party's count, the leaving one blank", async () => {
    const el = await mountScreen();
    await toPanel(el);

    expect(nativeInput(el, "staying").name).toBe("stayingGuests");
    expect(nativeInput(el, "leaving").name).toBe("leavingGuests");
    expect(stepper(el, "staying").label).toBe("Guests at T7");
    expect(stepper(el, "leaving").label).toBe("Guests at T8");
    expect(nativeInput(el, "staying").value).toBe("5");
    expect(nativeInput(el, "leaving").value).toBe("");
    expect(stepper(el, "staying").error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it.each(["en-GB", "es-ES"])(
    "draws its guest fields with no placeholder in %s",
    async (locale) => {
      setLocale(locale);
      const el = await mountScreen();
      await toPanel(el);

      for (const side of ["staying", "leaving"] as const) {
        expect(stepper(el, side).placeholder).toBe("");
        expect(nativeInput(el, side).hasAttribute("placeholder")).toBe(false);
      }
      expect(q(el, "[data-split-pick]")!.textContent).not.toContain(
        t("receipt.guests_none", locale),
      );
    },
  );

  it("the steppers' changes stop at the screen", async () => {
    const el = await mountScreen();
    await toPanel(el);
    const changes = heard(el, "wt-change");

    await typeCount(el, "leaving", "2");

    expect(changes).toEqual([]);
    expect(nativeInput(el, "leaving").value).toBe("2");
  });

  it("offers Split at once in its own colour once the read has answered", async () => {
    const el = await mountScreen();
    await toPanel(el);

    expect(split(el).variant).toBe("primary");
    expect(split(el).disabled).toBe(false);
  });

  it("says what each table takes and keeps, board 08's example", async () => {
    const el = await mountScreen();
    await toPanel(el);

    await tickBill(el, "b2");
    await tickBill(el, "b3");
    await pickDish(el, "b1", "soup");
    await pickDish(el, "b1", "salad");
    await pickDish(el, "b1", "bread");

    expect(textOf(el, "[data-split-takes]")).toBe(
      "T8 takes Bill 2, Bill 3 and 3 dishes from Bill 1 · €109.00",
    );
    expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps the rest of Bill 1 · €67.00");
  });

  it("joins the summary's list the Spanish way, with no comma before the last part", async () => {
    setLocale("es-ES");
    const el = await mountScreen();
    await toPanel(el);

    await tickBill(el, "b2");
    await tickBill(el, "b3");
    await pickDish(el, "b1", "soup");
    await pickDish(el, "b1", "salad");
    await pickDish(el, "b1", "bread");

    const bill = (n: number) => billLabel(partyBill(`b${n}`, n, "1.00"));
    expect(textOf(el, "[data-split-takes]")).toBe(
      fill(t("table.split_takes", "es-ES"), {
        table: "T8",
        what: `${bill(2)}, ${bill(3)} y ${fill(t("table.split_dishes_from", "es-ES"), { count: "3", bill: bill(1) })}`,
        amount: formatMoney(decimal("109.00"), "es-ES"),
      }).replace(/\s+/g, " "),
    );
  });

  it("says one dish in the singular", async () => {
    const el = await mountScreen();
    await toPanel(el);

    await pickDish(el, "b1", "soup");

    expect(textOf(el, "[data-split-takes]")).toBe("T8 takes 1 dish from Bill 1 · €10.00");
    expect(textOf(el, "[data-split-keeps]")).toBe(
      "T7 keeps Bill 2, Bill 3 and the rest of Bill 1 · €166.00",
    );
  });

  it("with nothing ticked the leaving table takes an empty bill", async () => {
    const el = await mountScreen();
    await toPanel(el);

    expect(textOf(el, "[data-split-takes]")).toBe("T8 takes an empty bill · €0.00");
    expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps Bill 1, Bill 2 and Bill 3 · €176.00");
  });

  it.each([
    ["en-GB", "T7 is left with nothing to pay"],
    ["es-ES", fill(t("table.split_nothing_to_pay", "es-ES"), { table: "T7" })],
  ])(
    "with only paid bills staying the staying line in %s says nothing to pay, with no amount",
    async (locale, line) => {
      setLocale(locale);
      const el = await mountScreen({
        bills: [partyBill("b1", 1, "0.00", { status: "settled" }), partyBill("b2", 2, "40.00")],
        splitRead: read({ b2: [dish("wine", 5, "40.00")] }, { b2: "40.00" }),
      });
      await toPanel(el);

      await tickBill(el, "b2");

      expect(textOf(el, "[data-split-keeps]")).toBe(line);
    },
  );

  it.each([
    ["en-GB", "T7 keeps Bill 2 · €40.00"],
    [
      "es-ES",
      fill(t("table.split_keeps", "es-ES"), {
        table: "T7",
        what: billNumberInSpanish(2),
        amount: formatMoney(decimal("40.00"), "es-ES"),
      }),
    ],
  ])(
    "a paid bill beside one with an amount owing leaves the staying line's amount in %s",
    async (locale, line) => {
      setLocale(locale);
      const el = await mountScreen({
        bills: [
          partyBill("b1", 1, "0.00", { status: "settled" }),
          partyBill("b2", 2, "40.00"),
          partyBill("b3", 3, "9.00"),
        ],
        splitRead: read(
          { b2: [dish("wine", 5, "40.00")], b3: [dish("beer", 6, "9.00")] },
          { b2: "40.00", b3: "9.00" },
        ),
      });
      await toPanel(el);

      await tickBill(el, "b3");

      expect(textOf(el, "[data-split-keeps]")).toBe(line.replace(/\s+/g, " "));
    },
  );

  it("a pick left on a bill that has since been paid still shows the rest of that bill and its amount", async () => {
    const el = await mountScreen({
      bills: [partyBill("b1", 1, "30.00", { status: "settled" }), partyBill("b2", 2, "40.00")],
      splitRead: read(
        {
          b1: [dish("soup", 1, "10.00"), dish("salad", 2, "20.00")],
          b2: [dish("wine", 5, "40.00")],
        },
        { b1: "30.00", b2: "40.00" },
      ),
    });
    await toPanel(el);

    await tickBill(el, "b2");
    await pickDish(el, "b1", "soup");

    expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps the rest of Bill 1 · €20.00");
  });

  describe("a bill the split itself leaves fully paid", () => {
    const soupAndSteak = [dish("steak", 1, "20.00"), dish("soup", 2, "10.00")];
    const wine = [dish("wine", 5, "40.00")];

    it.each([
      ["en-GB", "T7 is left with nothing to pay"],
      ["es-ES", fill(t("table.split_nothing_to_pay", "es-ES"), { table: "T7" })],
    ])("€20 received on €30, its unpaid €10 dish picked, in %s", async (locale, line) => {
      setLocale(locale);
      const el = await mountScreen({
        bills: [partyBill("b1", 1, "10.00", { total: "30.00" })],
        splitRead: read({ b1: soupAndSteak }, { b1: "30.00" }, { b1: { received: "20.00" } }),
      });
      await toPanel(el);

      await pickDish(el, "b1", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe(line);
    });

    it("the amount stays while what is picked leaves money owing on the bill", async () => {
      const el = await mountScreen({
        bills: [partyBill("b1", 1, "20.00", { total: "30.00" })],
        splitRead: read({ b1: soupAndSteak }, { b1: "30.00" }, { b1: { received: "10.00" } }),
      });
      await toPanel(el);

      await pickDish(el, "b1", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps the rest of Bill 1 · €20.00");
    });

    it("one left fully paid beside one still owing keeps the amount", async () => {
      const el = await mountScreen({
        bills: [partyBill("b1", 1, "10.00", { total: "30.00" }), partyBill("b2", 2, "40.00")],
        splitRead: read(
          { b1: soupAndSteak, b2: wine },
          { b1: "30.00", b2: "40.00" },
          { b1: { received: "20.00" } },
        ),
      });
      await toPanel(el);

      await pickDish(el, "b1", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe(
        "T7 keeps Bill 2 and the rest of Bill 1 · €60.00",
      );
    });

    it("a bill paid before beside the rest of one still owing keeps the amount", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("b1", 1, "0.00", { status: "settled", total: "9.00" }),
          partyBill("b2", 2, "30.00", { total: "30.00" }),
        ],
        splitRead: read({ b2: soupAndSteak }, { b2: "30.00" }),
      });
      await toPanel(el);

      await pickDish(el, "b2", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps the rest of Bill 2 · €20.00");
    });

    it("a bill paid before beside one the split leaves fully paid: nothing to pay", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("b1", 1, "0.00", { status: "settled", total: "9.00" }),
          partyBill("b2", 2, "10.00", { total: "30.00" }),
        ],
        splitRead: read({ b2: soupAndSteak }, { b2: "30.00" }, { b2: { received: "20.00" } }),
      });
      await toPanel(el);

      await pickDish(el, "b2", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe("T7 is left with nothing to pay");
    });

    it("two bills both left fully paid: nothing to pay", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("b1", 1, "10.00", { total: "30.00" }),
          partyBill("b2", 2, "5.00", { total: "45.00" }),
        ],
        splitRead: read(
          { b1: soupAndSteak, b2: [...wine, dish("beer", 6, "5.00")] },
          { b1: "30.00", b2: "45.00" },
          { b1: { received: "20.00" }, b2: { received: "40.00" } },
        ),
      });
      await toPanel(el);

      await pickDish(el, "b1", "soup");
      await pickDish(el, "b2", "beer");

      expect(textOf(el, "[data-split-keeps]")).toBe("T7 is left with nothing to pay");
    });

    it("a €0.00 dish left, with a paid bill beside, keeps its amount as it does with none", async () => {
      const free = [dish("water", 1, "0.00"), dish("soup", 2, "10.00")];
      const el = await mountScreen({
        bills: [
          partyBill("b1", 1, "0.00", { status: "settled", total: "9.00" }),
          partyBill("b2", 2, "10.00", { total: "10.00" }),
        ],
        splitRead: read({ b2: free }, { b2: "10.00" }),
      });
      await toPanel(el);

      await pickDish(el, "b2", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps the rest of Bill 2 · €0.00");
    });

    const refund = (state: BillRefundView["state"]) => ({
      payments: [{ refunds: [{ state }] }] as unknown as BillBalance["payments"],
    });

    it.each([
      ["still going through", "pending", "T7 keeps the rest of Bill 1 · €20.00"],
      ["that failed", "failed", "T7 is left with nothing to pay"],
    ] as const)("a card refund %s on the staying bill: %s", async (_name, state, line) => {
      const el = await mountScreen({
        bills: [partyBill("b1", 1, "10.00", { total: "30.00" })],
        splitRead: read(
          { b1: soupAndSteak },
          { b1: "30.00" },
          { b1: { received: "20.00", ...refund(state) } },
        ),
      });
      await toPanel(el);

      await pickDish(el, "b1", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe(line);
    });

    it("one left fully paid beside an empty bill keeps the amount", async () => {
      const el = await mountScreen({
        bills: [partyBill("b1", 1, "10.00", { total: "30.00" }), partyBill("b2", 2, "0.00")],
        splitRead: read(
          { b1: soupAndSteak, b2: [] },
          { b1: "30.00", b2: "0.00" },
          { b1: { received: "20.00" } },
        ),
      });
      await toPanel(el);

      await pickDish(el, "b1", "soup");

      expect(textOf(el, "[data-split-keeps]")).toBe(
        "T7 keeps Bill 2 and the rest of Bill 1 · €20.00",
      );
    });

    it.each([
      ["all of it in progress", { reserved: "20.00" }],
      ["part of it in progress", { received: "10.00", reserved: "10.00" }],
    ])(
      "a card in progress is not money received, so the amount stays: %s",
      async (_name, money) => {
        const el = await mountScreen({
          bills: [partyBill("b1", 1, "30.00", { total: "30.00" })],
          splitRead: read({ b1: soupAndSteak }, { b1: "30.00" }, { b1: money }),
        });
        await toPanel(el);

        await pickDish(el, "b1", "soup");

        expect(textOf(el, "[data-split-keeps]")).toBe("T7 keeps the rest of Bill 1 · €20.00");
      },
    );
  });

  it.each([
    ["en-GB", "T7 keeps an empty bill · €0.00"],
    [
      "es-ES",
      fill(t("table.split_keeps", "es-ES"), {
        table: "T7",
        what: t("table.split_empty_bill", "es-ES"),
        amount: formatMoney(decimal("0.00"), "es-ES"),
      }),
    ],
  ])(
    "with no bill staying and none paid the staying line in %s says an empty bill, with its amount",
    async (locale, line) => {
      setLocale(locale);
      const el = await mountScreen({
        bills: [partyBill("b2", 2, "40.00")],
        splitRead: read({ b2: [dish("wine", 5, "40.00")] }, { b2: "40.00" }),
      });
      await toPanel(el);

      await tickBill(el, "b2");

      expect(textOf(el, "[data-split-keeps]")).toBe(line.replace(/\s+/g, " "));
    },
  );

  it("a party with no bill is told its staying table is left with nothing to pay, since the server makes it no bill", async () => {
    const el = await mountScreen({ bills: [], splitRead: { bills: [] } });
    await toPanel(el);

    expect(textOf(el, "[data-split-takes]")).toBe("T8 takes an empty bill · €0.00");
    expect(textOf(el, "[data-split-keeps]")).toBe("T7 is left with nothing to pay");
  });

  it("the new-bill note shows only while a loose dish is ticked", async () => {
    const el = await mountScreen();
    await toPanel(el);
    expect(q(el, "[data-split-new-bill-note]")).toBeNull();

    await tickBill(el, "b2");
    expect(q(el, "[data-split-new-bill-note]")).toBeNull();

    await pickDish(el, "b1", "soup");
    expect(textOf(el, "[data-split-new-bill-note]")).toBe("Single dishes go on a new bill at T8.");

    await pickDish(el, "b1", "soup");
    expect(q(el, "[data-split-new-bill-note]")).toBeNull();
  });

  it("the new-bill note's Spanish words", async () => {
    setLocale("es-ES");
    const el = await mountScreen();
    await toPanel(el);

    await pickDish(el, "b1", "soup");

    const note = fill(t("table.split_new_bill_note", "es-ES"), { table: "T8" });
    expect(note).not.toBe(fill(t("table.split_new_bill_note", "en-GB"), { table: "T8" }));
    expect(textOf(el, "[data-split-new-bill-note]")).toBe(note);
  });

  it.each([
    ["Back", (el: TillTableOrderScreen) => click(el, "[data-action-back]")],
    [
      "Escape",
      async (el: TillTableOrderScreen) => {
        q(el, "[data-split-pick] h2")!.focus();
        await userEvent.keyboard("{Escape}");
        await el.updateComplete;
      },
    ],
  ])("%s returns to the tables and sends nothing", async (_name, leave) => {
    const el = await mountScreen();
    const sent = heard(el, "split-table");
    await toPanel(el);

    await leave(el);

    expect(q(el, "[data-split-pick]")).toBeNull();
    expect(q(el, '[data-target="t8"]')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it("Split sends the selection, both counts and the prompt once, and closes", async () => {
    const el = await mountScreen();
    const opened = heard<{ prompt: object }>(el, "split-table-open");
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await tickBill(el, "b3");
    await pickDish(el, "b1", "salad");
    await typeCount(el, "staying", " 3 ");
    await typeCount(el, "leaving", "2");

    split(el).click();
    await el.updateComplete;

    expect(sent).toEqual([
      {
        tableId: "t8",
        selection: { wholeBillIds: ["b3"], loose: [{ billId: "b1", lineIds: ["salad"] }] },
        guestCounts: { staying: 3, leaving: 2 },
        prompt: opened[0]!.prompt,
      },
    ]);
    expect(q(el, "[data-action-panel]")).toBeNull();
  });

  it("nothing ticked sends an empty selection, and blank counts as null", async () => {
    const el = await mountScreen();
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await typeCount(el, "staying", "  ");

    split(el).click();
    await el.updateComplete;

    expect(sent).toEqual([
      {
        tableId: "t8",
        selection: { wholeBillIds: [], loose: [] },
        guestCounts: { staying: null, leaving: null },
        prompt: expect.any(Object),
      },
    ]);
  });

  it("opening the panel again starts it again", async () => {
    const el = await mountScreen();
    await toPanel(el);
    await tickBill(el, "b2");
    await typeCount(el, "leaving", "0");
    split(el).click();
    await el.updateComplete;

    await click(el, "[data-action-back]");
    await click(el, '[data-target="t8"]');
    await settled(el);

    expect(splitPicker(el)!.split.whole.size).toBe(0);
    expect(nativeInput(el, "leaving").value).toBe("");
    expect(stepper(el, "leaving").error).toBe("");
    expect(split(el).disabled).toBe(false);
  });

  describe("the read", () => {
    it("with no read answered Split is quiet and disabled, and says nothing", async () => {
      const el = await mountScreen({ splitRead: null });
      const sent = heard(el, "split-table");
      await toPanel(el);

      expect(split(el).variant).toBe("secondary");
      expect(split(el).disabled).toBe(true);
      expect(bottom(el).error).toBe("");
      split(el).click();
      await el.updateComplete;
      expect(sent).toEqual([]);
    });

    it("a first read that failed says so at the bottom at once, and Split stays quiet", async () => {
      const el = await mountScreen({ splitRead: "failed" });
      const sent = heard(el, "split-table");
      await toPanel(el);

      expect(bottom(el).error).toBe(t("table.split_read_failed"));
      expect(split(el).variant).toBe("secondary");
      expect(split(el).disabled).toBe(true);
      split(el).click();
      await el.updateComplete;
      expect(sent).toEqual([]);
    });

    it("a read answering after a failure replaces the message with the rows", async () => {
      const el = await mountScreen({ splitRead: "failed" });
      await toPanel(el);

      el.splitRead = board08.splitRead;
      await settled(el);

      expect(bottom(el).error).toBe("");
      expect(billIds(el)).toEqual(["b1", "b2", "b3"]);
      expect(split(el).variant).toBe("primary");
    });

    it("a read failing after one has answered keeps the last rows, says nothing, and leaves Split enabled", async () => {
      const el = await mountScreen();
      const sent = heard(el, "split-table");
      await toPanel(el);
      await tickBill(el, "b2");

      el.splitRead = "failed";
      await settled(el);

      expect(billIds(el)).toEqual(["b1", "b2", "b3"]);
      expect(bottom(el).error).toBe("");
      expect(split(el).variant).toBe("primary");
      expect(split(el).disabled).toBe(false);
      split(el).click();
      await el.updateComplete;
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ selection: { wholeBillIds: ["b2"], loose: [] } });
    });

    it("the rows are kept until one of their inputs changes", async () => {
      const el = await mountScreen();
      await toPanel(el);
      const before = splitPicker(el)!.sources;

      el.requestUpdate();
      await settled(el);
      expect(splitPicker(el)!.sources).toBe(before);

      el.partyDrafts = [];
      await settled(el);
      expect(splitPicker(el)!.sources).not.toBe(before);
    });

    it("a dish recalled on a bill not on screen is in no row", async () => {
      const el = await mountScreen({
        partyDrafts: [
          {
            id: "draft",
            partyId: garcia.id,
            billId: "b2",
            ownerId: "ana",
            ownerName: "Ana",
            revision: 1,
            lines: [],
            takenOverFrom: null,
          },
          {
            id: "draft-3",
            partyId: garcia.id,
            billId: "b3",
            ownerId: "me",
            ownerName: "Me",
            revision: 1,
            lines: [{ sourceLineId: "fish" } as Draft["lines"][number]],
            takenOverFrom: null,
          },
        ],
      });
      await toPanel(el);

      expect(rowIds(el, "b1")).toEqual(["soup", "salad", "bread", "steak"]);
      expect(rowIds(el, "b3")).toEqual([]);
    });

    it("a dish recalled on screen, which no draft read has yet, is in no row", async () => {
      const el = await mountScreen({
        otherDrafts: [
          {
            id: "other",
            revision: 1,
            ownerName: "Ana",
            takenFromYou: false,
            lines: [
              {
                product: { id: "soup", name: "soup" },
                quantity: "1",
                source: { line: { id: "soup" }, extras: [], netAmount: "10.00" },
              },
            ],
          },
        ] as unknown as TillTableOrderScreen["otherDrafts"],
      });
      await toPanel(el);

      expect(rowIds(el, "b1")).toEqual(["salad", "bread", "steak"]);
    });

    it("two portions of one dish draw as one row without marks, and as two with different allergy marks", async () => {
      const beer = (id: string, lineNo: number) =>
        dish(id, lineNo, "5.00", {
          name: "Beer",
          productId: "beer",
          menuItemId: "offer-beer",
        });
      const splitRead = read({ b1: [beer("c1", 1), beer("c2", 2)] }, { b1: "10.00" });
      const bills = [partyBill("b1", 1, "10.00")];
      const rowCount = (el: TillTableOrderScreen) => rowIds(el, "b1").length;

      const plain = await mountScreen({ bills, splitRead });
      await toPanel(plain);
      expect(rowCount(plain)).toBe(1);

      const allergyView: PartyAllergyRead = {
        partyId: garcia.id,
        snapshot: {
          answer: "allergies",
          revision: 1,
          changedAt: null,
          changedBy: null,
          guests: [{ id: "g", position: 0, who: "Red hat", allergens: { milk: {} }, note: null }],
          ticks: [{ guestId: "g", draftLineId: null, workingLineId: "c1" }],
        },
        dishes: [],
      } as PartyAllergyRead;
      const marked = await mountScreen({ bills, splitRead, allergyView });
      await toPanel(marked);
      expect(rowCount(marked)).toBe(2);
    });
  });

  describe("the guest counts", () => {
    for (const side of ["staying", "leaving"] as const) {
      const other: Side = side === "staying" ? "leaving" : "staying";
      it.each(["0", "1000", "2.5", "abc"])(
        `refuses %s in the ${side} field beside it and at the bottom, disables Split, and works again once fixed`,
        async (bad) => {
          const el = await mountScreen();
          const sent = heard<SplitTableDetail>(el, "split-table");
          await toPanel(el);

          await typeCount(el, side, bad);
          split(el).click();
          await el.updateComplete;

          expect(sent).toEqual([]);
          expect(q(el, "[data-action-panel]")).not.toBeNull();
          expect(stepper(el, side).error).toBe(t("seat.guest_count_invalid"));
          expect(stepper(el, other).error).toBe("");
          expect(bottom(el).error).toBe(t("form.fix_fields"));
          expect(split(el).disabled).toBe(true);
          await vi.waitFor(() =>
            expect(stepper(el, side).shadowRoot!.activeElement).toBe(nativeInput(el, side)),
          );

          await typeCount(el, side, "2");

          expect(stepper(el, side).error).toBe("");
          expect(bottom(el).error).toBe("");
          expect(split(el).disabled).toBe(false);
          split(el).click();
          await el.updateComplete;
          expect(sent).toHaveLength(1);
          expect(sent[0]!.guestCounts).toEqual(
            side === "staying" ? { staying: 2, leaving: null } : { staying: 5, leaving: 2 },
          );
        },
      );
    }

    it("says nothing about a bad count until Split is pressed", async () => {
      const el = await mountScreen();
      await toPanel(el);

      await typeCount(el, "leaving", "0");

      expect(stepper(el, "leaving").error).toBe("");
      expect(bottom(el).error).toBe("");
      expect(split(el).disabled).toBe(false);
    });

    it("marks both fields when both are bad", async () => {
      const el = await mountScreen();
      const sent = heard(el, "split-table");
      await toPanel(el);

      await typeCount(el, "staying", "0");
      await typeCount(el, "leaving", "x");
      split(el).click();
      await el.updateComplete;

      expect(sent).toEqual([]);
      expect(stepper(el, "staying").error).toBe(t("seat.guest_count_invalid"));
      expect(stepper(el, "leaving").error).toBe(t("seat.guest_count_invalid"));
    });

    const enter = (el: TillTableOrderScreen, side: Side) =>
      nativeInput(el, side).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
      );

    it("a busy till takes no count, and one typed before stays", async () => {
      const el = await mountScreen();
      await toPanel(el);
      await typeCount(el, "leaving", "2");

      el.busy = true;
      await el.updateComplete;
      await stepper(el, "leaving").updateComplete;
      expect(stepper(el, "leaving").disabled).toBe(true);
      expect(stepper(el, "staying").disabled).toBe(true);
      expect(nativeInput(el, "leaving").disabled).toBe(true);

      el.busy = false;
      await el.updateComplete;
      await stepper(el, "leaving").updateComplete;
      expect(nativeInput(el, "leaving").disabled).toBe(false);
      expect(nativeInput(el, "leaving").value).toBe("2");
    });

    describe("a count holding focus when the till goes busy", () => {
      const control = (el: TillTableOrderScreen, selector: string) =>
        stepper(el, "leaving").shadowRoot!.querySelector<HTMLElement>(selector)!;
      async function focusThenBusy(el: TillTableOrderScreen, selector: string) {
        control(el, selector).focus();
        expect(stepper(el, "leaving").shadowRoot!.activeElement).toBe(control(el, selector));
        el.busy = true;
        await expect.poll(() => document.activeElement).toBe(document.body);
      }

      it.each([
        ["the typed count", "input"],
        ["the plus button", '[data-step="1"]'],
      ])("%s gets focus back when the till is free", async (_name, selector) => {
        const el = await mountScreen();
        await toPanel(el);
        await typeCount(el, "leaving", "2");
        await focusThenBusy(el, selector);

        el.busy = false;

        await expect
          .poll(() => stepper(el, "leaving").shadowRoot!.activeElement)
          .toBe(control(el, selector));
      });

      it("focus the waiter has since moved elsewhere stays there", async () => {
        const el = await mountScreen();
        await toPanel(el);
        await focusThenBusy(el, "input");
        const back = q(el, "[data-action-back]")!;
        back.focus();

        el.busy = false;
        await el.updateComplete;
        await stepper(el, "leaving").updateComplete;
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(focused(el)).toBe(back);
      });

      it("a busy till with focus off the counts moves nothing when it is free", async () => {
        const el = await mountScreen();
        await toPanel(el);
        const back = q(el, "[data-action-back]")!;
        back.focus();

        el.busy = true;
        await el.updateComplete;
        el.busy = false;
        await el.updateComplete;
        await stepper(el, "leaving").updateComplete;

        expect(focused(el)).toBe(back);
      });
    });

    it("refuses a bad count sent with Enter and dispatches nothing", async () => {
      const el = await mountScreen();
      const sent = heard(el, "split-table");
      await toPanel(el);
      await typeCount(el, "leaving", "0");

      enter(el, "leaving");
      await el.updateComplete;

      expect(sent).toEqual([]);
      expect(stepper(el, "leaving").error).toBe(t("seat.guest_count_invalid"));
    });

    it.each(["staying", "leaving"] as const)(
      "splits with Enter from the %s field",
      async (side) => {
        const el = await mountScreen();
        const sent = heard(el, "split-table");
        await toPanel(el);

        enter(el, side);
        await el.updateComplete;

        expect(sent).toHaveLength(1);
      },
    );
  });
});

const refundButton = (billId: string) =>
  html`<span class="error-action"
    ><wt-button
      data-refund-excess
      @click=${(event: Event) =>
        event.currentTarget!.dispatchEvent(
          new CustomEvent("refund-excess", {
            detail: { billId },
            bubbles: true,
            composed: true,
          }),
        )}
      >Refund</wt-button
    ></span
  >`;

const reopenedAt = (over: Partial<SplitRefusal> = {}) =>
  ({
    tableId: "t8",
    selection: { wholeBillIds: ["b3"], loose: [{ billId: "b1", lineIds: ["salad"] }] },
    staying: "3",
    leaving: "2",
    message: "Refused",
    ...over,
  }) as SplitRefusal;

async function refuse(el: TillTableOrderScreen, refusal: SplitRefusal): Promise<void> {
  el.splitRefusal = refusal;
  await settled(el);
}

const ticked = (el: TillTableOrderScreen) => splitPicker(el)!.split;
const refusalLine = (el: TillTableOrderScreen) => q(el, "[data-split-refusal]");
const inPanel = (el: TillTableOrderScreen) => q(el, "[data-action-panel]") !== null;

/** What a token comes to on a `property` under the screen, for comparing a computed style with. */
function resolved(el: TillTableOrderScreen, property: "color" | "marginTop", token: string) {
  const probe = document.createElement("span");
  probe.style.display = "block";
  probe.style[property] = `var(${token})`;
  el.shadowRoot!.append(probe);
  const value = getComputedStyle(probe)[property];
  probe.remove();
  return value;
}

/** The screen's focus, read through its shadow root. */
const focused = (el: TillTableOrderScreen) => el.shadowRoot!.activeElement as HTMLElement | null;

describe("A803 split: the steps before the panel follow the party", () => {
  const threeTables = [table("t7"), table("t8"), table("t9")];
  const onTables = (...tableIds: string[]) => ({ ...garcia, tableIds });
  const listOpen = (el: TillTableOrderScreen) => q(el, "[data-split-table]") !== null;

  async function toList(over: Partial<TillTableOrderScreen>) {
    const el = await mountScreen({ tables: threeTables, ...over });
    const opened = heard(el, "split-table-open");
    await click(el, "[data-move-split]");
    await click(el, '[data-action="split-table"]');
    expect(listOpen(el)).toBe(true);
    return { el, opened };
  }

  it("a party left on one table closes the list, focus on the \u22ee", async () => {
    const { el, opened } = await toList({});
    q(el, '[data-target="t8"]')!.focus();

    el.party = onTables("t7");
    await settled(el);

    expect(listOpen(el)).toBe(false);
    expect(opened).toEqual([]);
    expect(focused(el)?.matches("[data-table-menu]")).toBe(true);
  });

  it("another party taking over this bill closes the list", async () => {
    const { el, opened } = await toList({});

    el.party = { ...onTables("t7", "t8", "t9"), id: "another", name: "Bob" };
    await settled(el);

    expect(listOpen(el)).toBe(false);
    expect(opened).toEqual([]);
  });

  it("the same party losing one of three tables keeps the list, without that table", async () => {
    const { el } = await toList({ party: onTables("t7", "t8", "t9") });

    el.party = onTables("t7", "t9");
    await settled(el);

    expect(listOpen(el)).toBe(true);
    expect(q(el, '[data-target="t8"]')).toBeNull();
    expect(q(el, '[data-target="t9"]')).not.toBeNull();
  });
});

describe("A803 split: a re-read", () => {
  it("a re-read: a picked dish paid elsewhere drops, and its row says Paid", async () => {
    const el = await mountScreen();
    await toPanel(el);
    await pickDish(el, "b1", "salad");
    await pickDish(el, "b1", "soup");
    const rows = board08.splitRead.bills[0]!.lines;
    el.splitRead = read(
      { b1: rows, b2: [dish("wine", 5, "40.00")], b3: [dish("fish", 6, "39.00")] },
      { b1: "97.00", b2: "40.00", b3: "39.00" },
      {
        b1: {
          received: "10.00",
          paidLines: [{ lineId: "salad", lineNo: 2, paidQuantity: "1.000" }],
        },
      },
    );
    await settled(el);

    expect([...ticked(el).picks.get("b1")!]).toEqual(["soup"]);
    const salad = splitPicker(el)!
      .shadowRoot!.querySelector('[data-split-bill="b1"] till-portion-picker')!
      .shadowRoot!.querySelector('[data-pick-row="salad"]')!;
    expect(salad.textContent).toContain(t("bill_pay.paid"));
  });

  it("a re-read: two of four picked, one paid elsewhere, two are still picked", async () => {
    const beer = (id: string, lineNo: number) =>
      dish(id, lineNo, "5.00", { name: "Beer", productId: "beer", menuItemId: "offer-beer" });
    const rows = [
      beer("c1", 1),
      beer("c2", 2),
      beer("c3", 3),
      beer("c4", 4),
      dish("tea", 5, "5.00"),
    ];
    const el = await mountScreen({
      bills: [partyBill("b1", 1, "25.00")],
      splitRead: read({ b1: rows }, { b1: "25.00" }),
    });
    await toPanel(el);
    await pickDish(el, "b1", "c1");
    const fewer = () =>
      splitPicker(el)!
        .shadowRoot!.querySelector('[data-split-bill="b1"] till-portion-picker')!
        .shadowRoot!.querySelector<HTMLElement>('[data-pick-dec="c1"]')!;
    fewer().click();
    await settled(el);
    fewer().click();
    await settled(el);
    expect([...ticked(el).picks.get("b1")!].sort()).toEqual(["c1", "c2"]);

    el.splitRead = read(
      { b1: rows },
      { b1: "25.00" },
      { b1: { received: "5.00", paidLines: [{ lineId: "c1", lineNo: 1, paidQuantity: "1.000" }] } },
    );
    await settled(el);

    expect([...ticked(el).picks.get("b1")!].sort()).toEqual(["c2", "c3"]);
  });

  it.each([
    ["a party switch", { party: { ...garcia, id: "another", name: "Other" } }],
    ["the table leaving", { party: { ...garcia, tableIds: ["t7", "t9"] } }],
    ["the party going", { party: null }],
    ["the party left on that one table", { party: { ...garcia, tableIds: ["t8"] } }],
  ] as const)("a re-read: %s closes the panel, sending nothing", async (_name, change) => {
    const el = await mountScreen();
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await tickBill(el, "b2");

    Object.assign(el, change);
    await settled(el);

    expect(inPanel(el)).toBe(false);
    expect(sent).toEqual([]);
  });

  it("a re-read: the same party on the same table with a new count keeps the panel", async () => {
    const el = await mountScreen();
    await toPanel(el);
    await tickBill(el, "b2");

    el.party = { ...garcia, guestCount: 9 };
    await settled(el);

    expect([...ticked(el).whole]).toEqual(["b2"]);
  });

  it("a re-read: the party going closes the list of tables, which names the party", async () => {
    const el = await mountScreen();
    await click(el, "[data-move-split]");
    await click(el, '[data-action="split-table"]');
    expect(q(el, "[data-split-table]")).not.toBeNull();

    el.party = null;
    await el.updateComplete;

    expect(q(el, "[data-split-table]")).toBeNull();
    expect(q(el, "[data-action-panel]")).toBeNull();
  });

  it("a re-read: a party with a new count keeps the list of tables", async () => {
    const el = await mountScreen();
    await click(el, "[data-move-split]");
    await click(el, '[data-action="split-table"]');

    el.party = { ...garcia, guestCount: 9 };
    await el.updateComplete;

    expect(q(el, "[data-split-table]")).not.toBeNull();
  });

  it("a re-read: a screen with no party at the first draw has no panel and throws nothing", async () => {
    const el = await mountScreen({ party: null });
    expect(inPanel(el)).toBe(false);
  });
});

describe("A803 split: what the app observes", () => {
  type Observed = { prompt: object; billIds: string[] };

  async function opened() {
    const el = await mountScreen();
    const prompts = heard<{ prompt: object }>(el, "split-table-open");
    const seen = heard<Observed>(el, "split-table-observe");
    await toPanel(el);
    return { el, seen, prompt: prompts[0]!.prompt };
  }

  it("observe: nothing fires on opening", async () => {
    const { seen } = await opened();
    expect(seen).toEqual([]);
  });

  it("observe: a bill ticked, a dish picked off a bill and a bill unticked each fire, with the prompt and sorted ids", async () => {
    const { el, seen, prompt } = await opened();

    await tickBill(el, "b3");
    expect(seen.at(-1)).toEqual({ prompt, billIds: ["b3"] });
    expect(seen.at(-1)!.prompt).toBe(prompt);

    await pickDish(el, "b1", "salad");
    expect(seen.at(-1)).toEqual({ prompt, billIds: ["b1", "b3"] });

    await tickBill(el, "b3");
    expect(seen.at(-1)).toEqual({ prompt, billIds: ["b1"] });
    expect(seen).toHaveLength(3);
  });

  it("observe: a second dish on a bill already in the set does not fire", async () => {
    const { el, seen } = await opened();
    await pickDish(el, "b1", "salad");
    await pickDish(el, "b1", "soup");
    expect(seen).toHaveLength(1);
  });

  it("observe: a re-read dropping a tick fires", async () => {
    const { el, seen, prompt } = await opened();
    await pickDish(el, "b1", "salad");
    await tickBill(el, "b2");
    expect(seen).toHaveLength(2);

    el.bills = board08.bills.filter((bill) => bill.workingOrderId !== "b2");
    await settled(el);

    expect(seen.at(-1)).toEqual({ prompt, billIds: ["b1"] });
    expect(seen).toHaveLength(3);
  });

  it("observe: a refusal reopening the panel fires, with the prompt and what came back", async () => {
    const { el, seen, prompt } = await opened();
    await tickBill(el, "b3");
    await typeCount(el, "leaving", "2");
    split(el).click();
    await settled(el);
    expect(seen).toHaveLength(1);

    await refuse(
      el,
      reopenedAt({ selection: { wholeBillIds: ["b3"], loose: [] }, prompt, field: undefined }),
    );

    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ prompt, billIds: ["b3"] });
    expect(seen[1]!.prompt).toBe(prompt);
  });

  it("observe: a refusal reopening the panel with nothing ticked fires, even for the set last observed", async () => {
    const { el, seen, prompt } = await opened();
    await typeCount(el, "leaving", "2");
    split(el).click();
    await settled(el);
    expect(inPanel(el)).toBe(false);
    expect(seen).toEqual([]);

    await refuse(el, reopenedAt({ selection: { wholeBillIds: [], loose: [] }, prompt }));

    expect(seen).toEqual([{ prompt, billIds: [] }]);
  });

  it("observe: a refusal reopening the panel with no prompt tells the app nothing", async () => {
    const { el, seen } = await opened();
    await typeCount(el, "leaving", "2");
    split(el).click();
    await settled(el);

    await refuse(el, reopenedAt());

    expect(inPanel(el)).toBe(true);
    expect(seen).toEqual([]);
  });

  it("observe: a count change does not fire", async () => {
    const { el, seen } = await opened();
    await tickBill(el, "b3");
    await typeCount(el, "staying", "3");
    await typeCount(el, "leaving", "2");
    expect(seen).toHaveLength(1);
  });

  it("observe: the panel closing on send does not fire", async () => {
    const { el, seen } = await opened();
    await tickBill(el, "b3");
    split(el).click();
    await settled(el);
    expect(inPanel(el)).toBe(false);
    expect(seen).toHaveLength(1);
  });
});

describe("A803 split: reopening with a refusal", () => {
  async function sentOnce() {
    const el = await mountScreen();
    const prompts = heard<{ prompt: object }>(el, "split-table-open");
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await tickBill(el, "b3");
    await pickDish(el, "b1", "salad");
    await typeCount(el, "staying", "3");
    await typeCount(el, "leaving", "2");
    split(el).click();
    await settled(el);
    expect(inPanel(el)).toBe(false);
    return { el, sent, prompt: prompts[0]!.prompt };
  }

  it("reopen: a refusal naming a count shows what was sent, under that stepper, with the bottom message and Split enabled", async () => {
    const { el, sent, prompt } = await sentOnce();

    await refuse(el, reopenedAt({ field: "leaving", message: "Too many", prompt }));

    expect(inPanel(el)).toBe(true);
    expect([...ticked(el).whole]).toEqual(["b3"]);
    expect([...ticked(el).picks.get("b1")!]).toEqual(["salad"]);
    expect(stepper(el, "staying").value).toBe("3");
    expect(stepper(el, "leaving").value).toBe("2");
    expect(stepper(el, "leaving").error).toBe("Too many");
    expect(stepper(el, "staying").error).toBe("");
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(refusalLine(el)).toBeNull();
    expect(split(el).disabled).toBe(false);
    expect(split(el).getAttribute("variant")).toBe("primary");

    split(el).click();
    await settled(el);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.prompt).toBe(prompt);
    expect(sent[1]).toEqual(sent[0]);
  });

  it("reopen: a refused count's message goes when that count changes, not when the other does", async () => {
    const { el, prompt } = await sentOnce();
    await refuse(el, reopenedAt({ field: "leaving", message: "Too many", prompt }));

    await typeCount(el, "staying", "4");
    expect(stepper(el, "leaving").error).toBe("Too many");

    await typeCount(el, "leaving", "1");
    expect(stepper(el, "leaving").error).toBe("");
    expect(bottom(el).error).toBe("");
    expect(split(el).disabled).toBe(false);
  });

  it("reopen: a refused count's message goes when Split is pressed again", async () => {
    const { el, prompt } = await sentOnce();
    await refuse(el, reopenedAt({ field: "staying", message: "Too many", prompt }));
    split(el).click();
    await settled(el);
    await refuse(el, reopenedAt({ message: "Another", prompt }));
    expect(stepper(el, "staying").error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("reopen: a refusal with no field marks nothing and says it above the buttons, announced, until Split is pressed", async () => {
    const { el, sent, prompt } = await sentOnce();

    await refuse(el, reopenedAt({ message: "Bill 1 changed", prompt }));

    expect([...ticked(el).whole]).toEqual(["b3"]);
    expect(stepper(el, "staying").error).toBe("");
    expect(stepper(el, "leaving").error).toBe("");
    expect(bottom(el).error).toBe("");
    const line = refusalLine(el)!;
    expect(line.textContent!.trim()).toBe("Bill 1 changed");
    expect(line.getAttribute("role")).toBe("alert");
    expect(
      line.compareDocumentPosition(bottom(el)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(split(el).disabled).toBe(false);

    await tickBill(el, "b2");
    expect(refusalLine(el)).not.toBeNull();

    await tickBill(el, "b2");
    split(el).click();
    await settled(el);
    expect(refusalLine(el)).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it("reopen: Split pressed with a bad count takes the sentence away too", async () => {
    const { el, sent, prompt } = await sentOnce();
    await refuse(el, reopenedAt({ message: "Bill 1 changed", prompt }));
    await typeCount(el, "leaving", "abc");

    split(el).click();
    await settled(el);

    expect(refusalLine(el)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("reopen: a template message draws its button", async () => {
    const { el, prompt } = await sentOnce();
    await refuse(
      el,
      reopenedAt({
        message: html`<span class="error-part">Over</span
          ><span class="error-action"><wt-button data-refund-excess>Refund</wt-button></span>`,
        prompt,
      }),
    );
    const button = refusalLine(el)!.querySelector("wt-button[data-refund-excess]");
    expect(button?.textContent).toBe("Refund");
    const action = refusalLine(el)!.querySelector(".error-action")!;
    const part = refusalLine(el)!.querySelector(".error-part")!;
    expect(getComputedStyle(action).display).toBe("block");
    expect(getComputedStyle(part).display).toBe("block");
    expect(getComputedStyle(action).borderTopStyle).toBe("none");
    expect(getComputedStyle(refusalLine(el)!).color).toBe(
      resolved(el, "color", "--wt-color-danger"),
    );
    expect(getComputedStyle(action).marginTop).toBe(resolved(el, "marginTop", "--wt-space-2"));
  });

  it("reopen: a bill a re-read took away before the panel came back has lost its tick", async () => {
    const { el, prompt } = await sentOnce();
    el.bills = board08.bills.filter((bill) => bill.workingOrderId !== "b3");
    await settled(el);

    await refuse(el, reopenedAt({ prompt }));

    expect([...ticked(el).whole]).toEqual([]);
    expect([...ticked(el).picks.get("b1")!]).toEqual(["salad"]);
  });

  it("reopen: picks arrive before the read they belong to and are kept when it answers", async () => {
    const { el, prompt } = await sentOnce();
    el.splitRead = null;
    await refuse(el, reopenedAt({ prompt }));
    expect(inPanel(el)).toBe(true);
    expect(q(el, "till-split-picker")).toBeNull();

    el.splitRead = board08.splitRead;
    await settled(el);

    expect([...ticked(el).picks.get("b1")!]).toEqual(["salad"]);
    expect([...ticked(el).whole]).toEqual(["b3"]);
  });

  it.each([
    ["a table no longer held", { party: { ...garcia, tableIds: ["t7", "t9"] } }],
    ["a party left on one table", { party: { ...garcia, tableIds: ["t8"] } }],
    ["a party gone", { party: null }],
  ] as const)("reopen: a refusal for %s does not reopen", async (_name, change) => {
    const { el, prompt } = await sentOnce();
    Object.assign(el, change);
    await refuse(el, reopenedAt({ prompt }));
    expect(inPanel(el)).toBe(false);
  });

  it("reopen: a refusal arriving with a party switch does not reopen", async () => {
    const { el, prompt } = await sentOnce();
    el.party = { ...garcia, id: "another" };
    await refuse(el, reopenedAt({ prompt }));
    expect(inPanel(el)).toBe(false);
  });

  it("reopen: a screen drawn afresh does not reopen for a refusal the app still holds", async () => {
    const el = await mountScreen({ splitRefusal: reopenedAt() });
    expect(inPanel(el)).toBe(false);
  });

  it("reopen: a Move guests the app is still delaying sends nothing once the panel has reopened", async () => {
    const el = await mountScreen();
    let ready: (() => void) | undefined;
    el.addEventListener("table-relocation-open", (event) => {
      event.preventDefault();
      ready = (event as CustomEvent<{ ready: () => void }>).detail.ready;
    });
    const moved = heard(el, "move-guests");
    await click(el, "[data-move-split]");
    await click(el, '[data-action="move"]');
    await click(el, '[data-target="t8"]');
    expect(ready).toBeDefined();

    await refuse(el, reopenedAt());
    expect(q(el, "[data-split-pick]")).not.toBeNull();
    ready!();
    await settled(el);

    expect(moved).toEqual([]);
    expect(q(el, "[data-split-pick]")).not.toBeNull();
  });

  it("reopen: the panel takes focus when a refusal brings it back", async () => {
    const { el, prompt } = await sentOnce();
    await refuse(el, reopenedAt({ prompt }));
    expect(focused(el)?.matches("[data-split-pick] h2")).toBe(true);
  });

  it("reopen: focus goes to the ⋮ after Split", async () => {
    const { el, prompt } = await sentOnce();
    await refuse(el, reopenedAt({ prompt }));

    await userEvent.click(split(el));
    await settled(el);

    expect(inPanel(el)).toBe(false);
    expect(focused(el)?.matches("[data-table-menu]")).toBe(true);
  });

  it("reopen: focus goes to the ⋮ after Back, which comes by way of the tables", async () => {
    const { el, prompt } = await sentOnce();
    await refuse(el, reopenedAt({ prompt }));

    await userEvent.click(q(el, "[data-action-back]")!);
    await settled(el);
    expect(q(el, "[data-split-table]")).not.toBeNull();
    expect(focused(el)?.matches("[data-split-table] h2")).toBe(true);

    await userEvent.click(q(el, "[data-action-back]")!);
    await settled(el);

    expect(inPanel(el)).toBe(false);
    expect(focused(el)?.matches("[data-table-menu]")).toBe(true);
  });
});

describe("A803 split: Refund for a bill on screen", () => {
  it("Refund for the bill on screen asks nothing and lets the event through", async () => {
    const el = await mountScreen();
    const heardRefund = heard<{ billId: string }>(el, "refund-excess");
    await toPanel(el);
    await refuse(el, reopenedAt({ message: refundButton("b1") }));

    refusalLine(el)!.querySelector<HTMLElement>("[data-refund-excess]")!.click();
    await settled(el);

    expect(heardRefund).toEqual([{ billId: "b1" }]);
    expect(inPanel(el)).toBe(true);
    expect([...ticked(el).whole]).toEqual(["b3"]);
  });
});

describe("A803 split: Everything ticked", () => {
  async function everythingTicked(over: Partial<TillTableOrderScreen> = {}) {
    const el = await mountScreen(over);
    const opened = heard<{ prompt: object }>(el, "split-table-open");
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    for (const bill of el.bills)
      if (bill.status !== "settled") await tickBill(el, bill.workingOrderId);
    return { el, sent, prompt: opened[0]!.prompt };
  }

  it("Everything ticked: Split swaps to the question, naming both tables, and sends nothing", async () => {
    const { el, sent } = await everythingTicked();

    split(el).click();
    await settled(el);

    expect(sent).toEqual([]);
    expect(q(el, "[data-split-confirm]")).toBeNull();
    expect(textOf(el, "[data-split-question]")).toBe(
      "Nothing would stay at T7. Move the guests to T8 instead?",
    );
    expect(textOf(el, "[data-split-anyway-note]")).toBe(
      "Split anyway leaves T7 with an empty bill.",
    );
    expect(q(el, "[data-split-move-guests]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-split-move-guests]")!.textContent!.trim()).toBe(
      t("table.action_move_guests"),
    );
    expect(q(el, "[data-split-anyway]")!.getAttribute("variant")).toBe("secondary");
    expect(q(el, "[data-split-anyway]")!.textContent!.trim()).toBe("Split anyway");
    expect(focused(el)?.matches("[data-split-move-guests]")).toBe(true);
  });

  it("Everything ticked: the question's Spanish words", async () => {
    setLocale("es-ES");
    const { el } = await everythingTicked();
    split(el).click();
    await settled(el);
    const names = { kept: "T7", table: "T8" };
    const inSpanish = (key: Parameters<typeof t>[0]) => fill(t(key, "es-ES"), names);
    for (const key of ["table.split_nothing_stays", "table.split_anyway_note"] as const)
      expect(inSpanish(key)).not.toBe(fill(t(key, "en-GB"), names));
    expect(t("table.split_anyway", "es-ES")).not.toBe(t("table.split_anyway", "en-GB"));
    expect(textOf(el, "[data-split-question]")).toBe(inSpanish("table.split_nothing_stays"));
    expect(textOf(el, "[data-split-anyway-note]")).toBe(inSpanish("table.split_anyway_note"));
    expect(q(el, "[data-split-anyway]")!.textContent!.trim()).toBe(
      t("table.split_anyway", "es-ES"),
    );
  });

  it("Everything ticked: the paid note's Spanish words", async () => {
    setLocale("es-ES");
    const { el } = await paidStays();
    split(el).click();
    await settled(el);
    const note = fill(t("table.split_anyway_note_paid", "es-ES"), { kept: "T7" });
    expect(note).not.toBe(fill(t("table.split_anyway_note_paid", "en-GB"), { kept: "T7" }));
    expect(textOf(el, "[data-split-anyway-note]")).toBe(note);
  });

  async function paidStays() {
    return everythingTicked({
      bills: [partyBill("b1", 1, "30.00", { status: "settled" }), partyBill("b2", 2, "40.00")],
      splitRead: read(
        { b1: [dish("soup", 1, "30.00")], b2: [dish("wine", 5, "40.00")] },
        { b1: "30.00", b2: "40.00" },
      ),
    });
  }

  it("Everything ticked: a bad count is refused before the question", async () => {
    const { el, sent } = await everythingTicked();
    await typeCount(el, "leaving", "abc");
    split(el).click();
    await settled(el);
    expect(q(el, "[data-split-question]")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("Everything ticked: Move guests sends table-relocation-open, then move-guests with the leaving table", async () => {
    const { el, sent } = await everythingTicked();
    const order: string[] = [];
    let relocated: { verb: string; table: { id: string } | null; prompt: object } | undefined;
    el.addEventListener("table-relocation-open", (event) => {
      order.push(event.type);
      relocated = (event as CustomEvent).detail;
    });
    const moved = heard<{ toTableId: string; prompt: object }>(el, "move-guests");
    el.addEventListener("move-guests", (event) => order.push(event.type));
    split(el).click();
    await settled(el);

    q(el, "[data-split-move-guests]")!.click();
    await settled(el);

    expect(order).toEqual(["table-relocation-open", "move-guests"]);
    expect(relocated!.verb).toBe("move");
    expect(relocated!.table!.id).toBe("t8");
    expect(moved).toEqual([{ toTableId: "t8", prompt: relocated!.prompt }]);
    expect(sent).toEqual([]);
    expect(inPanel(el)).toBe(false);
  });

  it("Everything ticked: an app that delays Move guests sends nothing once a tick has changed", async () => {
    const { el } = await everythingTicked();
    let ready: (() => void) | undefined;
    el.addEventListener("table-relocation-open", (event) => {
      event.preventDefault();
      ready = (event as CustomEvent<{ ready: () => void }>).detail.ready;
    });
    const moved = heard(el, "move-guests");
    split(el).click();
    await settled(el);
    q(el, "[data-split-move-guests]")!.click();
    await settled(el);

    await tickBill(el, "b2");
    ready!();
    await settled(el);

    expect(moved).toEqual([]);
    expect(inPanel(el)).toBe(true);
  });

  it("Everything ticked: Split anyway sends the split with the counts and closes", async () => {
    const { el, sent, prompt } = await everythingTicked();
    await typeCount(el, "staying", "3");
    await typeCount(el, "leaving", "2");
    split(el).click();
    await settled(el);

    q(el, "[data-split-anyway]")!.click();
    await settled(el);

    expect(sent).toEqual([
      {
        tableId: "t8",
        selection: { wholeBillIds: ["b1", "b2", "b3"], loose: [] },
        guestCounts: { staying: 3, leaving: 2 },
        prompt,
      },
    ]);
    expect(inPanel(el)).toBe(false);
  });

  it("Everything ticked: a count made bad under the question disables Split anyway, marked, until it is fixed", async () => {
    const { el, sent } = await everythingTicked();
    split(el).click();
    await settled(el);
    const anyway = () => q<HTMLElement & { disabled: boolean }>(el, "[data-split-anyway]")!;
    expect(anyway().disabled).toBe(false);

    await typeCount(el, "leaving", "abc");

    expect(anyway().disabled).toBe(true);
    expect(stepper(el, "leaving").error).toBe(t("seat.guest_count_invalid"));
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(q(el, "[data-split-question]")).not.toBeNull();
    expect(sent).toEqual([]);

    await typeCount(el, "leaving", "2");

    expect(anyway().disabled).toBe(false);
    anyway().click();
    await settled(el);
    expect(sent).toHaveLength(1);
  });

  it("Everything ticked: a first bill's reads still out disable Split anyway until they are done", async () => {
    const { el, sent } = await everythingTicked();
    split(el).click();
    await settled(el);
    const anyway = () => q<HTMLElement & { disabled: boolean }>(el, "[data-split-anyway]")!;
    expect(anyway().disabled).toBe(false);

    el.splitReloading = true;
    await settled(el);
    expect(anyway().disabled).toBe(true);

    el.splitReloading = false;
    await settled(el);
    expect(anyway().disabled).toBe(false);
    expect(sent).toEqual([]);
  });

  it("Everything ticked: Enter from a stepper under the question sends nothing and moves no one", async () => {
    const { el, sent } = await everythingTicked();
    const moved = heard(el, "move-guests");
    split(el).click();
    await settled(el);

    nativeInput(el, "leaving").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    await settled(el);

    expect(sent).toEqual([]);
    expect(moved).toEqual([]);
    expect(q(el, "[data-split-question]")).not.toBeNull();
  });

  it("Everything ticked: a tick change returns to Split", async () => {
    const { el } = await everythingTicked();
    split(el).click();
    await settled(el);

    await tickBill(el, "b2");

    expect(q(el, "[data-split-question]")).toBeNull();
    expect(q(el, "[data-split-anyway]")).toBeNull();
    expect(split(el)).not.toBeNull();
  });

  it("Everything ticked: a read that gives something to stay returns to Split", async () => {
    const { el, sent } = await everythingTicked();
    split(el).click();
    await settled(el);

    el.bills = [...board08.bills, partyBill("b4", 4, "10.00")];
    el.splitRead = {
      bills: [
        ...board08.splitRead.bills,
        ...read({ b4: [dish("tea", 7, "10.00")] }, { b4: "10.00" }).bills,
      ],
    };
    await settled(el);

    expect(q(el, "[data-split-question]")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("Everything ticked: focus goes to Split when a read takes the question and its button away", async () => {
    const { el } = await everythingTicked();
    split(el).click();
    await settled(el);
    expect(focused(el)?.matches("[data-split-move-guests]")).toBe(true);

    el.bills = [...board08.bills, partyBill("b4", 4, "10.00")];
    el.splitRead = {
      bills: [
        ...board08.splitRead.bills,
        ...read({ b4: [dish("tea", 7, "10.00")] }, { b4: "10.00" }).bills,
      ],
    };
    await settled(el);

    await expect.poll(() => focused(el)?.matches("[data-split-confirm]")).toBe(true);
  });

  it("Everything ticked: a read leaving the question does not take focus from elsewhere", async () => {
    const { el } = await everythingTicked();
    split(el).click();
    await settled(el);
    nativeInput(el, "leaving").focus();

    el.bills = [...board08.bills, partyBill("b4", 4, "10.00")];
    el.splitRead = {
      bills: [
        ...board08.splitRead.bills,
        ...read({ b4: [dish("tea", 7, "10.00")] }, { b4: "10.00" }).bills,
      ],
    };
    await settled(el);

    expect(q(el, "[data-split-question]")).toBeNull();
    expect(focused(el)?.matches("wt-number-stepper")).toBe(true);
  });

  it("Everything ticked: the question and its note are announced", async () => {
    const { el } = await everythingTicked();
    split(el).click();
    await settled(el);
    const announced = q(el, "[data-split-question]")!.closest('[role="alert"]')!;
    expect(announced).not.toBeNull();
    expect(announced.contains(q(el, "[data-split-anyway-note]"))).toBe(true);
  });

  it.each([
    ["Back", (el: TillTableOrderScreen) => q(el, "[data-action-back]")!.click()],
    [
      "Escape",
      (el: TillTableOrderScreen) =>
        q(el, "[data-action-panel]")!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            composed: true,
            cancelable: true,
          }),
        ),
    ],
  ] as const)("Everything ticked: %s returns to Split, not out", async (_name, press) => {
    const { el } = await everythingTicked();
    split(el).click();
    await settled(el);

    press(el);
    await settled(el);

    expect(q(el, "[data-split-question]")).toBeNull();
    expect(q(el, "[data-split-pick]")).not.toBeNull();
    expect(split(el)).not.toBeNull();
    expect([...ticked(el).whole].sort()).toEqual(["b1", "b2", "b3"]);
    expect(focused(el)?.matches("[data-split-confirm]")).toBe(true);
  });

  it("Everything ticked: the note's table names are plural when two tables stay", async () => {
    const threeTables = { ...garcia, tableIds: ["t6", "t7", "t8"] };
    const { el } = await everythingTicked({
      party: threeTables,
      tables: [table("t6"), table("t7"), table("t8")],
    });
    split(el).click();
    await settled(el);
    expect(textOf(el, "[data-split-question]")).toBe(
      "Nothing would stay at T6, T7. Move the guests to T8 instead?",
    );
    expect(textOf(el, "[data-split-anyway-note]")).toBe(
      "Split anyway leaves T6, T7 with an empty bill.",
    );
  });

  it("Everything ticked: with only a paid bill staying the note says nothing to pay", async () => {
    const { el } = await paidStays();
    split(el).click();
    await settled(el);
    expect(textOf(el, "[data-split-anyway-note]")).toBe(
      "Split anyway leaves T7 with nothing to pay.",
    );
  });
});

describe("A803 split: a read and a selected bill", () => {
  const lines = (billId: string) =>
    board08.splitRead.bills.find((bill) => bill.billId === billId)!.lines;
  const billRow = (el: TillTableOrderScreen, billId: string) =>
    splitPicker(el)!.shadowRoot!.querySelector(`[data-split-bill="${billId}"]`);
  const tick = (el: TillTableOrderScreen, billId: string) =>
    splitPicker(el)!.shadowRoot!.querySelector<HTMLInputElement>(`[data-split-tick="${billId}"]`);
  const takeOverRow = (el: TillTableOrderScreen, billId: string) =>
    splitPicker(el)!.shadowRoot!.querySelector(`[data-split-take-over="${billId}"]`);
  const dishRows = (el: TillTableOrderScreen, billId: string) =>
    billRow(el, billId)!.querySelector("till-portion-picker");
  const sentence = (el: TillTableOrderScreen) => textOf(el, "[data-split-refusal]");
  const taken = (who: string) => fill(t("table.split_taken"), { who });
  const gone = (bill: string) => fill(t("table.split_bill_gone"), { bill });
  const changed = (bill: string) => fill(t("table.split_changed"), { bill });
  const enter = (el: TillTableOrderScreen, side: Side) =>
    nativeInput(el, side).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

  async function press(el: TillTableOrderScreen): Promise<void> {
    split(el).click();
    await settled(el);
  }

  function withoutBills(...ids: string[]): SplitSources {
    return { bills: board08.splitRead.bills.filter((bill) => !ids.includes(bill.billId)) };
  }

  /** A whole bill and a bill with picks, ready for a read to reach them. */
  async function selected(over: Partial<TillTableOrderScreen> = {}) {
    const el = await mountScreen(over);
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await tickBill(el, "b3");
    await pickDish(el, "b1", "salad");
    return { el, sent };
  }

  async function bothHeld() {
    const opened = await selected();
    opened.el.partyDrafts = [draft("b1", "ana", "Ana"), draft("b3", "luis", "Luis")];
    await settled(opened.el);
    return opened;
  }

  const paidSalad = () =>
    read(
      { b1: lines("b1"), b2: lines("b2"), b3: lines("b3") },
      { b1: "97.00", b2: "40.00", b3: "39.00" },
      {
        b1: {
          received: "10.00",
          paidLines: [{ lineId: "salad", lineNo: 2, paidQuantity: "1.000" }],
        },
      },
    );

  it("a read and a selected bill: a whole bill and a bill with picks stay ticked when each gains someone else's draft", async () => {
    const { el, sent } = await bothHeld();

    expect(tick(el, "b3")!.checked).toBe(true);
    expect(tick(el, "b1")!.indeterminate).toBe(true);
    expect(dishRows(el, "b3")).toBeNull();
    expect(dishRows(el, "b1")).toBeNull();
    expect(takeOverRow(el, "b3")).not.toBeNull();
    expect(takeOverRow(el, "b1")).not.toBeNull();

    el.partyDrafts = [];
    await settled(el);
    await press(el);

    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({
      selection: {
        wholeBillIds: ["b3"],
        loose: [{ billId: "b1", lineIds: ["salad"] }],
      },
    });
  });

  it("a read and a selected bill: says at once, unpressed, who holds both bills, and holds Split", async () => {
    const { el } = await bothHeld();

    const line = refusalLine(el)!;
    expect(line.getAttribute("role")).toBe("alert");
    expect(sentence(el)).toBe("Take over unsent items from Ana and Luis before splitting.");
    expect(split(el).variant).toBe("secondary");
    expect(split(el).disabled).toBe(true);
  });

  it("a read and a selected bill: the holders' sentence in the owner's Spanish words", async () => {
    const { el } = await bothHeld();
    setLocale("es-ES");
    el.requestUpdate();
    await settled(el);
    expect(sentence(el)).toBe(fill(t("table.split_taken", "es-ES"), { who: "Ana y Luis" }));
  });

  it("a read and a selected bill: one holder of two bills is named once", async () => {
    const { el } = await selected();
    el.partyDrafts = [draft("b1", "ana", "Ana"), draft("b3", "ana", "Ana")];
    await settled(el);
    expect(sentence(el)).toBe(taken("Ana"));
  });

  it("a read and a selected bill: a holder with no name uses the unnamed words, whoever else holds", async () => {
    const { el } = await selected();
    el.partyDrafts = [draft("b1", "ana", "Ana"), draft("b3", "x", "")];
    await settled(el);
    expect(sentence(el)).toBe("Take over the unsent items before splitting.");
    setLocale("es-ES");
    el.requestUpdate();
    await settled(el);
    expect(sentence(el)).toBe(t("table.split_taken_unnamed", "es-ES"));
  });

  it("a read and a selected bill: nothing sends while held, by a real click, a click on the host or Enter", async () => {
    const { el, sent } = await bothHeld();

    await userEvent.click(split(el), { force: true });
    await settled(el);
    expect(sent).toEqual([]);

    split(el).click();
    await settled(el);
    expect(sent).toEqual([]);

    enter(el, "staying");
    await settled(el);
    enter(el, "leaving");
    await settled(el);
    expect(sent).toEqual([]);
    expect(q(el, "[data-split-pick]")).not.toBeNull();
  });

  it("a read and a selected bill: the everything-ticked question goes back to the action row when a bill becomes held", async () => {
    const el = await mountScreen();
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    for (const id of ["b1", "b2", "b3"]) await tickBill(el, id);
    await press(el);
    expect(q(el, "[data-split-question]")).not.toBeNull();

    el.partyDrafts = [draft("b2", "ana", "Ana")];
    await settled(el);

    expect(q(el, "[data-split-question]")).toBeNull();
    expect(q(el, "[data-split-anyway]")).toBeNull();
    expect(split(el).disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  it("a read and a selected bill: unticking one held bill names the other, and unticking the last gives Split back", async () => {
    const { el, sent } = await bothHeld();

    await tickBill(el, "b1");
    expect(sentence(el)).toBe(taken("Luis"));
    expect(split(el).disabled).toBe(true);

    await tickBill(el, "b3");
    expect(refusalLine(el)).toBeNull();
    expect(split(el).variant).toBe("primary");
    expect(split(el).disabled).toBe(false);
    expect(tick(el, "b1")!.disabled).toBe(true);
    expect(tick(el, "b3")!.disabled).toBe(true);
    expect(billRow(el, "b1")!.textContent).toContain(t("table.split_take_over_first"));

    await press(el);
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: [], loose: [] } });
  });

  it("a read and a selected bill: the draft going brings rows, ticks and picks back, and Split", async () => {
    const { el, sent } = await bothHeld();

    el.partyDrafts = [];
    await settled(el);

    expect(rowIds(el, "b1")).toContain("salad");
    expect(rowIds(el, "b3")).toContain("fish");
    expect(tick(el, "b3")!.checked).toBe(true);
    expect([...ticked(el).picks.get("b1")!]).toEqual(["salad"]);
    expect(refusalLine(el)).toBeNull();
    expect(split(el).variant).toBe("primary");
    expect(split(el).disabled).toBe(false);
    expect(sent).toEqual([]);
  });

  it("a read and a selected bill: a marked count beside a held bill shows both messages", async () => {
    const { el } = await selected();
    await typeCount(el, "leaving", "0");
    await press(el);
    expect(bottom(el).error).toBe(t("form.fix_fields"));

    el.partyDrafts = [draft("b3", "luis", "Luis")];
    await settled(el);

    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(sentence(el)).toBe(taken("Luis"));
  });

  it("a read and a selected bill: a no-field refusal is replaced by the held sentence and does not come back", async () => {
    const { el } = await selected();
    await press(el);
    await refuse(el, reopenedAt());
    expect(sentence(el)).toBe("Refused");

    el.partyDrafts = [draft("b3", "luis", "Luis")];
    await settled(el);
    expect(sentence(el)).toBe(taken("Luis"));

    el.partyDrafts = [];
    await settled(el);
    expect(refusalLine(el)).toBeNull();
  });

  it("a read and a selected bill: a whole bill the read no longer lists takes one press to say so", async () => {
    const named = {
      bills: [board08.bills[0]!, board08.bills[1]!, { ...board08.bills[2]!, billName: "Clint" }],
    };
    const { el, sent } = await selected(named);

    el.bills = board08.bills.filter((bill) => bill.workingOrderId !== "b3");
    el.splitRead = withoutBills("b3");
    await settled(el);

    expect(billRow(el, "b3")).toBeNull();
    expect([...ticked(el).whole]).toEqual([]);
    expect(refusalLine(el)).toBeNull();

    await press(el);
    expect(sent).toEqual([]);
    expect(sentence(el)).toBe(gone("Bill 3 · Clint"));
    expect(split(el).disabled).toBe(false);

    await press(el);
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({
      selection: { wholeBillIds: [], loose: [{ billId: "b1", lineIds: ["salad"] }] },
    });
  });

  it("a read and a selected bill: the gone sentence's Spanish words", async () => {
    setLocale("es-ES");
    const { el } = await selected();
    el.splitRead = withoutBills("b3");
    await settled(el);
    await press(el);
    expect(sentence(el)).toBe(
      fill(t("table.split_bill_gone", "es-ES"), { bill: billNumberInSpanish(3) }),
    );
  });

  it("a read and a selected bill: two gone bills take two sentences and two presses, then the send", async () => {
    const el = await mountScreen();
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await tickBill(el, "b2");
    await tickBill(el, "b3");

    el.splitRead = withoutBills("b2", "b3");
    await settled(el);

    await press(el);
    expect(sentence(el)).toBe(gone("Bill 2"));
    await press(el);
    expect(sentence(el)).toBe(gone("Bill 3"));
    expect(sent).toEqual([]);

    await press(el);
    expect(sent).toHaveLength(1);
  });

  it("a read and a selected bill: a source whose bill left stops one press too", async () => {
    const { el, sent } = await selected();

    el.splitRead = withoutBills("b1");
    await settled(el);

    expect(billRow(el, "b1")).toBeNull();
    await press(el);
    expect(sent).toEqual([]);
    expect(sentence(el)).toBe(gone("Bill 1"));

    await press(el);
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: ["b3"], loose: [] } });
  });

  it("a read and a selected bill: a bill gone from a refused selection stops one press, by the name it last drew", async () => {
    const { el, sent } = await selected();
    await press(el);
    expect(sent).toHaveLength(1);

    el.bills = board08.bills.filter((bill) => bill.workingOrderId !== "b3");
    el.splitRead = withoutBills("b3");
    await settled(el);
    await refuse(el, reopenedAt());

    expect([...ticked(el).whole]).toEqual([]);
    await press(el);
    expect(sent).toHaveLength(1);
    expect(sentence(el)).toBe(gone("Bill 3"));
  });

  it("a read and a selected bill: a bill that changed and then went takes one press, as gone", async () => {
    const { el, sent } = await selected();
    await pickDish(el, "b1", "soup");
    el.splitRead = paidSalad();
    await settled(el);
    el.splitRead = withoutBills("b1");
    await settled(el);

    await press(el);
    expect(sentence(el)).toBe(gone("Bill 1"));
    expect(sent).toEqual([]);
    await press(el);
    expect(sent).toHaveLength(1);
  });

  it("a read and a selected bill: a picked dish paid stops one press, and the next sends", async () => {
    const { el, sent } = await selected();
    await pickDish(el, "b1", "soup");

    el.splitRead = paidSalad();
    await settled(el);

    await press(el);
    expect(sent).toEqual([]);
    expect(sentence(el)).toBe(changed("Bill 1"));
    expect(split(el).disabled).toBe(false);

    await press(el);
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({
      selection: { wholeBillIds: ["b3"], loose: [{ billId: "b1", lineIds: ["soup"] }] },
    });
  });

  it("a read and a selected bill: the changed sentence's Spanish words", async () => {
    setLocale("es-ES");
    const { el } = await selected();
    el.splitRead = paidSalad();
    await settled(el);
    await press(el);
    expect(sentence(el)).toBe(
      fill(t("table.split_changed", "es-ES"), { bill: billNumberInSpanish(1) }),
    );
  });

  it("a read and a selected bill: a bill's last pick paid, leaving nothing ticked, still says so before an empty send", async () => {
    const el = await mountScreen();
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await pickDish(el, "b1", "salad");

    el.splitRead = paidSalad();
    await settled(el);
    expect(ticked(el).picks.size).toBe(0);

    await press(el);
    expect(sent).toEqual([]);
    expect(sentence(el)).toBe(changed("Bill 1"));

    await press(el);
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: [], loose: [] } });
  });

  describe("picks that become the whole bill", () => {
    const withoutSteak = () =>
      read(
        {
          b1: lines("b1").filter((line) => line.id !== "steak"),
          b2: lines("b2"),
          b3: lines("b3"),
        },
        { b1: "30.00", b2: "40.00", b3: "39.00" },
      );

    async function threePicked() {
      const el = await mountScreen();
      const sent = heard<SplitTableDetail>(el, "split-table");
      await toPanel(el);
      for (const row of ["soup", "salad", "bread"]) await pickDish(el, "b1", row);
      el.splitRead = withoutSteak();
      await settled(el);
      return { el, sent };
    }

    it("a read and a selected bill: the bill's only unpicked dish removed makes it whole, told once", async () => {
      const { el, sent } = await threePicked();

      expect(tick(el, "b1")!.checked).toBe(true);
      expect(textOf(el, "[data-split-takes]")).toBe("T8 takes Bill 1 · €30.00");
      expect(q(el, "[data-split-new-bill-note]")).toBeNull();

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(changed("Bill 1"));

      await press(el);
      expect(sent).toHaveLength(1);
      expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: ["b1"], loose: [] } });
    });

    it("a read and a selected bill: a second read naming nothing leaves that stop waiting", async () => {
      const { el, sent } = await threePicked();

      el.splitRead = withoutSteak();
      await settled(el);

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(changed("Bill 1"));
    });
  });

  it("a read and a selected bill: closing the panel forgets what was waiting", async () => {
    const el = await mountScreen();
    const sent = heard<SplitTableDetail>(el, "split-table");
    await toPanel(el);
    await tickBill(el, "b3");
    el.splitRead = withoutBills("b3");
    await settled(el);

    await click(el, "[data-action-back]");
    await click(el, '[data-target="t8"]');
    await settled(el);

    await press(el);
    expect(sent).toHaveLength(1);
    expect(refusalLine(el)).toBeNull();
  });

  describe("focus when a read holds a bill", () => {
    const onTakeOver = (el: TillTableOrderScreen, billId: string) =>
      splitPicker(el)!.shadowRoot!.activeElement === takeOverRow(el, billId);
    const dishBox = (el: TillTableOrderScreen, billId: string, row: string) =>
      dishRows(el, billId)!.shadowRoot!.querySelector<HTMLInputElement>(`[data-pick="${row}"]`)!;

    async function asking() {
      const el = await mountScreen();
      await toPanel(el);
      for (const id of ["b1", "b2", "b3"]) await tickBill(el, id);
      await press(el);
      expect(q(el, "[data-split-question]")).not.toBeNull();
      return el;
    }

    it.each(["[data-split-move-guests]", "[data-split-anyway]"])(
      "a read and a selected bill: focus on the question's %s goes to the bill's Take over",
      async (button) => {
        const el = await asking();
        q(el, button)!.focus();

        el.partyDrafts = [draft("b2", "ana", "Ana")];
        await settled(el);

        expect(q(el, "[data-split-question]")).toBeNull();
        await expect.poll(() => onTakeOver(el, "b2")).toBe(true);
      },
    );

    it("a read and a selected bill: focus on Split goes to the first held bill's Take over", async () => {
      const { el } = await selected();
      split(el).focus();

      el.partyDrafts = [draft("b3", "luis", "Luis"), draft("b1", "ana", "Ana")];
      await settled(el);

      expect(split(el).disabled).toBe(true);
      await expect.poll(() => onTakeOver(el, "b1")).toBe(true);
    });

    it("a read and a selected bill: focus skips a held bill that is not ticked", async () => {
      const el = await mountScreen();
      await toPanel(el);
      await tickBill(el, "b3");
      split(el).focus();

      el.partyDrafts = [draft("b1", "ana", "Ana"), draft("b3", "luis", "Luis")];
      await settled(el);

      await expect.poll(() => onTakeOver(el, "b3")).toBe(true);
    });

    it("a read and a selected bill: focus among a bill's dishes goes to its own Take over when they give way", async () => {
      const { el } = await selected();
      dishBox(el, "b1", "soup").focus();

      el.partyDrafts = [draft("b1", "ana", "Ana"), draft("b3", "luis", "Luis")];
      await settled(el);

      await expect.poll(() => onTakeOver(el, "b1")).toBe(true);
    });

    it("a read and a selected bill: focus among the dishes of a bill still drawn stays there", async () => {
      const { el } = await selected();
      const box = dishBox(el, "b1", "soup");
      box.focus();

      el.partyDrafts = [draft("b3", "luis", "Luis")];
      await settled(el);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(dishRows(el, "b1")!.shadowRoot!.activeElement).toBe(box);
    });

    it("a read and a selected bill: focus anywhere else stays where it is", async () => {
      const { el } = await selected();
      const back = q(el, "[data-action-back]")!;
      back.focus();

      el.partyDrafts = [draft("b1", "ana", "Ana")];
      await settled(el);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(focused(el)).toBe(back);
    });
  });

  describe("a stop waiting when the bill comes back", () => {
    async function goneThenBack() {
      const opened = await selected();
      opened.el.splitRead = withoutBills("b3");
      await settled(opened.el);
      expect(tick(opened.el, "b3")).toBeNull();
      opened.el.splitRead = read(
        { b1: lines("b1"), b2: lines("b2"), b3: lines("b3") },
        { b1: "97.00", b2: "40.00", b3: "39.00" },
      );
      await settled(opened.el);
      return opened;
    }

    it("a read and a selected bill: a gone bill listed again, unticked, is told as changed, never sent without a word", async () => {
      const { el, sent } = await goneThenBack();
      expect(tick(el, "b3")!.checked).toBe(false);

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(changed("Bill 3"));

      await press(el);
      expect(sent).toHaveLength(1);
      expect(sent[0]!).toMatchObject({
        selection: { wholeBillIds: [], loose: [{ billId: "b1", lineIds: ["salad"] }] },
      });
    });

    it("a read and a selected bill: a gone bill listed again and ticked again never says it has left", async () => {
      const { el, sent } = await goneThenBack();
      await tickBill(el, "b3");

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(changed("Bill 3"));

      await press(el);
      expect(sent).toHaveLength(1);
      expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: ["b3"] } });
    });
  });

  describe("a bill that goes and comes back", () => {
    const allBills = () =>
      read(
        { b1: lines("b1"), b2: lines("b2"), b3: lines("b3") },
        { b1: "97.00", b2: "40.00", b3: "39.00" },
      );
    const renumbered = (el: TillTableOrderScreen) =>
      el.bills.map((bill) => (bill.workingOrderId === "b3" ? { ...bill, billNumber: 4 } : bill));

    it("a stop waiting on a bill listed again under a new number names the number its row carries", async () => {
      const { el, sent } = await selected();
      el.splitRead = withoutBills("b3");
      await settled(el);
      el.bills = renumbered(el);
      el.splitRead = allBills();
      await settled(el);

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(changed("Bill 4"));

      await press(el);
      expect(sent).toHaveLength(1);
    });

    it("a stop waiting on a bill that came back and has gone again says it has left, with no row to check", async () => {
      const { el, sent } = await selected();
      el.splitRead = withoutBills("b3");
      await settled(el);
      el.splitRead = allBills();
      await settled(el);
      el.splitRead = withoutBills("b3");
      await settled(el);
      expect(tick(el, "b3")).toBeNull();

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(gone("Bill 3"));

      await press(el);
      expect(sent).toHaveLength(1);
    });

    it("a sentence on screen saying a bill left follows it back, under the number its row carries, and the next press sends", async () => {
      const { el, sent } = await selected();
      el.splitRead = withoutBills("b3");
      await settled(el);
      await press(el);
      expect(sentence(el)).toBe(gone("Bill 3"));

      el.bills = renumbered(el);
      el.splitRead = allBills();
      await settled(el);
      expect(sentence(el)).toBe(changed("Bill 4"));
      expect(sent).toEqual([]);

      await press(el);
      expect(sent).toHaveLength(1);
    });

    it("a sentence on screen saying a bill changed follows it away", async () => {
      const { el, sent } = await selected();
      el.splitRead = withoutBills("b3");
      await settled(el);
      el.splitRead = allBills();
      await settled(el);
      await press(el);
      expect(sentence(el)).toBe(changed("Bill 3"));

      el.splitRead = withoutBills("b3");
      await settled(el);
      expect(sentence(el)).toBe(gone("Bill 3"));
      expect(sent).toEqual([]);
    });

    it("a sentence that followed a bill away leaves no stop saying it again, so the next press sends", async () => {
      const { el, sent } = await selected();
      el.splitRead = withoutBills("b3");
      await settled(el);
      el.splitRead = allBills();
      await settled(el);
      await press(el);
      expect(sentence(el)).toBe(changed("Bill 3"));
      tick(el, "b3")!.click();
      await settled(el);
      expect(sentence(el)).toBe(changed("Bill 3"));

      el.splitRead = withoutBills("b3");
      await settled(el);
      expect(sentence(el)).toBe(gone("Bill 3"));

      await press(el);
      expect(sent).toHaveLength(1);
    });

    it("a sentence a later press cleared does not come back with a read", async () => {
      const { el, sent } = await selected();
      el.splitRead = withoutBills("b3");
      await settled(el);
      await press(el);
      expect(sentence(el)).toBe(gone("Bill 3"));

      await typeCount(el, "leaving", "abc");
      await press(el);
      expect(sentence(el)).toBeUndefined();

      el.splitRead = allBills();
      await settled(el);
      expect(sentence(el)).toBeUndefined();
      expect(sent).toEqual([]);
    });

    it("a sentence that is not a stop's stays when a read moves a bill", async () => {
      const el = await mountScreen();
      await toPanel(el);
      el.splitRefusal = {
        tableId: "t8",
        selection: { wholeBillIds: ["b3"], loose: [] },
        staying: "",
        leaving: "",
        message: "Refused for another reason",
      };
      await settled(el);
      expect(sentence(el)).toBe("Refused for another reason");

      el.splitRead = withoutBills("b2");
      await settled(el);
      expect(sentence(el)).toBe("Refused for another reason");
    });
  });

  describe("the order of what stops a press", () => {
    const stopsGoneBill = async (el: TillTableOrderScreen) => {
      el.splitRead = withoutBills("b3");
      await settled(el);
    };

    it("a read and a selected bill: a marked count speaks first, and the stop still waits for the next press", async () => {
      const { el, sent } = await selected();
      await stopsGoneBill(el);
      await typeCount(el, "leaving", "0");

      await press(el);
      expect(sent).toEqual([]);
      expect(refusalLine(el)).toBeNull();
      expect(bottom(el).error).toBe(t("form.fix_fields"));

      await typeCount(el, "leaving", "1");
      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(gone("Bill 3"));

      await press(el);
      expect(sent).toHaveLength(1);
    });

    it("a read and a selected bill: with everything ticked the stop speaks first, then the question asks", async () => {
      const el = await mountScreen();
      const sent = heard<SplitTableDetail>(el, "split-table");
      await toPanel(el);
      for (const id of ["b1", "b2", "b3"]) await tickBill(el, id);
      await stopsGoneBill(el);

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(gone("Bill 3"));
      expect(q(el, "[data-split-question]")).toBeNull();

      await press(el);
      expect(sent).toEqual([]);
      expect(refusalLine(el)).toBeNull();
      expect(q(el, "[data-split-question]")).not.toBeNull();
    });

    it("a read and a selected bill: a stop arriving under the question takes one Split anyway, beside the question", async () => {
      const el = await mountScreen();
      const sent = heard<SplitTableDetail>(el, "split-table");
      await toPanel(el);
      for (const id of ["b1", "b2", "b3"]) await tickBill(el, id);
      await press(el);
      expect(q(el, "[data-split-question]")).not.toBeNull();
      await typeCount(el, "leaving", "1");
      await stopsGoneBill(el);
      expect(q(el, "[data-split-question]")).not.toBeNull();

      await click(el, "[data-split-anyway]");
      await settled(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(gone("Bill 3"));
      expect(q(el, "[data-split-question]")).not.toBeNull();

      await click(el, "[data-split-anyway]");
      await settled(el);
      expect(sent).toHaveLength(1);
      expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: ["b1", "b2"] } });
    });

    it("a read and a selected bill: a gone bill speaks before a changed one, whichever bill comes first", async () => {
      const { el, sent } = await selected();
      await pickDish(el, "b1", "soup");
      el.splitRead = read(
        { b1: lines("b1"), b2: lines("b2") },
        { b1: "97.00", b2: "40.00" },
        {
          b1: {
            received: "10.00",
            paidLines: [{ lineId: "salad", lineNo: 2, paidQuantity: "1.000" }],
          },
        },
      );
      await settled(el);

      await press(el);
      expect(sentence(el)).toBe(gone("Bill 3"));
      await press(el);
      expect(sentence(el)).toBe(changed("Bill 1"));
      expect(sent).toEqual([]);
      await press(el);
      expect(sent).toHaveLength(1);
    });

    it("a read and a selected bill: a changed stop still takes one press after its bill's picks are unticked, and its sentence stays true", async () => {
      const { el, sent } = await selected();
      await pickDish(el, "b1", "soup");
      el.splitRead = paidSalad();
      await settled(el);
      await pickDish(el, "b1", "soup");
      expect(ticked(el).picks.has("b1")).toBe(false);

      await press(el);
      expect(sent).toEqual([]);
      expect(sentence(el)).toBe(changed("Bill 1"));

      await press(el);
      expect(sent).toHaveLength(1);
      expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: ["b3"], loose: [] } });
    });
  });

  it("a read and a selected bill: a read changing nothing stops nothing", async () => {
    const { el, sent } = await selected();
    el.splitRead = read(
      { b1: lines("b1"), b2: lines("b2"), b3: lines("b3") },
      { b1: "97.00", b2: "40.00", b3: "39.00" },
    );
    await settled(el);
    await press(el);
    expect(sent).toHaveLength(1);
  });

  it("a read and a selected bill: a whole bill presented by a read stops nothing", async () => {
    const { el, sent } = await selected();
    el.bills = [board08.bills[0]!, board08.bills[1]!, { ...board08.bills[2]!, status: "placed" }];
    await settled(el);
    await press(el);
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({ selection: { wholeBillIds: ["b3"] } });
  });

  it("a read and a selected bill: an unselected bill gaining a draft stops nothing, and its tick waits", async () => {
    const { el, sent } = await selected();
    el.partyDrafts = [draft("b2", "ana", "Ana")];
    await settled(el);

    expect(tick(el, "b2")!.disabled).toBe(true);
    expect(refusalLine(el)).toBeNull();
    expect(split(el).variant).toBe("primary");

    await press(el);
    expect(sent).toHaveLength(1);
  });
});

describe("Split a table's panel when a read leaves no bill", () => {
  it("takes focus from the tick that went to the panel's heading", async () => {
    const el = await mountScreen();
    await toPanel(el);
    const tick =
      splitPicker(el)!.shadowRoot!.querySelector<HTMLInputElement>('[data-split-tick="b1"]')!;
    tick.focus();
    el.splitRead = read({}, {});
    await settled(el);
    await expect.poll(() => el.shadowRoot!.activeElement?.localName).toBe("h2");
  });
});
