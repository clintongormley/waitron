import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { PartyAllergyRead } from "@waitron/module";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { fill, setLocale, t } from "../i18n/t.js";
import type { TillSplitPicker } from "../widgets/split-picker.js";
import "./till-table-order-screen.js";
import type { SplitTableDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
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
