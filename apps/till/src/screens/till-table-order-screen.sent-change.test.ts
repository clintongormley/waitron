import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, type WtDialog, type WtRowActions, type WtTextarea } from "@waitron/ui";
import type {
  BillBalance,
  BillEditExpected,
  CurrentOrders,
  PartyBill,
  TabLine,
} from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import {
  burger,
  flan,
  menuOf,
  mount,
  products,
  resized,
} from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  groups,
  now,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import "./till-table-order-screen.js";
import type { ChangeLineDetail, TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const sent = "2026-09-28T19:50:00.000Z";

function bill(status: PartyBill["status"]): PartyBill {
  return {
    workingOrderId: "wo-4",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    billNumber: 1,
    billName: null,
    status,
    total: "10.00",
    outstanding: status === "open" ? "10.00" : "0.00",
    hasPayments: status !== "open",
    receiptAvailable: false,
  };
}

/** The bill line behind a Sent row: the held Flan by default, sold as the till's Flan. */
function line(over: Partial<TabLine> = {}): TabLine {
  return {
    changesAfterSending: "held-or-waiting",
    id: "l-flan",
    name: "Flan",
    lineNo: 1,
    groupId: "g3",
    productId: flan.id,
    quantity: "2.000",
    unitPrecision: 0,
    unitPriceGross: "2.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: "queued",
    note: "warm",
    listId: null,
    menuItemId: flan.menuItemId!,
    parentProductId: null,
    stationId: "cold",
    movable: true,
    ...over,
  };
}

const coffee = (over: Partial<TabLine> = {}) =>
  line({ id: "l-coffee", name: "Coffee", groupId: null, sentAt: sent, firedAt: sent, ...over });

const q = <T extends HTMLElement = HTMLElement>(el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

/** Opens the Sent window of `lineId`, unfolding `fold` first. */
async function openRow(
  over: Partial<TillTableOrderScreen>,
  lineId = "l-flan",
  fold: "held" | "served" | null = "held",
) {
  const { el } = await mount({
    currentOrders: current(),
    groups,
    now,
    bills: [bill("open")],
    ...over,
  });
  el.style.width = "1280px";
  await resized(el);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  if (fold !== null) {
    await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>(`[data-${fold}-toggle]`)!);
    await panel.updateComplete;
  }
  await userEvent.click(
    panel.shadowRoot!.querySelector<HTMLElement>(`[data-sent-info="${lineId}"]`)!,
  );
  await el.updateComplete;
  expect(q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(true);
  return el;
}

/** Whether the open window offers Change dish, with the dish's fields inside it. */
function offered(el: TillTableOrderScreen): boolean {
  const button = q(el, "[data-sent-line-dialog] [data-sent-change]");
  const fields = q(el, "[data-sent-line-dialog] till-modifier-picker");
  expect(fields !== null).toBe(button !== null);
  return button !== null;
}

async function offeredFor(
  over: Partial<TillTableOrderScreen>,
  lineId?: string,
  fold?: "held" | "served" | null,
) {
  const el = await openRow(over, lineId, fold);
  const shown = offered(el);
  cleanupWidgets();
  return shown;
}

async function editNote(el: TillTableOrderScreen, note: string) {
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  await picker.updateComplete;
  const field = picker.shadowRoot!.querySelector<WtTextarea>('[data-test="line-note"]')!;
  await field.updateComplete;
  const box = field.shadowRoot!.querySelector("textarea")!;
  box.value = note;
  box.dispatchEvent(new Event("input"));
  await picker.updateComplete;
  await el.updateComplete;
}

it("offers Change dish on a held row at a While held or waiting station", async () => {
  expect(await offeredFor({ lines: [line()] })).toBe(true);
});

it("offers Change dish at a While held station only while the row is held", async () => {
  expect(await offeredFor({ lines: [line({ changesAfterSending: "held" })] })).toBe(true);
  expect(
    await offeredFor({ lines: [coffee({ changesAfterSending: "held" })] }, "l-coffee", null),
  ).toBe(false);
  expect(await offeredFor({ lines: [coffee()] }, "l-coffee", null)).toBe(true);
});

it("offers no Change dish at a Not allowed station, nor when an extra's station forbids it", async () => {
  expect(await offeredFor({ lines: [line({ changesAfterSending: "never" })] })).toBe(false);
  const extra = (changesAfterSending: TabLine["changesAfterSending"]) =>
    line({
      id: "l-cream",
      name: "Cream",
      lineNo: 2,
      parentLineNo: 1,
      productId: "cream",
      menuItemId: null,
      note: null,
      stationId: "bar",
      changesAfterSending,
    });
  expect(await offeredFor({ lines: [line(), extra("never")] })).toBe(false);
  expect(await offeredFor({ lines: [line(), extra("held-or-waiting")] })).toBe(true);
});

it("offers Change dish on a row the kitchen has started", async () => {
  expect(
    await offeredFor(
      {
        lines: [
          line({
            id: "l-fish",
            name: "Fish",
            groupId: "g2",
            sentAt: sent,
            firedAt: sent,
            state: "preparing",
          }),
        ],
      },
      "l-fish",
      null,
    ),
  ).toBe(true);
});

it("offers no Change dish on a served row", async () => {
  expect(
    await offeredFor(
      {
        lines: [line({ id: "l-salad", name: "Salad", groupId: "g1", sentAt: sent, firedAt: sent })],
      },
      "l-salad",
      "served",
    ),
  ).toBe(false);
});

it("offers no Change dish on a charged-cancelled row", async () => {
  const orders: CurrentOrders = structuredClone(current());
  orders.groups[2]!.rows[0]!.cancelledQuantity = "2.000";
  expect(
    await offeredFor(
      { currentOrders: orders, lines: [line({ cancelledQuantity: "2.000" })] },
      "l-flan",
      "served",
    ),
  ).toBe(false);
});

it("offers no Change dish on a row of a presented bill, nor one whose line is not on this bill", async () => {
  expect(await offeredFor({ lines: [line()], bills: [bill("placed")] })).toBe(false);
  expect(await offeredFor({ lines: [line({ id: "l-other" })] })).toBe(false);
});

it("offers no Change dish on a row someone has recalled", async () => {
  const draft = new DraftStore();
  draft.loadFrom("draft", [
    {
      product: flan,
      quantity: "2",
      place: { kind: "fire" },
      source: { line: line(), extras: [], netAmount: "6.00" },
    },
  ]);
  expect(await offeredFor({ lines: [line()], draftStore: draft })).toBe(false);
});

it("offers no Change dish when the row's line is an extra", async () => {
  expect(await offeredFor({ lines: [line({ parentLineNo: 3 })] })).toBe(false);
});

it("offers no Change dish when the till does not have the dish's product", async () => {
  expect(await offeredFor({ lines: [line({ productId: "gone", menuItemId: "offer-gone" })] })).toBe(
    false,
  );
});

it("offers no Change dish on a paid row", async () => {
  const orders: CurrentOrders = structuredClone(current());
  orders.groups[2]!.rows[0]!.billStatus = "settled";
  expect(
    await offeredFor({ currentOrders: orders, lines: [line()], bills: [bill("settled")] }),
  ).toBe(false);
});

it("shows a partly paid row read-only, its dish or an extra paid, keeping its other actions", async () => {
  const balance = (paidLines: BillBalance["paidLines"]): BillBalance => ({
    workingOrderId: "wo-4",
    status: "open",
    total: "10.00",
    received: "2.00",
    reserved: "0.00",
    outstanding: "8.00",
    tips: "0.00",
    payments: [],
    paidLines,
  });
  const cream = line({
    id: "l-cream",
    name: "Cream",
    lineNo: 2,
    parentLineNo: 1,
    productId: "cream",
    menuItemId: null,
    note: null,
  });
  const el = await openRow({
    lines: [line(), cream],
    billBalance: balance([{ lineId: "l-flan", lineNo: 1, paidQuantity: "1.000" }]),
  });
  expect(offered(el)).toBe(false);
  expect(q(el, "[data-sent-line-dialog] wt-row-actions")).not.toBeNull();
  cleanupWidgets();
  expect(
    await offeredFor({
      lines: [line(), cream],
      billBalance: balance([{ lineId: "l-cream", lineNo: 2, paidQuantity: "1.000" }]),
    }),
  ).toBe(false);
  expect(
    await offeredFor({
      lines: [line(), cream],
      billBalance: balance([{ lineId: "l-flan", lineNo: 1, paidQuantity: "0.000" }]),
    }),
  ).toBe(true);
});

it("keeps Change dish quiet and disabled until the dish changes, and again once it is put back", async () => {
  setLocale("es");
  const el = await openRow({ lines: [line()] });
  const button = q(el, "[data-sent-change]")!;
  expect(button.textContent!.trim()).toBe("Cambiar plato");
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.getAttribute("variant")).toBe("secondary");
  await editNote(el, "warm, no cream");
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(button.getAttribute("variant")).toBe("primary");
  await editNote(el, "warm");
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.getAttribute("variant")).toBe("secondary");
});

/** The dialog's footer sentence, which wt-dialog draws above the footer's row of buttons. */
function footerSentence(el: TillTableOrderScreen): HTMLElement | null {
  const dialog = q<WtDialog>(el, "[data-sent-line-dialog]")!;
  return dialog.shadowRoot!.querySelector<HTMLElement>(".footer > .form-message");
}

it("names the fields to fix on its own line above the buttons after Change dish with a refused quantity", async () => {
  const el = await openRow({ lines: [line()] });
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  picker
    .shadowRoot!.querySelector('[name="quantity"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1.5" } }));
  await picker.updateComplete;
  await el.updateComplete;
  expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
  const button = q(el, "[data-sent-change]")!;
  expect(button.hasAttribute("disabled")).toBe(false);
  await userEvent.click(button);
  await picker.updateComplete;
  await el.updateComplete;
  await expect.poll(() => footerSentence(el)?.textContent?.trim()).toBe(t("form.fix_fields"));
  const sentence = footerSentence(el)!.getBoundingClientRect();
  for (const action of [q(el, "[data-sent-line-close]")!, button])
    expect(sentence.bottom).toBeLessThanOrEqual(action.getBoundingClientRect().top);
  expect(button.hasAttribute("disabled")).toBe(true);
});

it("opens a row with no note unchanged", async () => {
  const el = await openRow({ lines: [line({ note: null })] });
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  await picker.updateComplete;
  await el.updateComplete;
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(true);
});

it("offers no Change dish on a row partly served", async () => {
  expect(
    await offeredFor(
      {
        lines: [
          line({
            id: "l-croq",
            name: "Croquetas",
            quantity: "4.000",
            groupId: "g1",
            sentAt: sent,
            firedAt: sent,
          }),
        ],
      },
      "l-croq",
      null,
    ),
  ).toBe(false);
});

it("shows the note only in its field while the dish can be changed", async () => {
  const orders: CurrentOrders = structuredClone(current());
  orders.groups[2]!.rows[0]!.note = "warm";
  const el = await openRow({ currentOrders: orders, lines: [line()] });
  const dialog = q(el, "[data-sent-line-dialog]")!;
  expect(dialog.textContent).not.toContain(`${t("line.note.label")}: warm`);
  cleanupWidgets();
  const readOnly = await openRow({
    currentOrders: orders,
    lines: [line({ changesAfterSending: "never" })],
  });
  expect(q(readOnly, "[data-sent-line-dialog]")!.textContent).toContain(
    `${t("line.note.label")}: warm`,
  );
});

it("opens a fresh, unchanged window for another row", async () => {
  const el = await openRow({ lines: [line()] });
  await editNote(el, "warm, no cream");
  await userEvent.click(q(el, "[data-sent-line-close]")!);
  await expect.poll(() => q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(false);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="l-flan"]')!);
  await el.updateComplete;
  const button = q(el, "[data-sent-change]")!;
  expect(button.hasAttribute("disabled")).toBe(true);
});

class SentChangeLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<till-table-order-screen
        .orderId=${"wo-4"}
        .products=${products}
        .menus=${menuOf(products)}
        .lines=${[line()]}
        .bills=${[bill("open")]}
        .groups=${groups}
        .currentOrders=${current()}
        .now=${now}
        .draftStore=${new DraftStore()}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("sent-change-leave-test-app", SentChangeLeaveApp);

async function openInApp() {
  const { el: app } = await mountWidget<SentChangeLeaveApp>("sent-change-leave-test-app", {});
  const el = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  el.style.width = "1280px";
  await resized(el);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!);
  await panel.updateComplete;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="l-flan"]')!);
  await el.updateComplete;
  const coordinator = app.leave.coordinator;
  const request = coordinator.request.bind(coordinator);
  const asked = { count: 0 };
  coordinator.request = (leave) => {
    asked.count++;
    return request(leave);
  };
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  const answer = async (choice: "keep" | "discard") => {
    await expect.poll(() => question.open).toBe(true);
    await question.updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
    await expect.poll(() => question.open).toBe(false);
  };
  return { el, asked, answer, dialog: q<WtDialog>(el, "[data-sent-line-dialog]")! };
}

it("asks once before Close throws a change away, and keeps the change on Keep", async () => {
  const { el, asked, answer, dialog } = await openInApp();
  await editNote(el, "warm, no cream");
  q(el, "[data-sent-line-close]")!.click();
  await answer("keep");
  expect(dialog.open).toBe(true);
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-sent-line-close]")!.click();
  await answer("discard");
  await expect.poll(() => dialog.open).toBe(false);
  await expect.poll(() => q(el, "till-modifier-picker")).toBeNull();
  expect(asked.count).toBe(2);
});

it.each([
  ["fire", "fire-held-line"],
  ["void", "cancel-item"],
] as const)(
  "asks before %s throws a change away, and acts only on Discard",
  async (action, type) => {
    const { el, asked, answer, dialog } = await openInApp();
    const events: unknown[] = [];
    el.addEventListener(type, (event) => events.push((event as CustomEvent).detail));
    const press = async () => {
      const more = q(el, "[data-sent-line-dialog] wt-row-actions") as WtRowActions;
      await more.updateComplete;
      await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
      q(el, `[data-sent-line-${action}]`)!.click();
    };
    await press();
    await expect.poll(() => events).toHaveLength(1);
    await expect.poll(() => dialog.open).toBe(false);
    expect(asked.count).toBe(0);
    events.length = 0;
    const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
    await userEvent.click(
      panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="l-flan"]')!,
    );
    await el.updateComplete;
    await editNote(el, "warm, no cream");
    await press();
    await answer("keep");
    expect(events).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(false);
    await press();
    await answer("discard");
    await expect.poll(() => events).toHaveLength(1);
    await expect.poll(() => dialog.open).toBe(false);
    expect(asked.count).toBe(2);
  },
);

const billEdit: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 3,
  draftId: "draft-1",
  draftRevision: 2,
};

/** Every `change-line` the screen sends. */
function changes(el: TillTableOrderScreen): ChangeLineDetail[] {
  const seen: ChangeLineDetail[] = [];
  el.addEventListener("change-line", (event) =>
    seen.push((event as CustomEvent<ChangeLineDetail>).detail),
  );
  return seen;
}

async function setQuantity(el: TillTableOrderScreen, value: string) {
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  picker
    .shadowRoot!.querySelector('[name="quantity"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await picker.updateComplete;
  await el.updateComplete;
}

async function pressChange(el: TillTableOrderScreen) {
  const button = q(el, "[data-sent-change]")!;
  expect(button.hasAttribute("disabled")).toBe(false);
  await userEvent.click(button);
  await el.updateComplete;
}

const doneness = burger.offeredModifiers!.find((list) => list.kind === "options")!;
const extrasList = burger.offeredModifiers!.find((list) => list.kind === "extras")!;
const steakish = { ...burger, offeredModifiers: [doneness] };
const rare = {
  listName: { en: "Doneness" },
  listCustomerName: { es: "Punto carta" },
  listKitchenName: "Punto KDS",
  labelName: { en: "Rare" },
  labelCustomerName: { es: "Poco hecha carta" },
  labelKitchenName: "Poco hecha KDS",
};

it("sends a note change for the row and closes the window", async () => {
  const el = await openRow({ lines: [line()], revision: 9, billEdit });
  const seen = changes(el);
  await editNote(el, "warm, no cream");
  await pressChange(el);
  expect(seen).toEqual([
    {
      lineNo: 1,
      lineName: "Flan",
      patch: { note: "warm, no cream", portionLineNos: [] },
      revision: 9,
      expectedEdit: billEdit,
      saleLine: {
        menuItemId: "offer-flan",
        quantity: "2",
        options: [],
        extras: [],
        note: "warm, no cream",
      },
    },
  ]);
  await expect.poll(() => q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(false);
});

it("sends a cleared note as null, and a note that opened empty as null", async () => {
  const el = await openRow({ lines: [line()], revision: 9, billEdit });
  const seen = changes(el);
  await editNote(el, "");
  await pressChange(el);
  expect(seen[0]!.patch).toEqual({ note: null, portionLineNos: [] });
  cleanupWidgets();
  const empty = await openRow({ lines: [line({ note: null })], revision: 9, billEdit });
  const sent = changes(empty);
  await setQuantity(empty, "3");
  await pressChange(empty);
  expect(sent[0]!.patch).toEqual({ note: null, portionLineNos: [], quantity: "3" });
});

it("sends a changed answer, and leaves the answers out when only the note changed", async () => {
  const lines = [
    line({ productId: "burger", menuItemId: "offer-burger", optionSnapshots: [rare] }),
  ];
  const el = await openRow({ lines, products: [flan, steakish], revision: 9, billEdit });
  const seen = changes(el);
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLInputElement>("#label-list-cooked-label-medium")!.click();
  await picker.updateComplete;
  await el.updateComplete;
  await pressChange(el);
  expect(seen[0]!.patch).toEqual({
    note: "warm",
    portionLineNos: [],
    options: [{ listId: "list-cooked", labelId: "label-medium" }],
  });
  expect(seen[0]!.saleLine).toMatchObject({
    menuItemId: "offer-burger",
    options: [{ listId: "list-cooked", labelId: "label-medium" }],
  });
  cleanupWidgets();
  const noteOnly = await openRow({ lines, products: [flan, steakish], revision: 9, billEdit });
  const sent = changes(noteOnly);
  await editNote(noteOnly, "warm, no salt");
  await pressChange(noteOnly);
  expect(sent[0]!.patch).toEqual({ note: "warm, no salt", portionLineNos: [] });
});

it("hides the dish's answers above the fields while they can be changed", async () => {
  const lines = (changesAfterSending: TabLine["changesAfterSending"]) => [
    line({
      productId: "burger",
      menuItemId: "offer-burger",
      optionSnapshots: [rare],
      changesAfterSending,
    }),
  ];
  const el = await openRow({ lines: lines("held-or-waiting"), products: [flan, steakish] });
  expect(q(el, "[data-sent-line-dialog] .move-dish .modifier-answer")).toBeNull();
  cleanupWidgets();
  const readOnly = await openRow({ lines: lines("never"), products: [flan, steakish] });
  expect(q(readOnly, "[data-sent-line-dialog] .move-dish .modifier-answer")).not.toBeNull();
});

it("raises a row of 2 as one save naming both dishes, with the row's new total", async () => {
  const portion = (lineId: string, lineNo: number) =>
    row(lineId, "Flan", "1.000", {
      lineNo,
      released: false,
      firedAt: null,
      kitchen: { stationId: null, movable: false, state: "queued", firedAt: null },
    });
  const orders = current();
  orders.groups[2] = currentGroup("g3", 3, "held", [portion("l-flan", 1), portion("l-flan-2", 2)]);
  const el = await openRow({
    currentOrders: orders,
    lines: [
      line({ quantity: "1.000", portion: true }),
      line({ id: "l-flan-2", lineNo: 2, quantity: "1.000", portion: true }),
    ],
    revision: 9,
    billEdit,
  });
  const seen = changes(el);
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  expect(picker.quantity).toBe("2");
  await setQuantity(el, "3");
  await pressChange(el);
  expect(seen).toEqual([
    {
      lineNo: 1,
      lineName: "Flan",
      patch: { note: "warm", portionLineNos: [2], quantity: "3" },
      revision: 9,
      expectedEdit: billEdit,
      saleLine: { menuItemId: "offer-flan", quantity: "3", options: [], extras: [], note: "warm" },
    },
  ]);
});

it("shows a weighed dish's quantity read-only and sends its note change without a quantity", async () => {
  const orders: CurrentOrders = structuredClone(current());
  Object.assign(orders.groups[2]!.rows[0]!, { quantity: "0.350", unitPrecision: 3, extras: [] });
  const el = await openRow({
    currentOrders: orders,
    lines: [
      line({
        productId: "jamon",
        menuItemId: "offer-jamon",
        quantity: "0.350",
        unitPrecision: 3,
      }),
    ],
    revision: 9,
    billEdit,
  });
  const seen = changes(el);
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  await picker.updateComplete;
  expect(picker.shadowRoot!.querySelector('[name="quantity"]')).toBeNull();
  expect(picker.lineDetails).toBe(true);
  expect(q(el, "[data-sent-line-dialog] .move-dish")!.textContent).toContain("×0.35");
  await editNote(el, "thin slices");
  await pressChange(el);
  expect(seen).toEqual([
    {
      lineNo: 1,
      lineName: "Flan",
      patch: { note: "thin slices", portionLineNos: [] },
      revision: 9,
      expectedEdit: billEdit,
      saleLine: {
        menuItemId: "offer-jamon",
        quantity: "0.350",
        options: [],
        extras: [],
        note: "thin slices",
      },
    },
  ]);
});

/** The quantity field's own message, and whether the field shows the host's Void… beside it. */
function quantityField(el: TillTableOrderScreen) {
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  const field = picker.shadowRoot!.querySelector<HTMLElement & { error: string }>(
    '[name="quantity"]',
  )!;
  const slot = picker.shadowRoot!.querySelector<HTMLSlotElement>(
    'slot[name="min-quantity-action"]',
  );
  return {
    error: field.error,
    voidShown: slot?.assignedElements().includes(q(el, "[data-sent-change-void]")!) ?? false,
  };
}

it("refuses a lower total at its field, with Void… beside it, which asks before opening Void for the row", async () => {
  setLocale("es");
  const { el, answer, dialog } = await openInApp();
  const seen = changes(el);
  const voids: unknown[] = [];
  el.addEventListener("cancel-item", (event) => voids.push((event as CustomEvent).detail));
  await editNote(el, "warm, no cream");
  await setQuantity(el, "1");
  expect(quantityField(el)).toEqual({ error: "", voidShown: false });
  await pressChange(el);
  expect(seen).toEqual([]);
  expect(dialog.open).toBe(true);
  expect(quantityField(el)).toEqual({ error: "Para quitar uno, usa Cancelar…", voidShown: true });
  expect(q(el, "[data-sent-change-void]")!.textContent!.trim()).toBe("Cancelar…");
  await expect.poll(() => footerSentence(el)?.textContent?.trim()).toBe(t("form.fix_fields"));
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(true);
  await setQuantity(el, "2");
  expect(quantityField(el)).toEqual({ error: "", voidShown: false });
  expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(false);
  await setQuantity(el, "1");
  expect(quantityField(el).voidShown).toBe(true);
  q(el, "[data-sent-change-void]")!.click();
  await answer("keep");
  expect(voids).toEqual([]);
  expect(dialog.open).toBe(true);
  q(el, "[data-sent-change-void]")!.click();
  await answer("discard");
  await expect.poll(() => voids).toEqual([{ lineId: "l-flan" }]);
  await expect.poll(() => dialog.open).toBe(false);
  expect(seen).toEqual([]);
});

it("sends a whole total typed with a decimal place as digits only", async () => {
  const el = await openRow({ lines: [line()], revision: 9, billEdit });
  const seen = changes(el);
  await setQuantity(el, "3.0");
  await pressChange(el);
  expect(seen[0]!.patch).toEqual({ note: "warm", portionLineNos: [], quantity: "3" });
  expect(seen[0]!.saleLine!.quantity).toBe("3");
});

it("sends a dish's extras when they change, and its whole set with any other change", async () => {
  const extrasOnly = { ...burger, offeredModifiers: [extrasList] };
  const lines = [line({ productId: "burger", menuItemId: "offer-burger" })];
  const el = await openRow({ lines, products: [flan, extrasOnly], revision: 9, billEdit });
  const seen = changes(el);
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  await picker.updateComplete;
  picker
    .shadowRoot!.querySelector<HTMLElement>('[data-test="pick-list-extras-p-bacon-inc"]')!
    .click();
  await picker.updateComplete;
  await el.updateComplete;
  await pressChange(el);
  const bacon = [{ listId: "list-extras", picks: [{ productId: "p-bacon", quantity: 1 }] }];
  expect(seen[0]!.patch).toEqual({ note: "warm", portionLineNos: [], extras: bacon });
  expect(seen[0]!.saleLine!.extras).toEqual(bacon);
  cleanupWidgets();
  const noteOnly = await openRow({ lines, products: [flan, extrasOnly], revision: 9, billEdit });
  const sent = changes(noteOnly);
  await editNote(noteOnly, "warm, no salt");
  await pressChange(noteOnly);
  expect(sent[0]!.patch).toEqual({ note: "warm, no salt", portionLineNos: [], extras: [] });
});
