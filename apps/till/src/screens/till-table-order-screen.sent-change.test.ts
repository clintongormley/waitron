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

it("disables Change dish in the same update the screen turns busy", async () => {
  const el = await openRow({ lines: [line()] });
  await editNote(el, "warm, no cream");
  const button = q(el, "[data-sent-change]")!;
  expect(button.hasAttribute("disabled")).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(button.hasAttribute("disabled")).toBe(true);
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
  lines: TabLine[] = [line()];
  override render() {
    return html`<till-table-order-screen
        .orderId=${"wo-4"}
        .products=${products}
        .menus=${menuOf(products)}
        .lines=${this.lines}
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

/** Opens the Sent window of the held Flan, or of the fired Coffee when `lines` hold it. */
async function openInApp(lines?: TabLine[], lineId = "l-flan") {
  const { el: app } = await mountWidget<SentChangeLeaveApp>(
    "sent-change-leave-test-app",
    lines === undefined ? {} : { lines },
  );
  const el = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  el.style.width = "1280px";
  await resized(el);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  if (lineId === "l-flan") {
    await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!);
    await panel.updateComplete;
  }
  await userEvent.click(
    panel.shadowRoot!.querySelector<HTMLElement>(`[data-sent-info="${lineId}"]`)!,
  );
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

it("asks before Serve throws a change away, and serves only on Discard", async () => {
  const { el, asked, answer, dialog } = await openInApp([coffee()], "l-coffee");
  const serves: unknown[] = [];
  el.addEventListener("serve-lines", (event) => serves.push((event as CustomEvent).detail));
  await editNote(el, "warm, no cream");
  q(el, "[data-sent-line-serve]")!.click();
  await answer("keep");
  expect(serves).toEqual([]);
  expect(dialog.open).toBe(true);
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-sent-line-serve]")!.click();
  await answer("discard");
  await expect.poll(() => serves).toHaveLength(1);
  await expect.poll(() => dialog.open).toBe(false);
  expect(asked.count).toBe(2);
});

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

it("refuses a fraction below the lowest total as a quantity the dish cannot take, with no Void… beside it", async () => {
  const el = await openRow({ lines: [line()] });
  const seen = changes(el);
  await setQuantity(el, "1.5");
  await pressChange(el);
  expect(seen).toEqual([]);
  expect(quantityField(el)).toEqual({ error: t("line.quantity_invalid"), voidShown: false });
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

/** The open window's title count ("×2"), or null when it shows none. */
function titleCount(el: TillTableOrderScreen): string | null {
  const title = q(el, "[data-sent-line-dialog] .move-dish")!.textContent!;
  return /×\S+/.exec(title)?.[0] ?? null;
}

/** The open window's Total amount, or null when it shows none. */
function windowTotal(el: TillTableOrderScreen): string | null {
  const total = [...el.shadowRoot!.querySelectorAll("[data-sent-line-dialog] .total-row")].find(
    (rowEl) => rowEl.firstElementChild?.textContent?.trim() === t("label.total"),
  );
  return total?.querySelector(".amount")?.textContent?.trim() ?? null;
}

it("shows no count or Total while the fields raise the count, and both again once it is put back", async () => {
  const el = await openRow({ lines: [line()] });
  const [count, total] = [titleCount(el), windowTotal(el)];
  expect(count).toBe("×2");
  expect(total).not.toBeNull();
  await setQuantity(el, "3");
  expect(titleCount(el)).toBeNull();
  expect(windowTotal(el)).toBeNull();
  await setQuantity(el, "");
  expect([titleCount(el), windowTotal(el)]).toEqual([null, null]);
  await setQuantity(el, "2");
  expect([titleCount(el), windowTotal(el)]).toEqual([count, total]);
});

it("keeps the count and Total while only the note or an answer changes, and hides them for an added extra", async () => {
  const lines = [
    line({ productId: "burger", menuItemId: "offer-burger", optionSnapshots: [rare] }),
  ];
  const withExtras = { ...burger, offeredModifiers: [doneness, extrasList] };
  const el = await openRow({ lines, products: [flan, withExtras] });
  const shown = [titleCount(el), windowTotal(el)];
  expect(shown[1]).not.toBeNull();
  await editNote(el, "warm, no salt");
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  picker.shadowRoot!.querySelector<HTMLInputElement>("#label-list-cooked-label-medium")!.click();
  await picker.updateComplete;
  await el.updateComplete;
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(false);
  expect([titleCount(el), windowTotal(el)]).toEqual(shown);
  picker
    .shadowRoot!.querySelector<HTMLElement>('[data-test="pick-list-extras-p-bacon-inc"]')!
    .click();
  await picker.updateComplete;
  await el.updateComplete;
  expect([titleCount(el), windowTotal(el)]).toEqual([null, null]);
});

const startedFlan = "The kitchen has already started Flan, so it can't be changed.";

/** The note box's text inside the open window's fields. */
async function noteShown(el: TillTableOrderScreen): Promise<string> {
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  await picker.updateComplete;
  const field = picker.shadowRoot!.querySelector<WtTextarea>('[data-test="line-note"]')!;
  await field.updateComplete;
  return field.shadowRoot!.querySelector("textarea")!.value;
}

/** Changes the Flan's note and count, presses Change dish, and hands the screen the refusal. */
async function refuseChange(el: TillTableOrderScreen, lineNo = 1) {
  const seen = changes(el);
  await editNote(el, "warm, no cream");
  await setQuantity(el, "3");
  await pressChange(el);
  expect(seen).toHaveLength(1);
  await expect.poll(() => q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(false);
  el.changeRefusal = { lineNo, message: startedFlan };
  await el.updateComplete;
  return seen;
}

it("reopens the window as it was left when the kitchen had started the dish, the refusal above the buttons", async () => {
  const el = await openRow({ lines: [line()], revision: 9, billEdit });
  const seen = await refuseChange(el);
  const dialog = q<WtDialog>(el, "[data-sent-line-dialog]")!;
  await expect.poll(() => dialog.open).toBe(true);
  expect(await noteShown(el)).toBe("warm, no cream");
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  expect(
    picker.shadowRoot!.querySelector<HTMLElement & { value: string }>('[name="quantity"]')!.value,
  ).toBe("3");
  await expect.poll(() => footerSentence(el)?.textContent?.trim()).toBe(startedFlan);
  const change = q(el, "[data-sent-change]")!;
  await expect.poll(() => change.hasAttribute("disabled")).toBe(false);
  const voidButton = q(el, "[data-sent-change-refused-void]")!;
  const compButton = q(el, "[data-sent-change-refused-comp]")!;
  expect(voidButton.textContent!.trim()).toBe(t("table.void_line"));
  expect(compButton.textContent!.trim()).toBe(t("comp.title"));
  const sentence = footerSentence(el)!.getBoundingClientRect();
  for (const action of [change, voidButton, compButton])
    expect(sentence.bottom).toBeLessThanOrEqual(action.getBoundingClientRect().top);
  await pressChange(el);
  expect(seen).toHaveLength(2);
  expect(seen[1]!.patch).toEqual(seen[0]!.patch);
});

it.each([
  ["Sent no longer shows the dish", { currentOrders: current({ groups: [] }) }],
  ["Sent's list is not read yet", { currentOrdersUnread: true }],
] as const)(
  "tells the app it did not show a refusal when %s, opening no window",
  async (_case, over: Partial<TillTableOrderScreen>) => {
    const el = await openRow({ lines: [line()] });
    const taken: { shown: boolean }[] = [];
    el.addEventListener("change-refusal-taken", (event) =>
      taken.push((event as CustomEvent<{ shown: boolean }>).detail),
    );
    const seen = changes(el);
    await editNote(el, "warm, no cream");
    await pressChange(el);
    expect(seen).toHaveLength(1);
    Object.assign(el, over);
    await el.updateComplete;
    el.changeRefusal = { lineNo: 1, message: startedFlan };
    await el.updateComplete;
    expect(taken).toMatchObject([{ shown: false }]);
    expect(q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(false);
  },
);

it("ignores a refusal no Change dish asked for, and a refusal for another dish", async () => {
  const el = await openRow({ lines: [line()] });
  el.changeRefusal = { lineNo: 1, message: startedFlan };
  await el.updateComplete;
  expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
  expect(q(el, "[data-sent-change-refused-void]")).toBeNull();
  el.changeRefusal = null;
  await el.updateComplete;
  await refuseChange(el, 2);
  expect(q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(false);
});

it("drops the refusal and the attempted change once the reopened window closes", async () => {
  const { el, answer, dialog } = await openInApp();
  await refuseChange(el);
  await expect.poll(() => dialog.open).toBe(true);
  q(el, "[data-sent-line-close]")!.click();
  await answer("discard");
  await expect.poll(() => dialog.open).toBe(false);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="l-flan"]')!);
  await el.updateComplete;
  await expect.poll(() => dialog.open).toBe(true);
  expect(await noteShown(el)).toBe("warm");
  expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
  expect(q(el, "[data-sent-change-refused-void]")).toBeNull();
  expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(true);
});

it.each([
  ["void", "cancel-item"],
  ["comp", "adjust"],
] as const)(
  "asks before the refused window's %s throws the change away, and acts only on Discard",
  async (action, type) => {
    const { el, answer, dialog } = await openInApp();
    const events: unknown[] = [];
    el.addEventListener(type, (event) => events.push((event as CustomEvent).detail));
    await refuseChange(el);
    await expect.poll(() => dialog.open).toBe(true);
    q(el, `[data-sent-change-refused-${action}]`)!.click();
    await answer("keep");
    expect(events).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(await noteShown(el)).toBe("warm, no cream");
    q(el, `[data-sent-change-refused-${action}]`)!.click();
    await answer("discard");
    await expect.poll(() => events).toHaveLength(1);
    await expect.poll(() => dialog.open).toBe(false);
  },
);

it.each([
  ["its station stops allowing changes", { lines: [line({ changesAfterSending: "never" })] }],
  ["its bill is presented", { bills: [bill("placed")] }],
] as const)(
  "drops a staged change when %s while the window is open, and opens fresh once it can change again",
  async (_, readOnly) => {
    const el = await openRow({ lines: [line()] });
    await setQuantity(el, "3");
    expect(titleCount(el)).toBeNull();
    Object.assign(el, readOnly);
    await el.updateComplete;
    expect(q<WtDialog>(el, "[data-sent-line-dialog]")!.open).toBe(true);
    expect(offered(el)).toBe(false);
    expect(titleCount(el)).toBe("×2");
    expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
    Object.assign(el, { lines: [line()], bills: [bill("open")] });
    await el.updateComplete;
    expect(offered(el)).toBe(true);
    await q<TillModifierPicker>(el, "till-modifier-picker")!.updateComplete;
    await el.updateComplete;
    expect(titleCount(el)).toBe("×2");
    expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(true);
  },
);

/** A live update in which another device changed the Flan: its bill line as `over` says, at revision 10. */
async function changedElsewhere(el: TillTableOrderScreen, lines: TabLine[]) {
  el.lines = lines;
  el.revision = 10;
  await el.updateComplete;
  await q<TillModifierPicker>(el, "till-modifier-picker")!.updateComplete;
  await el.updateComplete;
}

const bacon = line({
  id: "l-bacon",
  name: "Bacon",
  lineNo: 2,
  parentLineNo: 1,
  productId: "p-bacon",
  listId: "list-extras",
  menuItemId: null,
  note: null,
});

it.each<[string, TabLine[], Partial<TillTableOrderScreen>]>([
  ["its note", [line({ note: "Peanut allergy" })], {}],
  ["its count", [line({ quantity: "3.000" })], {}],
  [
    "its extras",
    [line({ productId: "burger", menuItemId: "offer-burger" }), bacon],
    { products: [flan, { ...burger, offeredModifiers: [extrasList] }] },
  ],
])(
  "throws a staged change away and says so when another device changes %s, so the newer one is never overwritten",
  async (_, newer, over) => {
    const lines =
      newer[0]!.productId === "burger"
        ? [line({ productId: "burger", menuItemId: "offer-burger" })]
        : [line()];
    const el = await openRow({ lines, revision: 9, billEdit, ...over });
    const seen = changes(el);
    await editNote(el, "warm, no cream");
    await changedElsewhere(el, newer);
    expect(seen).toEqual([]);
    await expect
      .poll(() => footerSentence(el)?.textContent?.trim())
      .toBe(t("held.changed_elsewhere"));
    expect(await noteShown(el)).toBe(newer[0]!.note);
    expect(q(el, "[data-sent-change]")!.hasAttribute("disabled")).toBe(true);
    await editNote(el, `${newer[0]!.note}, no cream`);
    expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
    await pressChange(el);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ revision: 10, patch: { note: `${newer[0]!.note}, no cream` } });
    if (newer.length > 1)
      expect(seen[0]!.patch.extras).toEqual([
        { listId: "list-extras", picks: [{ productId: "p-bacon", quantity: 1 }] },
      ]);
  },
);

it("brings another device's change into a window with nothing staged, saying nothing", async () => {
  const el = await openRow({ lines: [line()], revision: 9, billEdit });
  const seen = changes(el);
  await changedElsewhere(el, [line({ note: "Peanut allergy" })]);
  expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
  expect(await noteShown(el)).toBe("Peanut allergy");
  await setQuantity(el, "3");
  await pressChange(el);
  expect(seen).toMatchObject([
    { revision: 10, patch: { note: "Peanut allergy", quantity: "3", portionLineNos: [] } },
  ]);
});

it("keeps a staged change through an update that leaves its dish as it was", async () => {
  const el = await openRow({ lines: [line()], revision: 9, billEdit });
  const seen = changes(el);
  await setQuantity(el, "3");
  await changedElsewhere(el, [line(), coffee({ lineNo: 5 })]);
  expect(footerSentence(el)?.textContent?.trim() ?? "").toBe("");
  await pressChange(el);
  expect(seen).toMatchObject([{ revision: 10, patch: { note: "warm", quantity: "3" } }]);
});

it("moves focus to the count when Change dish is pressed with a lower one", async () => {
  const el = await openRow({ lines: [line()] });
  await setQuantity(el, "1");
  await pressChange(el);
  const picker = q<TillModifierPicker>(el, "till-modifier-picker")!;
  const field = picker.shadowRoot!.querySelector('[name="quantity"]');
  await expect.poll(() => picker.shadowRoot!.activeElement).toBe(field);
});
