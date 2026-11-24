import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillApi } from "../api/client.js";
import type {
  RefundableTender,
  TenderRefundRequest,
  TenderRefundView,
} from "../api/tender-refund-types.js";
import type { InvoiceCorrectionView } from "../api/invoice-correction-types.js";
import { InvoiceCorrectionSession } from "../state/invoice-correction.js";
import { TenderRefundSession } from "../state/tender-refund.js";
import { TABLE_REQUEST_LIMIT_MS } from "../state/draft-sync.js";
import "./give-back-under-way.js";
import type { TillGiveBackUnderWay } from "./give-back-under-way.js";

const OPEN: InvoiceCorrectionView = {
  id: "correction-1",
  saleId: "sale-1",
  state: "open",
  gross: "6.05",
  moneyBack: "0.00",
  pending: "0.00",
  left: "6.05",
  reason: "Overcharged",
  openedAt: "2026-11-13T10:00:00.000Z",
  correctiveSaleId: null,
  legs: [],
  fileNow: null,
};
const SPLIT = [{ rate: "21.00", base: "1.65", tax: "0.35" }];
const CASH_ROW: RefundableTender = {
  tenderId: "cash-1",
  method: "cash",
  last4: null,
  appliedRemaining: "13.10",
  tipRemaining: "0.00",
  pendingRefundId: null,
  manual: false,
};
const CARD_ROW: RefundableTender = {
  tenderId: "card-1",
  method: "card",
  last4: "0042",
  appliedRemaining: "10.00",
  tipRemaining: "0.00",
  pendingRefundId: null,
  manual: false,
};
const TENDERS = [CASH_ROW, CARD_ROW];
const SCOPE = { deviceId: "device-1", personId: "staff-1" };
const EVERY_METHOD = ["take-cash", "integrated-card-payment", "hand-keyed-card-payment"];
const MANAGER = { personId: "manager", pin: "0123" };
const refused = (code: string, params: Record<string, unknown> = {}) => ({
  ...params,
  code,
  status: 409,
});
const lost = () => new TypeError("Failed to fetch");
const refundOf = (
  saleId: string,
  request: TenderRefundRequest,
  state: TenderRefundView["state"] = "completed",
): TenderRefundView => ({
  id: "refund-1",
  saleId,
  tenderId: request.tenderId,
  state,
  appliedAmount: request.appliedAmount,
  tipAmount: request.tipAmount,
  createdAt: "2026-11-13T10:00:00.000Z",
  completedAt: null,
});

function fakeApi() {
  return {
    getInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => OPEN),
    getRefundableTenders: vi.fn(async (): Promise<RefundableTender[]> => TENDERS),
    fileInvoiceCorrection: vi.fn<TillApi["fileInvoiceCorrection"]>(async () => ({
      ...OPEN,
      state: "filed",
    })),
    closeInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => ({
      ...OPEN,
      state: "discarded",
    })),
    listApprovers: vi.fn<TillApi["listApprovers"]>(async () => [
      { personId: "manager", displayName: "Marta" },
    ]),
    openInvoiceCorrection: vi.fn(),
    giveInvoiceCorrectionCash: vi.fn(async (_id: string, request: { amount: string }) => ({
      correction: { ...OPEN, state: "filed" as const, moneyBack: request.amount, left: "0.00" },
      refunds: [],
      replayed: false,
    })),
    refundTransaction: vi.fn(async (saleId: string, request: TenderRefundRequest) =>
      refundOf(saleId, request),
    ),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn(),
  };
}
type Api = ReturnType<typeof fakeApi>;

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
  localStorage.clear();
});

async function mount(
  correction: InvoiceCorrectionView = OPEN,
  api: Api = fakeApi(),
  capabilities = EVERY_METHOD,
  refunds = new TenderRefundSession(SCOPE, api),
) {
  const close = vi.fn();
  const { el } = await mountWidget<TillGiveBackUnderWay>("till-give-back-under-way", {
    api,
    saleId: "sale-1",
    correction,
    corrections: new InvoiceCorrectionSession(SCOPE, api),
    refunds,
    capabilities,
    close,
  });
  await vi.waitFor(() => expect(api.getRefundableTenders).toHaveBeenCalled());
  await vi.waitFor(() => expect(root(el).querySelector("[data-choice=check]")).not.toBeNull());
  await el.updateComplete;
  return { el, api, close };
}
const root = (el: TillGiveBackUnderWay) => el.shadowRoot!;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const press = (el: TillGiveBackUnderWay, name: string) =>
  root(el).querySelector<HTMLElement>(`[data-choice=${name}]`)!.click();
const shown = (el: TillGiveBackUnderWay, name: string) =>
  root(el).querySelector(`[data-choice=${name}]`) !== null;
const hint = (el: TillGiveBackUnderWay, name: string) =>
  text(root(el).querySelector(`[data-hint=${name}]`));
/** No step is being sent: the view's buttons are enabled again. */
const idle = (el: TillGiveBackUnderWay) =>
  !root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-choice=check]")!.disabled;
const bottom = (el: TillGiveBackUnderWay) => root(el).querySelector("wt-form-actions")!.error;
const outcome = (el: TillGiveBackUnderWay) => text(root(el).querySelector("[data-outcome]"));
const pinDialog = async (el: TillGiveBackUnderWay) => {
  await vi.waitFor(() =>
    expect(root(el).querySelector("till-supervisor-override-dialog")).not.toBeNull(),
  );
  return root(el).querySelector("till-supervisor-override-dialog")!;
};
const signIn = (pin: Element) =>
  pin.dispatchEvent(new CustomEvent("override-confirm", { detail: MANAGER }));
const marked = (el: TillGiveBackUnderWay) =>
  [
    ...root(el).querySelectorAll<HTMLElement>(
      "[data-back], [data-left], [data-choice=cash], [data-choice=card]",
    ),
  ].map((node) => node.dataset.choice ?? Object.keys(node.dataset)[0]);
/** The focused element, looked for through every shadow root on the way down. */
function focused(): Element | null {
  let found = document.activeElement;
  while (found?.shadowRoot?.activeElement) found = found.shadowRoot.activeElement;
  return found;
}
const FILING = {
  ...OPEN,
  moneyBack: "2.00",
  left: "4.05",
  fileNow: { gross: "2.00", vatBreakdown: SPLIT },
};

describe("what is back and what is left", () => {
  it("shows the money back so far, what is left, then cash, then each card", async () => {
    const { el, api } = await mount();

    expect(marked(el)).toEqual(["back", "left", "cash", "card"]);
    expect(text(root(el).querySelector("[data-back]"))).toBe(
      t("give_back.uw_back").replace("{back}", "€0.00").replace("{gross}", "€6.05"),
    );
    expect(text(root(el).querySelector("[data-left]"))).toBe(
      t("give_back.uw_left").replace("{amount}", "€6.05"),
    );
    expect(text(root(el).querySelector("[data-choice=cash]"))).toBe(
      t("give_back.uw_cash").replace("{amount}", "€6.05"),
    );
    expect(text(root(el).querySelector("[data-choice=card]"))).toBe(
      t("give_back.uw_card").replace("{amount}", "€6.05").replace("{card}", "···0042"),
    );
    expect(hint(el, "card")).toBe(t("give_back.uw_card_hint"));
    expect(api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("opens with focus on its first choice", async () => {
    const { el } = await mount();
    const check = root(el).querySelector<HTMLElement>("[data-choice=check]")!;
    await vi.waitFor(() => expect(check.shadowRoot!.contains(focused())).toBe(true));
  });

  it("says what waits for the card company", async () => {
    const { el } = await mount({ ...OPEN, pending: "2.00", left: "4.05" });
    expect(text(root(el).querySelector("[data-pending]"))).toBe(
      t("give_back.pending").replace("{amount}", "€2.00"),
    );
  });

  it("reads the correction and payments again on Check again, showing what is back now", async () => {
    const { el, api } = await mount();
    const reads = api.getRefundableTenders.mock.calls.length;
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "2.00", left: "4.05" });

    press(el, "check");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-left]"))).toBe(
        t("give_back.uw_left").replace("{amount}", "€4.05"),
      ),
    );
    expect(api.getInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
    expect(api.getRefundableTenders).toHaveBeenCalledTimes(reads + 1);
  });

  it("offers only the payments this device may give back to", async () => {
    const { el } = await mount(OPEN, fakeApi(), ["take-cash"]);
    expect(shown(el, "cash")).toBe(true);
    expect(shown(el, "card")).toBe(false);

    el.capabilities = ["integrated-card-payment"];
    await el.updateComplete;
    expect(shown(el, "cash")).toBe(false);
    expect(text(root(el).querySelector("[data-no-cash]"))).toBe(t("give_back.uw_no_cash"));
    expect(shown(el, "card")).toBe(true);
  });
});

describe("ending it", () => {
  it("Stop here files what is back while money is left", async () => {
    const api = fakeApi();
    api.fileInvoiceCorrection.mockResolvedValue({ ...OPEN, state: "filed", moneyBack: "2.00" });
    const { el } = await mount(FILING, api);

    expect(shown(el, "finish")).toBe(false);
    expect(shown(el, "cancel")).toBe(false);
    expect(text(root(el).querySelector("[data-choice=stop]"))).toBe(t("give_back.uw_stop"));
    expect(hint(el, "stop")).toBe(t("give_back.uw_stop_hint").replace("{amount}", "€2.00"));

    press(el, "stop");
    await vi.waitFor(() =>
      expect(outcome(el)).toBe(t("give_back.uw_finished").replace("{amount}", "€2.00")),
    );
    expect(api.fileInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {
      expectedSplit: SPLIT,
    });
    expect(api.closeInvoiceCorrection).not.toHaveBeenCalled();
  });

  it("Finish files a correction whose money is all back, offering no more cash or card", async () => {
    const api = fakeApi();
    api.fileInvoiceCorrection.mockResolvedValue({ ...OPEN, state: "filed", moneyBack: "6.05" });
    const { el, close } = await mount(
      { ...OPEN, moneyBack: "6.05", left: "0.00", fileNow: { gross: "6.05", vatBreakdown: SPLIT } },
      api,
    );

    expect(text(root(el).querySelector("[data-choice=finish]"))).toBe(t("give_back.uw_finish"));
    expect(hint(el, "finish")).toBe(t("give_back.uw_finish_hint").replace("{amount}", "€6.05"));
    expect(shown(el, "stop")).toBe(false);
    expect(shown(el, "cash")).toBe(false);
    expect(shown(el, "card")).toBe(false);

    press(el, "finish");
    await vi.waitFor(() => expect(api.fileInvoiceCorrection).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(root(el).querySelector("[data-done]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-done]")!.click();
    expect(close).toHaveBeenCalledOnce();
  });

  it("Finish closes keeping what is back only when filing can never happen", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue({
      ...OPEN,
      moneyBack: "2.00",
      fileNow: { refusal: "sale.correction_not_admitted", reason: "wrong_node", closable: true },
    });
    api.closeInvoiceCorrection.mockResolvedValue({ ...OPEN, state: "closed", moneyBack: "2.00" });
    const { el } = await mount(
      {
        ...OPEN,
        moneyBack: "2.00",
        fileNow: { refusal: "invoice_correction.chain_unsound", closable: false },
      },
      api,
    );

    expect(text(root(el).querySelector("[data-file-refusal]"))).toBe(
      codeMessage("invoice_correction.chain_unsound"),
    );
    expect(shown(el, "finish")).toBe(false);
    expect(shown(el, "stop")).toBe(false);

    press(el, "check");
    await vi.waitFor(() => expect(shown(el, "finish")).toBe(true));
    const said = text(root(el).querySelector("[data-file-refusal]"));
    expect(said).toBe(codeMessage("sale.correction_not_admitted", "en", { reason: "wrong_node" }));
    expect(said).not.toContain("Refund a payment");
    press(el, "finish");
    await vi.waitFor(() =>
      expect(outcome(el)).toBe(t("give_back.uw_finished").replace("{amount}", "€2.00")),
    );
    expect(api.closeInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
    expect(api.fileInvoiceCorrection).not.toHaveBeenCalled();
  });

  it("Cancel this money back is offered only with nothing back or waiting, and closes it", async () => {
    const { el, api } = await mount();
    expect(text(root(el).querySelector("[data-choice=cancel]"))).toBe(t("give_back.uw_cancel"));
    expect(hint(el, "cancel")).toBe(t("give_back.uw_cancel_hint"));

    press(el, "cancel");
    await vi.waitFor(() => expect(outcome(el)).toBe(t("give_back.uw_cancelled")));
    expect(api.closeInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});

    const waiting = await mount({ ...OPEN, pending: "1.00", left: "5.05" });
    expect(shown(waiting.el, "cancel")).toBe(false);
  });

  it("reads the correction again when its split changed, saying so", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue({ ...FILING, moneyBack: "3.00", left: "3.05" });
    api.fileInvoiceCorrection.mockRejectedValueOnce(refused("invoice_correction.split_changed"));
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-back]"))).toContain("€3.00"));
    expect(bottom(el)).toBe(codeMessage("invoice_correction.split_changed"));
  });

  it("says a lost filing answer needs checking, not that the same request goes again", async () => {
    const api = fakeApi();
    api.fileInvoiceCorrection.mockRejectedValueOnce(lost());
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown_end")));
    expect(shown(el, "check")).toBe(true);
  });

  it("never tells staff to give money back again when filing is refused", async () => {
    const api = fakeApi();
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("sale.correction_not_admitted", { reason: "missing" }),
    );
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(
        codeMessage("sale.correction_not_admitted", "en", { reason: "missing" }),
      ),
    );
    expect(bottom(el)).not.toContain("Refund a payment");
  });

  it("asks for an approver when filing needs one, and says when they cannot be read", async () => {
    const api = fakeApi();
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.rectify" }),
    );
    api.listApprovers.mockRejectedValueOnce(lost());
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_approvers_failed")));
    expect(api.listApprovers).toHaveBeenCalledExactlyOnceWith("sale.rectify", {
      signal: expect.any(AbortSignal),
    });
    expect(root(el).querySelector("till-supervisor-override-dialog")).toBeNull();
  });

  it("after a PIN, a lost filing answer still says to check", async () => {
    const api = fakeApi();
    api.fileInvoiceCorrection
      .mockRejectedValueOnce(refused("authorization.not_permitted", { permission: "sale.rectify" }))
      .mockRejectedValueOnce(lost());
    const { el } = await mount(FILING, api);

    press(el, "stop");
    signIn(await pinDialog(el));
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown_end")));
    expect(api.fileInvoiceCorrection.mock.calls[1]![1]).toEqual({
      expectedSplit: SPLIT,
      override: MANAGER,
    });
  });
});

describe("cash", () => {
  it("gives the cash left back and says to hand it over", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockResolvedValueOnce({
      correction: {
        ...OPEN,
        moneyBack: "6.05",
        left: "0.00",
        fileNow: { gross: "6.05", vatBreakdown: SPLIT },
      },
      refunds: [],
      replayed: false,
    } as never);
    const { el } = await mount(OPEN, api);

    expect(hint(el, "cash")).toBe(t("give_back.uw_cash_hint"));
    press(el, "cash");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-cash-given]"))).toBe(
        t("give_back.uw_cash_given").replace("{amount}", "€6.05"),
      ),
    );
    expect(api.giveInvoiceCorrectionCash.mock.calls[0]![1]).toEqual({
      submissionId: expect.any(String),
      amount: "6.05",
    });
    expect(shown(el, "finish")).toBe(true);
  });

  it("after a cash answer is lost, gives that same amount again even when less is left", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(lost());
    const { el } = await mount(OPEN, api);

    press(el, "cash");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown")));
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "2.00", left: "4.05" });
    press(el, "check");
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-left]"))).toContain("€4.05"));
    expect(text(root(el).querySelector("[data-choice=cash]"))).toBe(
      t("give_back.uw_cash").replace("{amount}", "€6.05"),
    );
    press(el, "cash");
    await vi.waitFor(() => expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(2));
    const [first, second] = api.giveInvoiceCorrectionCash.mock.calls.map((call) => call[1]);
    expect(second).toEqual(first);
  });

  it("asks for the PIN of someone who may give money back when the cash is refused for permission", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    const { el } = await mount(OPEN, api);

    press(el, "cash");
    const pin = await pinDialog(el);
    expect(api.listApprovers).toHaveBeenCalledExactlyOnceWith("sale.refund", {
      signal: expect.any(AbortSignal),
    });
    signIn(pin);
    await vi.waitFor(() => expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(2));
    expect(api.giveInvoiceCorrectionCash.mock.calls[1]![1]).toEqual({
      submissionId: expect.any(String),
      amount: "6.05",
      override: MANAGER,
    });
  });

  it("shows a wrong PIN in place and drops the sign-in when it is cancelled", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash
      .mockRejectedValueOnce(refused("authorization.not_permitted", { permission: "sale.refund" }))
      .mockRejectedValueOnce({ code: "pin.invalid", status: 401 });
    const { el } = await mount(OPEN, api);

    press(el, "cash");
    const pin = await pinDialog(el);
    signIn(pin);
    await vi.waitFor(() => expect(pin.error?.code).toBe("pin.invalid"));
    pin.dispatchEvent(new CustomEvent("override-cancel"));
    await el.updateComplete;
    expect(root(el).querySelector("till-supervisor-override-dialog")).toBeNull();
    expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(2);
  });
});

describe("a card", () => {
  it("sends the card's part from this window and reads the correction again", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "6.05", left: "0.00" });
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledOnce());
    expect(api.refundTransaction.mock.calls[0]).toEqual([
      "sale-1",
      {
        submissionId: expect.any(String),
        tenderId: "card-1",
        appliedAmount: "6.05",
        tipAmount: "0.00",
        reason: "Overcharged",
        manualConfirmed: false,
        invoiceCorrectionId: "correction-1",
      },
    ]);
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-left]"))).toContain("€0.00"));
    expect(bottom(el)).toBe("");
  });

  it("says the card company has not answered when the card's refund is pending", async () => {
    const api = fakeApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, pending: "6.05", left: "0.00" });
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-pending]"))).toBe(
        t("give_back.pending").replace("{amount}", "€6.05"),
      ),
    );
    expect(shown(el, "cancel")).toBe(false);
  });

  it("says a failed card refund gave nothing back", async () => {
    const api = fakeApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "failed"),
    );
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_card_failed")));
  });

  it("sends nothing when the card's payment changed since it was shown", async () => {
    const api = fakeApi();
    const { el } = await mount(OPEN, api);
    api.getRefundableTenders.mockResolvedValue([
      CASH_ROW,
      { ...CARD_ROW, pendingRefundId: "refund-9" },
    ]);

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_card_changed")));
    expect(api.refundTransaction).not.toHaveBeenCalled();
    expect(shown(el, "card")).toBe(false);
  });

  it("sends nothing when the card's payment cannot be read again", async () => {
    const api = fakeApi();
    const { el } = await mount(OPEN, api);
    api.getRefundableTenders.mockRejectedValue(lost());

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_card_unread")));
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("shows the box's refusal of the card's part", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(refused("invoice_correction.money_short"));
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(codeMessage("invoice_correction.money_short")));
  });

  it("offers Send again after a card answer is lost, sending the same request", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).not.toBeNull());
    expect(text(root(el).querySelector("[data-lost]"))).toBe(t("give_back.lost"));
    expect(shown(el, "card")).toBe(false);
    expect(shown(el, "cancel")).toBe(false);

    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledTimes(2));
    const [first, second] = api.refundTransaction.mock.calls.map((call) => call[1]);
    expect(second).toEqual(first);
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).toBeNull());
  });

  it("takes a hand-keyed card through the terminal step and an approver's PIN", async () => {
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue([CASH_ROW, { ...CARD_ROW, manual: true }]);
    const { el } = await mount(OPEN, api);
    expect(hint(el, "card")).toBe(t("give_back.uw_terminal_hint"));

    press(el, "card");
    await vi.waitFor(() => expect(root(el).querySelector("[data-terminal]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-record]")!.click();
    await el.updateComplete;
    expect(root(el).querySelector("[data-terminal-error]")).not.toBeNull();
    expect(api.listApprovers).not.toHaveBeenCalled();

    root(el)
      .querySelector("wt-switch[name=terminal-done]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("[data-record]")!.click();
    const pin = await pinDialog(el);
    expect(api.listApprovers).toHaveBeenCalledExactlyOnceWith("sale.refund", {
      signal: expect.any(AbortSignal),
    });
    expect(api.refundTransaction).not.toHaveBeenCalled();
    signIn(pin);
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledOnce());
    expect(api.refundTransaction.mock.calls[0]![1]).toMatchObject({
      tenderId: "card-1",
      appliedAmount: "6.05",
      manualConfirmed: true,
      invoiceCorrectionId: "correction-1",
      override: MANAGER,
    });
    await vi.waitFor(() => expect(root(el).querySelector("[data-terminal]")).toBeNull());
  });

  it("goes back from the terminal step sending nothing", async () => {
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue([CASH_ROW, { ...CARD_ROW, manual: true }]);
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(root(el).querySelector("[data-terminal]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-terminal-back]")!.click();
    await el.updateComplete;
    expect(shown(el, "card")).toBe(true);
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });
});

describe("one step at a time, and what the till saved", () => {
  it("settles a card refund waiting for the card company before reading again on Check again", async () => {
    const api = fakeApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    const { el } = await mount(OPEN, api);
    press(el, "card");
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    api.getTenderRefund.mockImplementation(async () =>
      refundOf("sale-1", api.refundTransaction.mock.calls[0]![1]),
    );
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "6.05", left: "0.00" });

    press(el, "check");
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-left]"))).toContain("€0.00"));
    expect(api.getTenderRefund).toHaveBeenCalledExactlyOnceWith("refund-1");
    expect(new TenderRefundSession(SCOPE, api).read("sale-1")).toBeNull();
  });

  it("sends one press at a time", async () => {
    const api = fakeApi();
    let answer!: (value: unknown) => void;
    api.giveInvoiceCorrectionCash.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    const { el } = await mount(OPEN, api);

    press(el, "cash");
    press(el, "cash");
    press(el, "card");
    answer({
      correction: { ...OPEN, moneyBack: "6.05", left: "0.00" },
      refunds: [],
      replayed: false,
    });
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledOnce();
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("sends Send again once however often it is pressed", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    const { el } = await mount(OPEN, api);
    press(el, "card");
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).not.toBeNull());

    const again = root(el).querySelector<HTMLElement>("[data-send-again]")!;
    again.click();
    again.click();
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).toBeNull());
    expect(api.refundTransaction).toHaveBeenCalledTimes(2);
  });

  it("opens on Send again when a card part's answer was lost on an earlier visit", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    const first = await mount(OPEN, api);
    press(first.el, "card");
    await vi.waitFor(() =>
      expect(root(first.el).querySelector("[data-send-again]")).not.toBeNull(),
    );
    first.el.remove();

    const { el } = await mount(OPEN, api);
    expect(root(el).querySelector("[data-send-again]")).not.toBeNull();
    expect(shown(el, "card")).toBe(false);
  });

  it("sends nothing when this device cannot save the card's part", async () => {
    localStorage.setItem(
      `waitron.tender-refund:${JSON.stringify(["device-1", "staff-1"])}:${JSON.stringify("sale-1")}`,
      "{not json",
    );
    const { el, api } = await mount();

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.storage")));
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("sends no new card part while an earlier one on the receipt waits for an answer", async () => {
    const api = fakeApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    await new TenderRefundSession(SCOPE, api).submit("sale-1", {
      tenderId: "card-1",
      appliedAmount: "1.00",
      tipAmount: "0.00",
      reason: "Overcharged",
    });
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_card_waiting")));
    expect(api.refundTransaction).toHaveBeenCalledOnce();
    expect(root(el).querySelector("[data-send-again]")).toBeNull();
  });

  it("names a card with no last digits, giving back no more than the card holds", async () => {
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue([
      { ...CARD_ROW, last4: null, appliedRemaining: "3.00" },
    ]);
    const { el } = await mount(OPEN, api);

    expect(text(root(el).querySelector("[data-choice=card]"))).toBe(
      t("give_back.uw_card_any").replace("{amount}", "€3.00"),
    );
    press(el, "card");
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledOnce());
    expect(api.refundTransaction.mock.calls[0]![1].appliedAmount).toBe("3.00");
  });

  it("keeps quiet when what is back cannot be read after the card's part went", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockRejectedValue(lost());
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(bottom(el)).toBe("");
  });

  it("keeps the sign-in open when it is cancelled or signed again while its PIN is checked", async () => {
    const api = fakeApi();
    let answer!: (error: unknown) => void;
    api.giveInvoiceCorrectionCash
      .mockRejectedValueOnce(refused("authorization.not_permitted", { permission: "sale.refund" }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (answer = reject)));
    const { el } = await mount(OPEN, api);

    press(el, "cash");
    const pin = await pinDialog(el);
    signIn(pin);
    await vi.waitFor(() => expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(2));
    signIn(pin);
    pin.dispatchEvent(new CustomEvent("override-cancel"));
    answer({ code: "pin.invalid", status: 401 });

    await vi.waitFor(() => expect(pin.error?.code).toBe("pin.invalid"));
    expect(root(el).querySelector("till-supervisor-override-dialog")).toBe(pin);
    expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(2);
  });
});

const HAND_KEYED = [CASH_ROW, { ...CARD_ROW, manual: true }];
/** Presses the hand-keyed card, says the terminal's refund is done and presses Record. */
async function recordOnTerminal(el: TillGiveBackUnderWay) {
  press(el, "card");
  await vi.waitFor(() => expect(root(el).querySelector("[data-terminal]")).not.toBeNull());
  root(el)
    .querySelector("wt-switch[name=terminal-done]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  await el.updateComplete;
  root(el).querySelector<HTMLElement>("[data-record]")!.click();
}
const JOURNAL_KEY = `waitron.tender-refund:${JSON.stringify(["device-1", "staff-1"])}:${JSON.stringify("sale-1")}`;

describe("a hand-keyed card's refusal is shown", () => {
  it("shows the box's refusal after the PIN, leaving the terminal step", async () => {
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue(HAND_KEYED);
    api.refundTransaction.mockRejectedValueOnce(refused("invoice_correction.leg_too_large"));
    const { el } = await mount(OPEN, api);

    await recordOnTerminal(el);
    signIn(await pinDialog(el));
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(codeMessage("invoice_correction.leg_too_large")),
    );
    expect(root(el).querySelector("[data-terminal]")).toBeNull();
  });

  it("says the approvers could not be read, leaving the terminal step", async () => {
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue(HAND_KEYED);
    api.listApprovers.mockRejectedValueOnce(lost());
    const { el } = await mount(OPEN, api);

    await recordOnTerminal(el);
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_approvers_failed")));
    expect(root(el).querySelector("[data-terminal]")).toBeNull();
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("says this device could not save the card's part, leaving the terminal step", async () => {
    localStorage.setItem(JOURNAL_KEY, "{not json");
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue(HAND_KEYED);
    const { el } = await mount(OPEN, api);

    await recordOnTerminal(el);
    signIn(await pinDialog(el));
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.storage")));
    expect(root(el).querySelector("[data-terminal]")).toBeNull();
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("keeps the terminal step under a wrong PIN, which shows in the sign-in", async () => {
    const api = fakeApi();
    api.getRefundableTenders.mockResolvedValue(HAND_KEYED);
    api.refundTransaction.mockRejectedValueOnce({ code: "pin.invalid", status: 401 });
    const { el } = await mount(OPEN, api);

    await recordOnTerminal(el);
    const pin = await pinDialog(el);
    signIn(pin);
    await vi.waitFor(() => expect(pin.error?.code).toBe("pin.invalid"));
    expect(root(el).querySelector("[data-terminal]")).not.toBeNull();
  });
});

describe("only a card's part with no answer counts as lost", () => {
  it("does not call a card refused for a right lost once the sign-in is cancelled", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    const first = await mount(OPEN, api);
    press(first.el, "card");
    const pin = await pinDialog(first.el);
    pin.dispatchEvent(new CustomEvent("override-cancel"));
    await first.el.updateComplete;
    expect(root(first.el).querySelector("[data-lost]")).toBeNull();
    first.el.remove();

    const { el } = await mount(OPEN, api);
    expect(root(el).querySelector("[data-lost]")).toBeNull();
    expect(shown(el, "card")).toBe(true);
    expect(shown(el, "cancel")).toBe(true);
  });

  it("does not call a card refused for a right lost when the window closes during the sign-in", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    const first = await mount(OPEN, api);
    press(first.el, "card");
    await pinDialog(first.el);
    first.el.remove();

    const { el } = await mount(OPEN, api);
    expect(root(el).querySelector("[data-lost]")).toBeNull();
    expect(shown(el, "card")).toBe(true);
  });

  it("does not call a card refused because another refund waits on it lost", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(
      refused("tender.refund_in_progress", { tenderId: "card-1" }),
    );
    const first = await mount(OPEN, api);
    press(first.el, "card");
    await vi.waitFor(() => expect(bottom(first.el)).toBe(codeMessage("tender.refund_in_progress")));
    first.el.remove();

    const { el } = await mount(OPEN, api);
    expect(root(el).querySelector("[data-lost]")).toBeNull();
    expect(shown(el, "card")).toBe(true);
    expect(shown(el, "cancel")).toBe(true);
  });

  it("leaves out a card refund saved for something other than this correction", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    await new TenderRefundSession(SCOPE, api)
      .submit("sale-1", {
        tenderId: "card-1",
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Overcharged",
      })
      .catch(() => {});
    const { el } = await mount(OPEN, api);

    expect(root(el).querySelector("[data-lost]")).toBeNull();
    expect(root(el).querySelector("[data-send-again]")).toBeNull();
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "1.00", left: "5.05" });
    press(el, "check");
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-left]"))).toContain("€5.05"));
    expect(api.refundTransaction).toHaveBeenCalledOnce();
    expect(root(el).querySelector("[data-send-again]")).toBeNull();
  });

  it("says to finish a card refund with no answer from Refund a payment, which Check again here does not ask about", async () => {
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    await new TenderRefundSession(SCOPE, api)
      .submit("sale-1", {
        tenderId: "card-1",
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Overcharged",
      })
      .catch(() => {});
    const { el } = await mount(OPEN, api);

    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_card_elsewhere")));
    expect(api.refundTransaction).toHaveBeenCalledOnce();
    expect(root(el).querySelector("[data-send-again]")).toBeNull();
  });

  it("keeps a refused card refund Refund a payment saved when this window closes", async () => {
    const api = fakeApi();
    const refunds = new TenderRefundSession(SCOPE, api);
    api.refundTransaction.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    await refunds
      .submit("sale-1", {
        tenderId: "card-1",
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Overcharged",
      })
      .catch(() => {});
    expect(refunds.read("sale-1")).not.toBeNull();
    const { el } = await mount(OPEN, api, EVERY_METHOD, refunds);

    el.remove();

    expect(refunds.read("sale-1")?.request.appliedAmount).toBe("1.00");
  });

  it("words a card answer that does not match what was sent as an unknown answer", async () => {
    const api = fakeApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    const { el } = await mount(OPEN, api);
    press(el, "card");
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    api.getTenderRefund.mockImplementation(async () => ({
      ...refundOf("sale-1", api.refundTransaction.mock.calls[0]![1]),
      tenderId: "card-9",
    }));

    press(el, "check");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown")));
  });

  it("hides Cancel this money back while a cash answer is unknown", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(lost());
    const { el } = await mount(OPEN, api);
    expect(shown(el, "cancel")).toBe(true);

    press(el, "cash");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown")));
    expect(shown(el, "cancel")).toBe(false);
  });
});

describe("what still works when a read fails", () => {
  it("keeps offering the card when the payments cannot be read again after some cash is given", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockResolvedValueOnce({
      correction: { ...OPEN, moneyBack: "3.00", left: "3.05" },
      refunds: [],
      replayed: false,
    } as never);
    const { el } = await mount(OPEN, api);
    api.getRefundableTenders.mockRejectedValue(lost());
    const reads = api.getRefundableTenders.mock.calls.length;

    press(el, "cash");
    await vi.waitFor(() => expect(api.getRefundableTenders).toHaveBeenCalledTimes(reads + 1));
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-cash-given]"))).toBe(
        t("give_back.uw_cash_given").replace("{amount}", "€6.05"),
      ),
    );
    expect(text(root(el).querySelector("[data-choice=card]"))).toBe(
      t("give_back.uw_card").replace("{amount}", "€3.05").replace("{card}", "···0042"),
    );
    expect(bottom(el)).toBe("");
  });

  it("offers the cash still left when the saved cash request cannot be read", async () => {
    const other = new InvoiceCorrectionSession(SCOPE, {
      openInvoiceCorrection: () => Promise.reject(lost()),
      giveInvoiceCorrectionCash: () => Promise.reject(lost()),
    });
    await other.giveCash("correction-1", { amount: "2.00" }).catch(() => {});
    const cashOffered = (el: TillGiveBackUnderWay) =>
      text(root(el).querySelector("[data-choice=cash]"));
    const saved = await mount();
    expect(cashOffered(saved.el)).toBe(t("give_back.uw_cash").replace("{amount}", "€2.00"));
    saved.el.remove();

    const key = Object.keys(localStorage).find((k) => k.includes("invoice-correction-cash"))!;
    localStorage.setItem(key, "{not json");
    const { el } = await mount();

    expect(cashOffered(el)).toBe(t("give_back.uw_cash").replace("{amount}", "€6.05"));
  });

  it("shows why the people who may sign in could not be read, offering no sign-in", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    api.listApprovers.mockRejectedValueOnce(refused("sale.correction_unsupported"));
    const { el } = await mount(OPEN, api);

    press(el, "cash");
    await vi.waitFor(() => expect(bottom(el)).toBe(codeMessage("sale.correction_unsupported")));
    expect(root(el).querySelector("till-supervisor-override-dialog")).toBeNull();
  });

  it("gives up reading the people who may sign in at the time limit, offering no sign-in", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    api.listApprovers.mockImplementationOnce(
      (_permission, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const { el } = await mount(OPEN, api);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      press(el, "cash");
      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1);
      await el.updateComplete;
      expect(api.listApprovers).toHaveBeenCalledOnce();
      expect(idle(el)).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await el.updateComplete;

      expect(idle(el)).toBe(true);
      expect(bottom(el)).toBe(t("give_back.uw_approvers_failed"));
      expect(root(el).querySelector("till-supervisor-override-dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

it("closing ends nothing by itself", async () => {
  const { el, api, close } = await mount();
  root(el).querySelector<HTMLElement>("[data-close]")!.click();
  expect(close).toHaveBeenCalledOnce();
  expect(api.closeInvoiceCorrection).not.toHaveBeenCalled();
  expect(api.fileInvoiceCorrection).not.toHaveBeenCalled();
});

it("words its steps in Spanish from the Spanish strings", async () => {
  setLocale("es-ES");
  const filing = await mount(FILING);
  expect(text(root(filing.el).querySelector("[data-choice=stop]"))).toBe(es["give_back.uw_stop"]);
  const fresh = await mount();
  expect(text(root(fresh.el).querySelector("[data-choice=cancel]"))).toBe(
    es["give_back.uw_cancel"],
  );
  expect(text(root(fresh.el).querySelector("[data-choice=card]"))).toBe(
    es["give_back.uw_card"]
      .replace("{amount}", formatMoney("6.05", currentLocale()))
      .replace("{card}", "···0042")
      .replace(/\s+/g, " "),
  );
});
