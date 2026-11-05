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
    splitPanelLive: true,
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
    const guests = q(el, ".split-guests")!;
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
    expect(q(el, "till-split-guests-dialog")).toBeNull();
  });

  it("without splitPanelLive the old step draws", async () => {
    const el = await mountScreen({ splitPanelLive: false });
    const opened = heard(el, "split-table-open");

    await toPanel(el);

    expect(q(el, "[data-split-pick]")).toBeNull();
    expect(q(el, '[data-target="none"]')).not.toBeNull();
    expect(opened).toEqual([]);
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
    ["es-ES", "T7 se queda sin nada que pagar"],
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
    ["es-ES", `T7 se queda con Cuenta 2 · ${formatMoney(decimal("40.00"), "es-ES")}`],
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
      ["es-ES", "T7 se queda sin nada que pagar"],
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
    ["es-ES", `T7 se queda con una cuenta vacía · ${formatMoney(decimal("0.00"), "es-ES")}`],
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

    expect(textOf(el, "[data-split-new-bill-note]")).toBe(
      "Los platos sueltos van en una cuenta nueva en T8.",
    );
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

/** The screen's focus, read through its shadow root. */
const focused = (el: TillTableOrderScreen) => el.shadowRoot!.activeElement as HTMLElement | null;

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

  it("observe: a refusal reopening the panel fires, even for the set last observed", async () => {
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
    expect(textOf(el, "[data-split-question]")).toBe(
      "No quedaría nada en T7. ¿Mover los clientes a T8?",
    );
    expect(textOf(el, "[data-split-anyway-note]")).toBe(
      "Separar igualmente deja T7 con una cuenta vacía.",
    );
    expect(q(el, "[data-split-anyway]")!.textContent!.trim()).toBe("Separar igualmente");
  });

  it("Everything ticked: the paid note's Spanish words", async () => {
    setLocale("es-ES");
    const { el } = await paidStays();
    split(el).click();
    await settled(el);
    expect(textOf(el, "[data-split-anyway-note]")).toBe(
      "Separar igualmente deja T7 sin nada que pagar.",
    );
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

  it("Everything ticked: a count made bad under the question stops Split anyway, marked, back at Split", async () => {
    const { el, sent } = await everythingTicked();
    split(el).click();
    await settled(el);
    await typeCount(el, "leaving", "abc");

    q(el, "[data-split-anyway]")!.click();
    await settled(el);

    expect(sent).toEqual([]);
    expect(q(el, "[data-split-question]")).toBeNull();
    expect(stepper(el, "leaving").error).toBe(t("seat.guest_count_invalid"));
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
