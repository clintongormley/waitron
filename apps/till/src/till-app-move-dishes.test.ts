import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import type { BillBalance, PartyBill, TabLine } from "./api/client.js";
import { codeMessage } from "./i18n/codes.js";
import { currentLocale, differentPeopleText, setLocale, t } from "./i18n/t.js";
import { cleanupWidgets, partyBillOf } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import type { TillPortionPicker } from "./widgets/portion-picker.js";
import {
  api,
  drillFormFactor,
  emit,
  flush,
  mountApp,
  openTable,
  party,
  resetAllergyFixture,
  table,
  table7,
  tableOrder,
  till,
} from "../test/allergy-app-fixture.js";

const locale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const money = (amount: string) => formatMoney(amount, currentLocale());
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const bannerText = (el: TillApp) => banner(el)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

function bill(id: string, billNumber: number, over: Partial<PartyBill> = {}): PartyBill {
  return { ...partyBillOf("v1", id, billNumber), ...over };
}

const DISH: TabLine = {
  id: "line-1",
  lineNo: 1,
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
  unitPriceGross: "3.00",
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
};

function balance(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "3.00",
    received: "0.00",
    reserved: "0.00",
    outstanding: "3.00",
    tips: "0.00",
    payments: [],
    paidLines: [],
    ...over,
  };
}

const twoBills = () => [bill("wo-4", 1), bill("bill-1", 2)];
/** Bill 1 holds a payment, so the app reads its balance with the bills. */
const partPaid = () => [bill("wo-4", 1, { hasPayments: true }), bill("bill-1", 2)];
const seated = party({ billCount: 2 });

async function open(overrides: Record<string, unknown> = {}) {
  const { el } = await mountApp({
    getTablesState: vi.fn().mockResolvedValue([table("t4", "4", seated), table7]),
    getPartyBills: vi.fn().mockResolvedValue(twoBills()),
    getTabLines: vi.fn().mockResolvedValue({ lines: [DISH], revision: 0 }),
    moveDishes: vi.fn().mockResolvedValue({ billId: "bill-1" }),
    ...overrides,
  });
  const order = await openTable(el);
  return { el, order };
}

const sourceEdit = { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null };

describe("A803 move dishes app:", () => {
  it("Move to a new bill sends the picked ids with the two revisions and the source's editor, then shows the new bill", async () => {
    const getPartyBills = vi
      .fn()
      .mockResolvedValueOnce(twoBills())
      .mockResolvedValue([...twoBills(), bill("wo-new", 3)]);
    const { el, order } = await open({
      getPartyBills,
      moveDishes: vi.fn().mockResolvedValue({ billId: "wo-new" }),
    });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await flush(el, 6);

    expect(api.moveDishes).toHaveBeenCalledTimes(1);
    expect(api.moveDishes).toHaveBeenCalledWith("wo-4", ["line-1"], null, {
      expectedPartyRevision: 3,
      partyId: "v1",
      expectedEdits: [sourceEdit],
    });
    expect(tableOrder(el)!.orderId).toBe("wo-new");
    expect(bannerText(el)).toBe("");
  });

  it("Move to Bill 2 sends both editors in bill-id order and stays on Bill 1", async () => {
    const { el, order } = await open();
    const lineReads = api.getTabLines.mock.calls.length;

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
    await flush(el, 6);

    expect(api.moveDishes).toHaveBeenCalledWith("wo-4", ["line-1"], "bill-1", {
      expectedPartyRevision: 3,
      partyId: "v1",
      expectedEdits: [
        { billId: "bill-1", editorVersion: 0, draftId: null, draftRevision: null },
        sourceEdit,
      ],
    });
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(api.getTabLines.mock.calls.length).toBeGreaterThan(lineReads);
  });

  it("sends nothing for an empty choice", async () => {
    const { el, order } = await open();

    emit(order, "move-dishes", { lineIds: [], toBillId: "bill-1" });
    await flush(el);

    expect(api.moveDishes).not.toHaveBeenCalled();
    expect(bannerText(el)).toBe("");
  });

  it("over the simplified-invoice limit the question comes first, and No sends nothing", async () => {
    const { el, order } = await open({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till(drillFormFactor), simplifiedInvoiceLimit: "3000.00" }),
      getPartyBills: vi
        .fn()
        .mockResolvedValue([
          bill("wo-4", 1, { total: "3500.00", outstanding: "3500.00" }),
          bill("bill-1", 2),
        ]),
    });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await flush(el);

    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");
    expect(dialog?.textContent).toContain(differentPeopleText("3000.00"));
    expect(api.moveDishes).not.toHaveBeenCalled();
    dialog!.querySelector<HTMLElement>("[data-cancel]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).toBeNull();
    expect(api.moveDishes).not.toHaveBeenCalled();

    emit(tableOrder(el)!, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>(
      "[data-confirm-different-people] [data-confirm]",
    )!.click();
    await flush(el);
    expect(api.moveDishes).toHaveBeenCalledTimes(1);
  });

  it("bill.received_exceeds_total shows the approved sentence with Refund {amount}", async () => {
    const { el, order } = await open({
      moveDishes: vi.fn().mockRejectedValue({
        code: "bill.received_exceeds_total",
        status: 409,
        workingOrderId: "wo-4",
        excess: "2.00",
      }),
    });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await flush(el, 6);

    expect(bannerText(el)).toContain(
      t("bill.received_exceeds_total_excess").replaceAll("{amount}", money("2.00")),
    );
    const refund = banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!;
    expect(refund.textContent!.trim()).toBe(
      t("bill.refund_excess").replace("{amount}", money("2.00")),
    );
    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it("bill.line_paid shows its sentence and reads the party's bills and the bill's balance again, not its lines", async () => {
    const { el, order } = await open({
      getPartyBills: vi.fn().mockResolvedValue(partPaid()),
      moveDishes: vi.fn().mockRejectedValue({ code: "bill.line_paid", status: 409 }),
    });
    const bills = api.getPartyBills.mock.calls.length;
    const balances = api.getBillBalance.mock.calls.length;
    const lineReads = api.getTabLines.mock.calls.length;

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
    await flush(el, 6);

    expect(bannerText(el)).toContain(codeMessage("bill.line_paid"));
    expect(api.getPartyBills.mock.calls.length).toBe(bills + 1);
    expect(api.getBillBalance.mock.calls.length).toBeGreaterThan(balances);
    expect(api.getTabLines.mock.calls.length).toBe(lineReads);
  });

  it("party.out_of_date reloads the order and says what changed", async () => {
    const getTablesState = vi
      .fn()
      .mockResolvedValueOnce([table("t4", "4", seated), table7])
      .mockResolvedValue([
        table("t4", "4", party({ billCount: 2, revision: 4, tableIds: ["t4", "t7"] })),
        table7,
      ]);
    const { el, order } = await open({
      getTablesState,
      moveDishes: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 4 }),
    });
    const floorReads = getTablesState.mock.calls.length;

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
    await flush(el, 6);

    expect(getTablesState.mock.calls.length).toBeGreaterThan(floorReads);
    expect(bannerText(el)).toContain(t("party.changed").replace("{table}", "4"));
    expect(bannerText(el)).not.toContain(t("table.error"));
  });

  it.each(["draft.taken_over", "draft.out_of_date"])(
    "%s shows its own words, reads the bill's drafts again, and moves nothing",
    async (code) => {
      const { el, order } = await open({
        moveDishes: vi.fn().mockRejectedValue({ code, status: 409 }),
      });
      const draftReads = api.listDrafts.mock.calls.length;

      emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
      await flush(el, 6);

      expect(bannerText(el)).toContain(codeMessage(code));
      expect(bannerText(el)).not.toContain(t("table.error"));
      expect(api.listDrafts.mock.calls.length).toBeGreaterThan(draftReads);
      expect(tableOrder(el)!.orderId).toBe("wo-4");
    },
  );

  it("tab.split_held_line shows the held-dish sentence", async () => {
    const { el, order } = await open({
      moveDishes: vi.fn().mockRejectedValue({ code: "tab.split_held_line", status: 409 }),
    });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await flush(el, 6);

    expect(bannerText(el)).toContain(t("table.split_held_error"));
  });

  it("service_zone.mode_incompatible says the two bills are served differently", async () => {
    const { el, order } = await open({
      moveDishes: vi.fn().mockRejectedValue({ code: "service_zone.mode_incompatible" }),
    });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
    await flush(el, 6);

    expect(bannerText(el)).toContain(t("table.bills_served_differently"));
  });

  it("a refusal leaves the source bill on screen with the panel closed, and opening Move dishes… again starts with nothing picked over the re-read balance", async () => {
    const getBillBalance = vi
      .fn()
      .mockResolvedValueOnce(balance())
      .mockResolvedValue(
        balance({
          received: "3.00",
          outstanding: "0.00",
          paidLines: [{ lineId: "line-1", lineNo: 1, paidQuantity: "1.000" }],
        }),
      );
    const { el, order } = await open({
      getPartyBills: vi.fn().mockResolvedValue(partPaid()),
      getBillBalance,
      moveDishes: vi.fn().mockRejectedValue({ code: "bill.line_paid", status: 409 }),
    });
    const menu = () => order.shadowRoot!.querySelector<HTMLElement>("[data-table-menu]")!;
    const picker = () => order.shadowRoot!.querySelector<TillPortionPicker>("till-portion-picker");
    await userEvent.click(menu());
    await userEvent.click(menu().querySelector<HTMLElement>('[data-action="move-dishes"]')!);
    await order.updateComplete;
    await picker()!.updateComplete;
    picker()!.shadowRoot!.querySelector<HTMLElement>('[data-pick="line-1"]')!.click();
    await order.updateComplete;
    order.shadowRoot!.querySelector<HTMLElement>('[data-move-dishes-to="new"]')!.click();
    await order.updateComplete;
    order
      .shadowRoot!.querySelector("[data-move-dishes-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await flush(el, 6);

    expect(api.moveDishes).toHaveBeenCalledWith("wo-4", ["line-1"], null, expect.any(Object));
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(order.shadowRoot!.querySelector("[data-move-dishes]")).toBeNull();

    await userEvent.click(menu());
    await userEvent.click(menu().querySelector<HTMLElement>('[data-action="move-dishes"]')!);
    await order.updateComplete;
    await picker()!.updateComplete;
    expect(picker()!.picks).toEqual(new Set());
    expect(picker()!.rows[0]!.blocked).toEqual({ reason: "paid" });
  });

  it("a reply after the waiter switched bills does not change the screen", async () => {
    let answer!: (value: { billId: string }) => void;
    const { el, order } = await open({
      getPartyBills: vi.fn().mockResolvedValue([...twoBills(), bill("wo-new", 3)]),
      moveDishes: vi.fn(
        () =>
          new Promise<{ billId: string }>((resolve) => {
            answer = resolve;
          }),
      ),
    });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await flush(el);
    emit(tableOrder(el)!, "switch-bill", { workingOrderId: "bill-1" });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("bill-1");

    answer({ billId: "wo-new" });
    await flush(el, 6);

    expect(tableOrder(el)!.orderId).toBe("bill-1");
  });

  it("the request after a refused one carries the re-read revisions", async () => {
    const getTablesState = vi
      .fn()
      .mockResolvedValueOnce([table("t4", "4", seated), table7])
      .mockResolvedValue([table("t4", "4", party({ billCount: 2, revision: 4 })), table7]);
    const moveDishes = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 4 })
      .mockResolvedValue({ billId: "bill-1" });
    const { el, order } = await open({ getTablesState, moveDishes });

    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
    await flush(el, 6);
    emit(tableOrder(el)!, "move-dishes", { lineIds: ["line-1"], toBillId: "bill-1" });
    await flush(el, 6);

    expect(moveDishes).toHaveBeenCalledTimes(2);
    expect(moveDishes.mock.calls[0]![3]).toMatchObject({ expectedPartyRevision: 3 });
    expect(moveDishes.mock.calls[1]![3]).toMatchObject({ expectedPartyRevision: 4 });
  });
});
