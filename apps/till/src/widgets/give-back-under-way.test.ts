import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { deferred } from "../../test/clock-app.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { codeMessage, giveBackFilingMessage } from "../i18n/codes.js";
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
    giveInvoiceCorrectionCash: vi.fn(async (_id: string, request: { amount: string }) => ({
      correction: { ...OPEN, state: "filed" as const, moneyBack: request.amount, left: "0.00" },
      refunds: [],
      replayed: false,
    })),
    refundTransaction: vi.fn(async (saleId: string, request: TenderRefundRequest) =>
      refundOf(saleId, request),
    ),
    getTenderRefund: vi.fn(),
    retryTenderRefund: vi.fn<TillApi["retryTenderRefund"]>(),
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
      fileNow: { refusal: "sale.correction_not_admitted", reason: "voided", closable: true },
    });
    api.closeInvoiceCorrection.mockResolvedValue({ ...OPEN, state: "closed", moneyBack: "2.00" });
    const { el } = await mount(
      {
        ...OPEN,
        moneyBack: "2.00",
        fileNow: { refusal: "sale.correction_not_admitted", reason: "missing", closable: false },
      },
      api,
    );

    expect(text(root(el).querySelector("[data-file-refusal]"))).toBe(
      "The refund cannot be recorded on this receipt now, so Finish is not offered. Press Check again to see whether that has changed.",
    );
    expect(shown(el, "finish")).toBe(false);
    expect(shown(el, "stop")).toBe(false);

    press(el, "check");
    await vi.waitFor(() => expect(shown(el, "finish")).toBe(true));
    const said = text(root(el).querySelector("[data-file-refusal]"));
    expect(said).toBe(
      "This receipt was cancelled, so the refund cannot be recorded on it. Press Finish to end this refund. The money already refunded stays refunded.",
    );
    expect(said).not.toContain("Refund a payment");
    expect(said).not.toMatch(/correct/i);
    expect(hint(el, "finish")).toBe(t("give_back.uw_stop_hint").replace("{amount}", "€2.00"));
    press(el, "finish");
    await vi.waitFor(() =>
      expect(outcome(el)).toBe(t("give_back.uw_closed").replace("{amount}", "€2.00")),
    );
    expect(api.closeInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
    expect(api.fileInvoiceCorrection).not.toHaveBeenCalled();
  });

  it("a fiscal conflict refusing the cash says new invoices are stopped and links to recovery", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(
      refused("sif.allocation_invalid", {
        reason: "conflict_requires_administrator",
        recoveryUrl: "/recovery/fiscal-conflict",
      }),
    );
    const { el } = await mount(OPEN, api);
    press(el, "cash");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("recovery.issuance_stopped")));
    const link = root(el).querySelector("wt-form-actions [data-recovery]")!;
    expect(link.getAttribute("href")).toBe("/recovery/fiscal-conflict");

    press(el, "check");
    await vi.waitFor(() => expect(bottom(el)).toBe(""));
    expect(root(el).querySelector("[data-recovery]")).toBeNull();
  });

  it("says why a receipt can never take the money back, in its own words and never as a correction", async () => {
    const reasons = ["replaced", "voided", "not_simplified"];
    const english = [];
    for (const reason of reasons) {
      const fileNow = { refusal: "sale.correction_not_admitted", reason, closable: true };
      const { el } = await mount({ ...OPEN, moneyBack: "2.00", fileNow });
      const said = text(root(el).querySelector("[data-file-refusal]"));
      expect(said).toBe(
        `${giveBackFilingMessage("sale.correction_not_admitted", "en", { reason })} ${t("give_back.uw_finish_unrecorded")}`,
      );
      expect(said).not.toMatch(/correct/i);
      english.push(said);
      const none = await mount({ ...OPEN, fileNow });
      expect(text(root(none.el).querySelector("[data-file-refusal]"))).toBe(
        giveBackFilingMessage("sale.correction_not_admitted", "en", { reason }),
      );
      expect(shown(none.el, "finish")).toBe(false);
    }
    expect(new Set(english).size).toBe(reasons.length);
    expect(
      giveBackFilingMessage("sale.correction_not_admitted", "en", { reason: "filing_refused" }),
    ).toBe(
      "The tax agency refused this receipt, or sending it to the agency is on hold, so the refund cannot be recorded on it yet. Fiscal filing, on the dashboard, shows which and what to do. Then press Check again.",
    );
    const pending = {
      refusal: "sale.correction_not_admitted",
      reason: "filing_pending",
      closable: false,
    };
    const waiting = await mount({ ...OPEN, moneyBack: "2.00", fileNow: pending });
    expect(text(root(waiting.el).querySelector("[data-file-refusal]"))).toBe(
      "This receipt is still being sent to the tax agency, so the refund cannot be recorded on it yet. Press Check again in a few minutes.",
    );
    expect(shown(waiting.el, "finish")).toBe(false);

    setLocale("es");
    const fileNow = {
      refusal: "sale.correction_not_admitted",
      reason: "voided",
      closable: true,
    };
    const { el } = await mount({ ...OPEN, moneyBack: "2.00", fileNow });
    const said = text(root(el).querySelector("[data-file-refusal]"));
    expect(said).toBe(
      `${giveBackFilingMessage("sale.correction_not_admitted", "es", { reason: "voided" })} ${es["give_back.uw_finish_unrecorded"]}`,
    );
    for (const code of ["sale.correction_not_admitted", "invoice_correction.chain_unsound"])
      for (const reason of [...reasons, "filing_refused", "filing_pending", "missing"]) {
        const words = giveBackFilingMessage(code, "es", { reason });
        expect(words).not.toMatch(/rectific/i);
        expect(words).not.toContain("equipo");
        expect(words).not.toBe(giveBackFilingMessage(code, "en", { reason }));
      }
  });

  it("on a full invoice refused with no fix, says Finish ends it and the money then goes on the accountant's list", async () => {
    const fileNow = {
      refusal: "sale.correction_not_admitted",
      reason: "refused_no_fix",
      closable: true,
    };
    const { el } = await mount({ ...OPEN, moneyBack: "2.00", fileNow });
    el.fullInvoice = true;
    await el.updateComplete;
    expect(shown(el, "finish")).toBe(true);
    expect(text(root(el).querySelector("[data-file-refusal]"))).toBe(
      "The tax agency refused this full invoice and Waitron cannot fix that. Once this refund ends, the money refunded goes in Download for accountant (XLSX), on the dashboard's Sales & takings page. Press Finish to end this refund. The money already refunded stays refunded.",
    );
  });

  it("on a full invoice refused or held, says so and offers Check again, not Finish", async () => {
    const fileNow = {
      refusal: "sale.correction_not_admitted",
      reason: "filing_refused",
      closable: false,
    };
    const { el } = await mount({ ...OPEN, moneyBack: "6.05", left: "0.00", fileNow });
    el.fullInvoice = true;
    await el.updateComplete;
    expect(shown(el, "finish")).toBe(false);
    expect(shown(el, "check")).toBe(true);
    expect(text(root(el).querySelector("[data-file-refusal]"))).toBe(
      giveBackFilingMessage("sale.correction_not_admitted", "en", {
        reason: "filing_refused",
        fullInvoice: true,
      }),
    );
    expect(text(root(el).querySelector("[data-file-refusal]"))).toMatch(/this full invoice/);
  });

  it("keeps cash and card quiet and disabled while the filing waits, as the box refuses them, and pressable where Finish closes it", async () => {
    const button = (el: TillGiveBackUnderWay, name: string) =>
      root(el).querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-choice=${name}]`)!;
    const waiting = {
      ...OPEN,
      moneyBack: "2.00",
      left: "4.05",
      fileNow: {
        refusal: "sale.correction_not_admitted",
        reason: "filing_refused",
        closable: false,
      },
    };
    const held = await mount(waiting);
    for (const name of ["cash", "card"]) {
      expect(button(held.el, name).disabled).toBe(true);
      expect(button(held.el, name).variant).toBe("secondary");
      press(held.el, name);
    }
    await held.el.updateComplete;
    expect(held.api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();
    expect(held.api.refundTransaction).not.toHaveBeenCalled();
    expect(root(held.el).querySelector("till-supervisor-override-dialog")).toBeNull();
    expect(button(held.el, "check").disabled).toBe(false);

    const noFix = { ...waiting.fileNow, reason: "refused_no_fix", closable: true };
    const closes = await mount({ ...waiting, fileNow: noFix });
    for (const name of ["cash", "card", "finish"])
      expect(button(closes.el, name).disabled).toBe(false);
    press(closes.el, "cash");
    await vi.waitFor(() => expect(closes.api.giveInvoiceCorrectionCash).toHaveBeenCalledOnce());
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

  it("reads the correction again when Cancel is refused because money went back, drawing Stop here", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue(FILING);
    api.closeInvoiceCorrection.mockRejectedValueOnce(
      refused("invoice_correction.still_correctable"),
    );
    const { el } = await mount(OPEN, api);

    press(el, "cancel");
    await vi.waitFor(() => expect(shown(el, "stop")).toBe(true));
    expect(shown(el, "cancel")).toBe(false);
    expect(bottom(el)).toBe(
      "A refund was made and can still be recorded. Press Finish or Stop here.",
    );
  });

  it("reads the correction again when Stop here is refused because nothing went back, drawing Cancel this money back", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue(OPEN);
    api.fileInvoiceCorrection.mockRejectedValueOnce(refused("invoice_correction.nothing_back"));
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() => expect(shown(el, "cancel")).toBe(true));
    expect(shown(el, "stop")).toBe(false);
    expect(bottom(el)).toBe(codeMessage("invoice_correction.nothing_back"));
  });

  it("reads again when the receipt was cancelled since, drawing Finish without recording", async () => {
    const api = fakeApi();
    const voided = { refusal: "sale.correction_not_admitted", reason: "voided", closable: true };
    api.getInvoiceCorrection.mockResolvedValue({ ...FILING, fileNow: voided });
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("sale.correction_not_admitted", { reason: "voided" }),
    );
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() => expect(shown(el, "finish")).toBe(true));
    expect(api.getInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
    expect(bottom(el)).toBe(
      giveBackFilingMessage("sale.correction_not_admitted", "en", { reason: "voided" }),
    );
    expect(bottom(el)).not.toMatch(/correct/i);
  });

  it("reads again when the receipt's earlier money back cannot be read, offering no Finish", async () => {
    const api = fakeApi();
    const unusable = { refusal: "sale.correction_history_unusable", closable: false };
    api.getInvoiceCorrection.mockResolvedValue({ ...FILING, left: "0.00", fileNow: unusable });
    api.fileInvoiceCorrection.mockRejectedValueOnce(refused("sale.correction_history_unusable"));
    const { el } = await mount({ ...FILING, left: "0.00" }, api);

    press(el, "finish");
    await vi.waitFor(() => expect(shown(el, "finish")).toBe(false));
    expect(api.getInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
    expect(bottom(el)).toBe(giveBackFilingMessage("sale.correction_history_unusable", "en"));
    expect(bottom(el)).not.toMatch(/correct/i);
  });

  const RECORDS_NEED_CHECKING =
    "The box's receipt and invoice records need checking, so no more can be refunded on this full invoice and the refund cannot be recorded on it yet. Money already refunded stays refunded. Press Check again once they have been checked.";
  const button = (el: TillGiveBackUnderWay, name: string) =>
    root(el).querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-choice=${name}]`)!;

  it("on a full invoice with nothing back yet, says the records need checking when the cash is refused, holding cash and card until Check again", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(
      refused("invoice_correction.chain_unsound", { saleId: "sale-1" }),
    );
    const { el } = await mount(OPEN, api);
    el.fullInvoice = true;
    await el.updateComplete;

    press(el, "cash");
    await vi.waitFor(() => expect(bottom(el)).toBe(RECORDS_NEED_CHECKING));
    expect(api.getInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    for (const name of ["cash", "card"]) expect(button(el, name).disabled).toBe(true);

    press(el, "check");
    await vi.waitFor(() => expect(button(el, "cash").disabled).toBe(false));
    expect(button(el, "card").disabled).toBe(false);
    expect(bottom(el)).toBe("");
  });

  it("on a full invoice read before its records needed checking, says so when the card is refused and reads again, offering no more money back and no Stop here", async () => {
    const api = fakeApi();
    const waits = { refusal: "invoice_correction.chain_unsound", closable: false };
    api.getInvoiceCorrection.mockResolvedValue({ ...FILING, fileNow: waits });
    api.refundTransaction.mockRejectedValueOnce(
      refused("invoice_correction.chain_unsound", { saleId: "sale-1" }),
    );
    const { el } = await mount(FILING, api);
    el.fullInvoice = true;
    await el.updateComplete;
    expect(shown(el, "stop")).toBe(true);

    press(el, "card");
    await vi.waitFor(() => expect(shown(el, "stop")).toBe(false));
    expect(bottom(el)).toBe(RECORDS_NEED_CHECKING);
    expect(text(root(el).querySelector("[data-file-refusal]"))).toBe(RECORDS_NEED_CHECKING);
    for (const name of ["cash", "card"]) expect(button(el, name).disabled).toBe(true);
    expect(shown(el, "finish")).toBe(false);
  });

  it("on a full invoice whose Finish is refused while its records need checking, says so and reads again, offering no Finish", async () => {
    const api = fakeApi();
    const waits = { refusal: "invoice_correction.chain_unsound", closable: false };
    api.getInvoiceCorrection.mockResolvedValue({ ...FILING, left: "0.00", fileNow: waits });
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("invoice_correction.chain_unsound", { saleId: "sale-1" }),
    );
    const { el } = await mount({ ...FILING, left: "0.00" }, api);
    el.fullInvoice = true;
    await el.updateComplete;

    press(el, "finish");
    await vi.waitFor(() => expect(shown(el, "finish")).toBe(false));
    expect(bottom(el)).toBe(RECORDS_NEED_CHECKING);
  });

  it("on a receipt whose Stop here is refused while the records need checking, says the refund cannot be recorded yet and keeps offering what the box still takes", async () => {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue(FILING);
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("invoice_correction.chain_unsound", { saleId: "sale-1" }),
    );
    const { el } = await mount(FILING, api);

    press(el, "stop");
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(
        "The box's receipt and invoice records need checking, so the refund cannot be recorded on this receipt yet. Money already refunded stays refunded. Try again once they have been checked.",
      ),
    );
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(shown(el, "stop")).toBe(true);
    for (const name of ["cash", "card"]) expect(button(el, name).disabled).toBe(false);

    setLocale("es");
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("invoice_correction.chain_unsound", { saleId: "sale-1" }),
    );
    press(el, "stop");
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(giveBackFilingMessage("invoice_correction.chain_unsound", "es", {})),
    );
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
        giveBackFilingMessage("sale.correction_not_admitted", "en", { reason: "missing" }),
      ),
    );
    expect(bottom(el)).not.toContain("Refund a payment");
    expect(bottom(el)).not.toMatch(/correct/i);
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

  it("tells the till the sign-in ended when the server says so, for the till to lock", async () => {
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce({ code: "session.required", status: 401 });
    const { el } = await mount(OPEN, api);
    const signedOut = vi.fn();
    el.addEventListener("give-back-signed-out", signedOut);

    press(el, "cash");
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
    expect(signedOut.mock.calls[0]![0]).toMatchObject({ bubbles: true, composed: true });
    expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledOnce();
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

  it.each([
    ["en", en],
    ["es-ES", es],
  ] as const)(
    "says in %s that the card company cannot refund yet, not to press the card's button again",
    async (locale, words) => {
      setLocale(locale);
      const api = fakeApi();
      api.refundTransaction.mockImplementationOnce(async (saleId, request) => ({
        ...refundOf(saleId, request, "failed"),
        refusalReason: "provider_balance_unavailable" as const,
      }));
      const { el } = await mount(OPEN, api);

      press(el, "card");
      await vi.waitFor(() =>
        expect(bottom(el)).toBe(
          `${words["tender_refund.failed"]} ${words["refund.provider_balance_unavailable"]}`,
        ),
      );
    },
  );

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

  it("sends nothing when the view is taken away while the card's payment is read again", async () => {
    const { el, api } = await mount();
    const read = deferred<RefundableTender[]>();
    api.getRefundableTenders.mockImplementationOnce(() => read.promise);
    press(el, "card");
    await vi.waitFor(() => expect(api.getRefundableTenders).toHaveBeenCalledTimes(2));
    el.remove();
    read.resolve(TENDERS);
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(api.refundTransaction).not.toHaveBeenCalled();
    expect(el.refunds.read("sale-1")).toBeNull();
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

  it("offers Send again for a card refund saved elsewhere on the receipt with no answer, resending it under the same submission id", async () => {
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
    const first = api.refundTransaction.mock.calls[0]![1];
    const { el } = await mount(OPEN, api);

    expect(text(root(el).querySelector("[data-lost]"))).toBe(t("give_back.lost"));
    expect(shown(el, "card")).toBe(false);
    expect(shown(el, "cancel")).toBe(false);
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "1.00", left: "5.05" });
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-left]"))).toContain("€5.05"));
    expect(api.refundTransaction).toHaveBeenCalledTimes(2);
    expect(api.refundTransaction.mock.calls[1]![1]).toEqual(first);
    expect(root(el).querySelector("[data-send-again]")).toBeNull();
    expect(new TenderRefundSession(SCOPE, api).read("sale-1")).toBeNull();
  });

  it("settles a card refund saved elsewhere on the receipt that waits for the card company on Check again, sending nothing new", async () => {
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
    api.getTenderRefund.mockResolvedValue(
      refundOf("sale-1", api.refundTransaction.mock.calls[0]![1]),
    );
    const { el } = await mount(OPEN, api);

    press(el, "check");
    await vi.waitFor(() => expect(api.getTenderRefund).toHaveBeenCalledWith("refund-1"));
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(api.refundTransaction).toHaveBeenCalledOnce();
    expect(new TenderRefundSession(SCOPE, api).read("sale-1")).toBeNull();
    press(el, "card");
    await vi.waitFor(() => expect(api.refundTransaction).toHaveBeenCalledTimes(2));
    expect(api.refundTransaction.mock.calls[1]![1].invoiceCorrectionId).toBe("correction-1");
  });

  it("words a card refund saved elsewhere on the receipt that the box refused as refused, resending it under the same submission id", async () => {
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
    const first = api.refundTransaction.mock.calls[0]![1];
    const { el } = await mount(OPEN, api, EVERY_METHOD, refunds);

    expect(text(root(el).querySelector("[data-lost]"))).toBe(t("give_back.uw_card_refused"));
    expect(shown(el, "card")).toBe(false);
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "1.00", left: "5.05" });
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() => expect(text(root(el).querySelector("[data-left]"))).toContain("€5.05"));
    expect(api.refundTransaction).toHaveBeenCalledTimes(2);
    expect(api.refundTransaction.mock.calls[1]![1]).toEqual(first);
  });

  it("keeps a refused card refund saved outside a correction when this window closes", async () => {
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

describe("Check again while a card refund waits for the card company", () => {
  const leg = (over: Partial<TenderRefundView> = {}): TenderRefundView => ({
    ...refundOf(
      "sale-1",
      {
        submissionId: "s",
        tenderId: "card-1",
        appliedAmount: "6.05",
        tipAmount: "0.00",
        reason: "Overcharged",
      },
      "pending",
    ),
    ...over,
  });
  const WAITING: InvoiceCorrectionView = {
    ...OPEN,
    pending: "6.05",
    left: "0.00",
    legs: [leg()],
  };
  const BACK: InvoiceCorrectionView = {
    ...OPEN,
    moneyBack: "6.05",
    left: "0.00",
    legs: [leg({ state: "completed" })],
    fileNow: { gross: "6.05", vatBreakdown: SPLIT },
  };
  const settled = (over: Partial<TenderRefundView> = {}): TenderRefundView => ({
    ...refundOf("sale-1", {
      submissionId: "s",
      tenderId: "card-1",
      appliedAmount: "6.05",
      tipAmount: "0.00",
      reason: "Overcharged",
    }),
    ...over,
  });
  /** A correction whose card refund the box has waiting, sent by the press that opened it or by
   * another till: this till saved no request for it. */
  function waitingApi() {
    const api = fakeApi();
    api.getInvoiceCorrection.mockResolvedValue(WAITING);
    api.getRefundableTenders.mockResolvedValue([
      CASH_ROW,
      { ...CARD_ROW, pendingRefundId: "refund-1" },
    ]);
    api.retryTenderRefund.mockResolvedValue(settled({ state: "pending" }));
    return api;
  }
  const status = (el: TillGiveBackUnderWay) =>
    text(root(el).querySelector("[data-pending-status]"));
  const notPermitted = () => refused("authorization.not_permitted", { permission: "sale.refund" });

  it("has the box ask about that same refund, then shows what is back, and Finish records it once", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
    api.retryTenderRefund.mockResolvedValueOnce(settled());
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockResolvedValue(BACK);

    press(el, "check");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-back]"))).toBe(
        t("give_back.uw_back").replace("{back}", "€6.05").replace("{gross}", "€6.05"),
      ),
    );
    expect(api.retryTenderRefund.mock.calls).toEqual([["refund-1", undefined]]);
    expect(api.refundTransaction).not.toHaveBeenCalled();
    expect(root(el).querySelector("[data-pending]")).toBeNull();
    expect(bottom(el)).toBe("");
    api.fileInvoiceCorrection.mockResolvedValueOnce({ ...BACK, state: "filed" });
    press(el, "finish");
    press(el, "finish");
    await vi.waitFor(() => expect(outcome(el)).toContain("€6.05"));
    expect(api.fileInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {
      expectedSplit: SPLIT,
    });
  });

  it("asks once about a refund this till saved, and settles the saved request with the answer", async () => {
    const api = waitingApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    const refunds = new TenderRefundSession(SCOPE, api);
    await refunds.submit("sale-1", {
      tenderId: "card-1",
      appliedAmount: "6.05",
      tipAmount: "0.00",
      reason: "Overcharged",
      invoiceCorrectionId: "correction-1",
    });
    api.getTenderRefund.mockResolvedValue(settled({ state: "pending" }));
    const { el } = await mount(WAITING, api, EVERY_METHOD, refunds);
    api.retryTenderRefund.mockResolvedValueOnce(settled());
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockResolvedValue(BACK);
    press(el, "check");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-back]"))).toContain("€6.05 refunded"),
    );
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
    expect(api.refundTransaction).toHaveBeenCalledOnce();
    expect(refunds.read("sale-1")).toBeNull();
  });

  it("says the card company still has not answered, until the next step is pressed", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    expect(status(el)).toBe("");
    press(el, "check");
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    const read = deferred<InvoiceCorrectionView>();
    api.getInvoiceCorrection.mockImplementationOnce(() => read.promise);
    press(el, "check");
    await el.updateComplete;
    expect(status(el)).toBe("");
    read.resolve(WAITING);
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1", "refund-1"]);
  });

  it.each([
    [undefined, () => t("give_back.uw_card_failed")],
    [
      "provider_balance_unavailable",
      () => `${t("tender_refund.failed")} ${t("refund.provider_balance_unavailable")}`,
    ],
  ] as const)("says the card company did not make it (reason %s)", async (refusalReason, said) => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    api.retryTenderRefund.mockResolvedValueOnce(
      settled({ state: "failed", ...(refusalReason && { refusalReason }) }),
    );
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockResolvedValue(OPEN);
    api.getRefundableTenders
      .mockResolvedValueOnce([CASH_ROW, { ...CARD_ROW, pendingRefundId: "refund-1" }])
      .mockResolvedValue(TENDERS);
    press(el, "check");
    await vi.waitFor(() => expect(bottom(el)).toBe(said()));
    expect(status(el)).toBe("");
    await vi.waitFor(() => expect(shown(el, "card")).toBe(true));
  });

  it("does not say the card company has not answered once it has, though the payments cannot be read after it", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    api.retryTenderRefund.mockResolvedValueOnce(settled());
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockResolvedValue(BACK);
    api.getRefundableTenders
      .mockResolvedValueOnce([CASH_ROW, { ...CARD_ROW, pendingRefundId: "refund-1" }])
      .mockRejectedValue(lost());
    press(el, "check");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-back]"))).toContain("€6.05 refunded"),
    );
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
    expect(status(el)).toBe("");
  });

  it("says the card company did not make it, and not that it has not answered, when nothing can be read after its answer", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    api.retryTenderRefund.mockResolvedValueOnce(settled({ state: "failed" }));
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockRejectedValue(lost());
    api.getRefundableTenders
      .mockResolvedValueOnce([CASH_ROW, { ...CARD_ROW, pendingRefundId: "refund-1" }])
      .mockRejectedValue(lost());
    press(el, "check");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_card_failed")));
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(status(el)).toBe("");
  });

  it("does not say so either when this till's own saved refund is found settled and the payments cannot be read", async () => {
    const api = waitingApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    const refunds = new TenderRefundSession(SCOPE, api);
    await refunds.submit("sale-1", {
      tenderId: "card-1",
      appliedAmount: "6.05",
      tipAmount: "0.00",
      reason: "Overcharged",
      invoiceCorrectionId: "correction-1",
    });
    const { el } = await mount(WAITING, api, ["take-cash"], refunds);
    api.getTenderRefund.mockResolvedValueOnce(settled());
    api.getInvoiceCorrection.mockResolvedValue(BACK);
    api.getRefundableTenders.mockRejectedValue(lost());
    press(el, "check");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-back]"))).toContain("€6.05 refunded"),
    );
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(status(el)).toBe("");
  });

  describe("once the card company answered and what is back cannot be read again", () => {
    const pendingLine = (el: TillGiveBackUnderWay) =>
      text(root(el).querySelector("[data-pending]"));
    const unread = (el: TillGiveBackUnderWay) => text(root(el).querySelector("[data-unread]"));
    const waits = (amount: string) => t("give_back.pending").replace("{amount}", amount);
    const ROWS = [CASH_ROW, { ...CARD_ROW, pendingRefundId: "refund-1" }];
    /** Presses Check again, which answers `answers`, and after which nothing can be read. */
    async function checkUnread(
      api: Api,
      answers: TenderRefundView[],
      correction = WAITING,
      rows: RefundableTender[] = ROWS,
    ) {
      const { el } = await mount(correction, api);
      for (const answer of answers) api.retryTenderRefund.mockResolvedValueOnce(answer);
      api.getInvoiceCorrection.mockResolvedValueOnce(correction).mockRejectedValue(lost());
      api.getRefundableTenders.mockResolvedValueOnce(rows).mockRejectedValue(lost());
      press(el, "check");
      await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(idle(el)).toBe(true));
      return el;
    }

    it("says the money is back and that the rest could not be read, not that it waits, until it is read", async () => {
      const api = waitingApi();
      const el = await checkUnread(api, [settled()]);
      expect(pendingLine(el)).toBe("");
      expect(unread(el)).toBe(
        `${t("give_back.done_card").replace("{amount}", "€6.05").replace("{card}", "···0042")} ${t("tender_refund.read_failed")}`,
      );
      expect(bottom(el)).toBe("");
      press(el, "check");
      await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.read_failed")));
      expect(pendingLine(el)).toBe("");
      api.getInvoiceCorrection.mockResolvedValue(BACK);
      api.getRefundableTenders.mockResolvedValue(TENDERS);
      press(el, "check");
      await vi.waitFor(() =>
        expect(text(root(el).querySelector("[data-back]"))).toContain("€6.05 refunded"),
      );
      await vi.waitFor(() => expect(idle(el)).toBe(true));
      expect(unread(el)).toBe("");
      expect(api.retryTenderRefund).toHaveBeenCalledOnce();
    });

    it("does not say it could not be read while it is being read", async () => {
      const api = waitingApi();
      const { el } = await mount(WAITING, api);
      api.retryTenderRefund.mockResolvedValueOnce(settled());
      const read = deferred<InvoiceCorrectionView>();
      api.getInvoiceCorrection
        .mockResolvedValueOnce(WAITING)
        .mockImplementationOnce(() => read.promise);
      press(el, "check");
      await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledTimes(2));
      await el.updateComplete;
      expect(pendingLine(el)).toBe("");
      expect(unread(el)).toBe("");
      read.reject(lost());
      await vi.waitFor(() => expect(unread(el)).toContain(t("tender_refund.read_failed")));
    });

    it("says the refund was not made and that the rest could not be read, not that it waits", async () => {
      const el = await checkUnread(waitingApi(), [settled({ state: "failed" })]);
      expect(pendingLine(el)).toBe("");
      expect(bottom(el)).toBe(t("give_back.uw_card_failed"));
      expect(unread(el)).toBe(`${t("tender_refund.failed")} ${t("tender_refund.read_failed")}`);
    });

    it("still says the refund was not made once a second Check again cannot read either", async () => {
      const el = await checkUnread(waitingApi(), [settled({ state: "failed" })]);
      press(el, "check");
      await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.read_failed")));
      await vi.waitFor(() => expect(idle(el)).toBe(true));
      expect(unread(el)).toContain(t("tender_refund.failed"));
    });

    it("says only what another refund not answered yet still waits for", async () => {
      const two: InvoiceCorrectionView = {
        ...WAITING,
        legs: [
          leg({ appliedAmount: "4.00" }),
          leg({ id: "refund-2", tenderId: "card-2", appliedAmount: "2.05" }),
        ],
      };
      const el = await checkUnread(
        waitingApi(),
        [
          settled({ appliedAmount: "4.00" }),
          settled({
            id: "refund-2",
            tenderId: "card-2",
            appliedAmount: "2.05",
            state: "pending",
          }),
        ],
        two,
        [...ROWS, { ...CARD_ROW, tenderId: "card-2", pendingRefundId: "refund-2" }],
      );
      expect(pendingLine(el)).toBe(waits("€2.05"));
      expect(status(el)).toBe(t("give_back.pending_unanswered"));
      expect(unread(el)).toContain("€4.00");
    });

    it("says so, and not that nothing changed, when this till's own saved refund was found settled", async () => {
      const api = waitingApi();
      api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
        refundOf(saleId, request, "pending"),
      );
      const refunds = new TenderRefundSession(SCOPE, api);
      await refunds.submit("sale-1", {
        tenderId: "card-1",
        appliedAmount: "6.05",
        tipAmount: "0.00",
        reason: "Overcharged",
        invoiceCorrectionId: "correction-1",
      });
      const { el } = await mount(WAITING, api, EVERY_METHOD, refunds);
      api.getTenderRefund.mockResolvedValueOnce(settled());
      api.getInvoiceCorrection.mockRejectedValue(lost());
      api.getRefundableTenders.mockRejectedValue(lost());
      press(el, "check");
      await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown")));
      await vi.waitFor(() => expect(idle(el)).toBe(true));
      expect(pendingLine(el)).toBe("");
      expect(unread(el)).toContain("€6.05 is refunded to card");
    });

    it("keeps saying it waits while nothing was answered, though the payments were never read", async () => {
      const api = waitingApi();
      api.getRefundableTenders.mockRejectedValue(lost());
      const { el } = await mount(WAITING, api);
      press(el, "check");
      await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(idle(el)).toBe(true));
      expect(pendingLine(el)).toBe(waits("€6.05"));
      expect(unread(el)).toBe("");
      expect(api.retryTenderRefund).not.toHaveBeenCalled();
    });
  });

  it("still says the card company has not answered about another refund it has not settled", async () => {
    const api = waitingApi();
    api.getRefundableTenders.mockReset().mockResolvedValue([
      { ...CARD_ROW, pendingRefundId: "refund-1" },
      { ...CARD_ROW, tenderId: "card-2", pendingRefundId: "refund-2" },
    ]);
    const { el } = await mount(WAITING, api);
    api.retryTenderRefund
      .mockResolvedValueOnce(settled())
      .mockResolvedValueOnce(settled({ id: "refund-2", tenderId: "card-2", state: "pending" }));
    press(el, "check");
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(api.retryTenderRefund).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["lost", () => lost(), "give_back.uw_unknown"],
    ["refused on a full disk", () => refused("storage.disk_full"), "storage.disk_full"],
    [
      "refused as the box's time is not confirmed",
      () => refused("clock.unconfirmed"),
      "clock.unconfirmed",
    ],
  ] as const)(
    "says so when the asking is %s, and asks about the same refund again at the next press",
    async (_what, error, said) => {
      const api = waitingApi();
      api.retryTenderRefund.mockRejectedValueOnce(error());
      const { el } = await mount(WAITING, api);
      press(el, "check");
      await vi.waitFor(() =>
        expect(bottom(el)).toBe(said === "give_back.uw_unknown" ? t(said) : codeMessage(said)),
      );
      expect(idle(el)).toBe(true);
      press(el, "check");
      await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
      expect(bottom(el)).toBe("");
      expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1", "refund-1"]);
    },
  );

  it("says the receipt could not be read when nothing was asked, also after an asking was lost", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    api.retryTenderRefund.mockRejectedValueOnce(lost());
    press(el, "check");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.uw_unknown")));
    api.getInvoiceCorrection.mockRejectedValueOnce(lost());
    press(el, "check");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.read_failed")));
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
  });

  it("asks an approver when the person signed in may not, then asks with their PIN", async () => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce(notPermitted());
    const { el } = await mount(WAITING, api);
    press(el, "check");
    const pin = await pinDialog(el);
    expect(api.listApprovers).toHaveBeenCalledWith("sale.refund", expect.anything());
    api.retryTenderRefund.mockResolvedValueOnce(settled());
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockResolvedValue(BACK);
    signIn(pin);
    await vi.waitFor(() => expect(shown(el, "finish")).toBe(true));
    expect(root(el).querySelector("till-supervisor-override-dialog")).toBeNull();
    expect(api.retryTenderRefund.mock.calls).toEqual([
      ["refund-1", undefined],
      ["refund-1", MANAGER],
    ]);
  });

  it("tells the till the sign-in ended when the asking is refused for it", async () => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce(refused("session.required"));
    const { el } = await mount(WAITING, api);
    const signedOut = vi.fn();
    el.addEventListener("give-back-signed-out", signedOut);
    press(el, "check");
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
  });

  it("asks once when pressed twice, and is busy until that is answered", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    const busy = vi.fn();
    el.addEventListener("give-back-busy", (event) => busy((event as CustomEvent).detail));
    const answer = deferred<TenderRefundView>();
    api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
    press(el, "check");
    press(el, "check");
    await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
    await el.updateComplete;
    press(el, "check");
    expect(busy).toHaveBeenLastCalledWith({ busy: true, held: true });
    answer.resolve(settled({ state: "pending" }));
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(busy).toHaveBeenLastCalledWith({ busy: false, held: true });
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
  });

  it("asks nothing when the view is taken away while what is back is read", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api);
    const read = deferred<InvoiceCorrectionView>();
    api.getInvoiceCorrection.mockImplementationOnce(() => read.promise);
    press(el, "check");
    await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledOnce());
    el.remove();
    read.resolve(WAITING);
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  });

  it("asks about no further refund when the view is taken away while one is asked about", async () => {
    const api = waitingApi();
    api.getRefundableTenders.mockResolvedValue([
      { ...CARD_ROW, pendingRefundId: "refund-1" },
      { ...CARD_ROW, tenderId: "card-2", pendingRefundId: "refund-2" },
    ]);
    const { el } = await mount(WAITING, api);
    const answer = deferred<TenderRefundView>();
    api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
    press(el, "check");
    await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
    el.remove();
    answer.resolve(settled());
    await vi.waitFor(() => expect(idle(el)).toBe(true));
    expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1"]);
  });

  it("tells the till the sign-in ended when that refuses a later refund, though one was answered", async () => {
    const api = waitingApi();
    api.getRefundableTenders.mockResolvedValue([
      { ...CARD_ROW, pendingRefundId: "refund-1" },
      { ...CARD_ROW, tenderId: "card-2", pendingRefundId: "refund-2" },
    ]);
    api.retryTenderRefund
      .mockResolvedValueOnce(settled())
      .mockRejectedValueOnce(refused("session.not_open"));
    const { el } = await mount(WAITING, api);
    const signedOut = vi.fn();
    el.addEventListener("give-back-signed-out", signedOut);
    press(el, "check");
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
  });

  it("asks nothing for a card this device's profile does not take, and says it still waits", async () => {
    const api = waitingApi();
    const { el } = await mount(WAITING, api, ["take-cash"]);
    const busy = vi.fn();
    el.addEventListener("give-back-busy", (event) => busy((event as CustomEvent).detail));
    press(el, "check");
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(busy).toHaveBeenLastCalledWith({ busy: false, held: true });
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  });

  it("keeps Send again for a card's part with no answer when another refund is answered", async () => {
    const api = waitingApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    const refunds = new TenderRefundSession(SCOPE, api);
    await refunds
      .submit("sale-1", {
        tenderId: "card-2",
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Overcharged",
        invoiceCorrectionId: "correction-1",
      })
      .catch(() => {});
    const { el } = await mount(WAITING, api, EVERY_METHOD, refunds);
    api.retryTenderRefund.mockResolvedValueOnce(settled());
    api.getInvoiceCorrection.mockResolvedValueOnce(WAITING).mockResolvedValue(BACK);
    press(el, "check");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-back]"))).toContain("€6.05 refunded"),
    );
    expect(root(el).querySelector("[data-send-again]")).not.toBeNull();
    expect(refunds.read("sale-1")?.refundId).toBeNull();
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

describe("what holds back the full-disk screen", () => {
  /** The latest `give-back-busy`, the first of which comes before `mount` returns. */
  function listening() {
    const seen = vi.fn<(detail: { busy: boolean; held: boolean }) => void>();
    const listen = (event: Event) => seen((event as CustomEvent).detail);
    document.addEventListener("give-back-busy", listen);
    onTestFinished(() => document.removeEventListener("give-back-busy", listen));
    return () => seen.mock.lastCall?.[0];
  }
  const answered = { busy: false, held: true };

  it("is nothing before a step, and again once Check again found nothing new", async () => {
    const latest = listening();
    const api = fakeApi();
    const { el } = await mount(OPEN, api);
    expect(latest()).toEqual({ busy: false, held: false });
    const read = deferred<InvoiceCorrectionView>();
    api.getInvoiceCorrection.mockImplementationOnce(() => read.promise);
    press(el, "check");
    await el.updateComplete;
    expect(latest()).toEqual({ busy: true, held: true });
    read.resolve(OPEN);
    await vi.waitFor(() => expect(latest()).toEqual({ busy: false, held: false }));
  });

  it("is a refusal, until the next step is pressed", async () => {
    const latest = listening();
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(refused("invoice_correction.money_short"));
    const { el } = await mount(OPEN, api);
    press(el, "card");
    await vi.waitFor(() => expect(bottom(el)).not.toBe(""));
    expect(latest()).toEqual(answered);
    press(el, "check");
    await vi.waitFor(() => expect(latest()).toEqual({ busy: false, held: false }));
  });

  it("is a step waiting for its approver", async () => {
    const latest = listening();
    const api = fakeApi();
    api.fileInvoiceCorrection.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.rectify" }),
    );
    const { el } = await mount(FILING, api);
    press(el, "stop");
    await pinDialog(el);
    expect(latest()).toEqual(answered);
  });

  it("is a card's part with no answer, also from an earlier visit", async () => {
    const latest = listening();
    const api = fakeApi();
    api.refundTransaction.mockRejectedValueOnce(lost());
    const first = await mount(OPEN, api);
    press(first.el, "card");
    await vi.waitFor(() =>
      expect(root(first.el).querySelector("[data-send-again]")).not.toBeNull(),
    );
    expect(latest()).toEqual(answered);
    first.el.remove();
    await mount(OPEN, api);
    expect(latest()).toEqual(answered);
  });

  it("is the cash to hand over", async () => {
    const latest = listening();
    const api = fakeApi();
    api.giveInvoiceCorrectionCash.mockResolvedValueOnce({
      correction: { ...OPEN, moneyBack: "5.00", left: "1.05" },
      refunds: [],
      replayed: false,
    } as never);
    const { el } = await mount(OPEN, api);
    press(el, "cash");
    await vi.waitFor(() => expect(root(el).querySelector("[data-cash-given]")).not.toBeNull());
    expect(latest()).toEqual(answered);
  });

  it("is the card company's answer to a card's part", async () => {
    const latest = listening();
    const api = fakeApi();
    api.refundTransaction.mockImplementationOnce(async (saleId, request) =>
      refundOf(saleId, request, "pending"),
    );
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, pending: "6.05", left: "0.00" });
    const { el } = await mount(OPEN, api);
    press(el, "card");
    await vi.waitFor(() => expect(root(el).querySelector("[data-pending]")).not.toBeNull());
    expect(bottom(el)).toBe("");
    expect(latest()).toEqual(answered);
  });

  it("is how it ended", async () => {
    const latest = listening();
    const { el } = await mount(FILING);
    press(el, "stop");
    await vi.waitFor(() => expect(outcome(el)).not.toBe(""));
    expect(latest()).toEqual(answered);
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
