import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { deferred } from "../../test/clock-app.js";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage, giveBackReasonMessage } from "../i18n/codes.js";
import { en, es } from "../i18n/strings.js";
import { guideHref } from "../help-guide.js";
import { formatMoney } from "@waitron/shared";
import type {
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackRequest,
  GiveBackView,
  GiveBackWrite,
} from "../api/give-back-types.js";
import { GiveBackSession } from "../state/give-back.js";
import { TABLE_REQUEST_LIMIT_MS } from "../state/draft-sync.js";
import {
  APPROVERS,
  CARD,
  CASH,
  SCOPE,
  VIEW,
  UNDER_WAY,
  WAITING_TENDER,
  completedFor,
  fakeGiveBackApi,
  previewFor,
  refundAnswer,
  refundsOn,
} from "./give-back-dialog.test-helpers.js";
import "./give-back-dialog.js";
import type { TillGiveBackDialog } from "./give-back-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
  localStorage.clear();
});

async function mount(api = fakeGiveBackApi(), session = new GiveBackSession(SCOPE, api)) {
  const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
    api,
    session,
    refunds: refundsOn(api),
    capabilities: ["take-cash", "integrated-card-payment"],
    saleId: "sale-1",
    invoiceNumber: "A/1042",
    namesLocale: "en",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-loading]")).toBeNull());
  await el.updateComplete;
  return { el, api };
}
/** Waits for the next send the window starts to have ended. */
function checkEnded(el: TillGiveBackDialog) {
  const held = vi.fn<(until: Promise<unknown>) => void>();
  el.addEventListener("hold-reload", (event) => held((event as CustomEvent).detail.until), {
    once: true,
  });
  return async () => {
    await held.mock.lastCall![0].catch(() => {});
  };
}
/** What each give-back the window sent asked for, less its ids. */
const asksOf = (el: TillGiveBackDialog) =>
  (el.api as ReturnType<typeof fakeGiveBackApi>).giveBack.mock.calls.map(([, body]) => ({
    request: body.request,
    reasonId: body.reasonId,
    note: body.note,
    expected: body.expected,
  }));
const withView = (over: Partial<GiveBackView>) => fakeGiveBackApi({ ...VIEW, ...over });

const root = (el: TillGiveBackDialog) => el.shadowRoot!;
const underWay = (el: TillGiveBackDialog) => root(el).querySelector("till-give-back-under-way");
const heading = (el: TillGiveBackDialog) => root(el).querySelector("wt-dialog")!.heading;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const choice = (el: TillGiveBackDialog, purpose: string) =>
  root(el).querySelector<HTMLElement>(`[data-choice=${purpose}]`);
async function choose(el: TillGiveBackDialog, purpose: string) {
  choice(el, purpose)!.click();
  await el.updateComplete;
}
const dish = (el: TillGiveBackDialog, id: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(`wt-switch[data-line="${id}"]`);
async function tick(el: TillGiveBackDialog, id: string) {
  dish(el, id)!.shadowRoot!.querySelector("input")!.click();
  await el.updateComplete;
}
const amountField = (el: TillGiveBackDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-price-input"]>("wt-price-input[name=amount]")!;
async function type(el: TillGiveBackDialog, value: string) {
  const field = amountField(el);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function reason(el: TillGiveBackDialog, id: string) {
  root(el)
    .querySelector("wt-combobox[name=reason]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: id }, bubbles: true, composed: true }),
    );
  await el.updateComplete;
}
const submit = (el: TillGiveBackDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
const bottom = (el: TillGiveBackDialog) => root(el).querySelector("wt-form-actions")!.error;
const way = (el: TillGiveBackDialog, id: string) =>
  root(el).querySelector<HTMLInputElement>(`input[name=way][value="${id}"]`);
const summary = (el: TillGiveBackDialog) => root(el).querySelector("[data-summary]");

describe("the choice", () => {
  it("offers a dish, goodwill and the extra paid on top, the extra with its amount", async () => {
    const { el, api } = await mount();
    expect(api.readGiveBack).toHaveBeenCalledWith("sale-1", expect.anything());
    expect(text(root(el).querySelector("[data-what-for]"))).toBe("What is it for?");
    const rows = [...root(el).querySelectorAll("wt-choice-row")];
    expect(rows.map((row) => [row.dataset.choice, row.heading, text(row)])).toEqual([
      [
        "dishes",
        "A dish",
        "Something they ordered never came, or was not right. You tick the dishes.",
      ],
      [
        "goodwill",
        "Goodwill or a complaint",
        "Refund an amount you choose, for example for a complaint.",
      ],
      [
        "extra",
        "Extra paid on top of the bill",
        "Refund some or all of the €3.00 paid on top of the bill, and nothing else. The receipt shows it as Tip.",
      ],
    ]);
  });

  it("leaves the extra out when nothing was paid on top", async () => {
    const { el } = await mount(withView({ ways: [CASH, { ...CARD, extraLeft: "0.00" }] }));
    expect(choice(el, "extra")).toBeNull();
    expect(choice(el, "dishes")).not.toBeNull();
  });

  it("shows a choice that must wait unavailable with its one line, and the others work at once", async () => {
    const refused = { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } };
    const { el } = await mount(
      withView({
        choices: { ...VIEW.choices, goodwill: { available: false, reason: refused } },
      }),
    );
    const goodwill = choice(el, "goodwill")!;
    expect(goodwill.tagName).not.toBe("WT-CHOICE-ROW");
    expect(goodwill.getAttribute("aria-disabled")).toBe("true");
    expect(text(root(el).querySelector("[data-choice-reason=goodwill]"))).toBe(
      "The tax agency refused this receipt, or sending it to the agency is on hold. Fiscal filing, on the dashboard, shows which and what to do. Until then, dishes or goodwill cannot be refunded; money owed for cancelled dishes and the extra paid on top can.",
    );
    await choose(el, "goodwill");
    expect(root(el).querySelector("[data-purpose]")).toBeNull();
    await choose(el, "extra");
    expect(text(root(el).querySelector("[data-purpose]"))).toBe("Extra paid on top of the bill");
  });

  it("on a full invoice, names it in a choice's wait and hands that on to Money back under way", async () => {
    const refused = { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } };
    const { el } = await mount(
      withView({
        choices: { ...VIEW.choices, goodwill: { available: false, reason: refused } },
      }),
    );
    el.fullInvoice = true;
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-choice-reason=goodwill]"))).toBe(
      giveBackReasonMessage("sale.correction_not_admitted", "en", {
        reason: "filing_refused",
        fullInvoice: true,
      }),
    );

    const opened = await mount(withView({ underWay: UNDER_WAY }));
    opened.el.fullInvoice = true;
    await opened.el.updateComplete;
    await vi.waitFor(() => expect(underWay(opened.el)?.fullInvoice).toBe(true));
  });

  describe("while the box's records need checking", () => {
    const unsound = { code: "invoice_correction.chain_unsound", params: { saleId: "sale-1" } };
    const fullInvoiceWords =
      "The box's receipt and invoice records need checking, so dishes, cancelled dishes or goodwill cannot be refunded or recorded now; the extra paid on top can be refunded. Money already refunded stays refunded.";
    const receiptWords = codeMessage("invoice_correction.chain_unsound", "en");

    for (const [kind, fullInvoice, words] of [
      ["a full invoice", true, fullInvoiceWords],
      ["a receipt", false, receiptWords],
    ] as const) {
      it(`on ${kind}, words the read's wait for it`, async () => {
        const { el } = await mount(
          withView({
            choices: { ...VIEW.choices, goodwill: { available: false, reason: unsound } },
          }),
        );
        el.fullInvoice = fullInvoice;
        await el.updateComplete;
        expect(text(root(el).querySelector("[data-choice-reason=goodwill]"))).toBe(words);
      });

      it(`on ${kind}, words a preview refused for it`, async () => {
        const api = fakeGiveBackApi();
        api.previewGiveBack.mockRejectedValue({ ...unsound, ...unsound.params, status: 409 });
        const { el } = await mount(api);
        el.fullInvoice = fullInvoice;
        await el.updateComplete;
        await choose(el, "goodwill");
        await type(el, "6");
        await vi.waitFor(() => expect(bottom(el)).toBe(words));
      });
    }
  });

  it("says on a dish line held by a refused receipt what can still go back", async () => {
    const refused = { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } };
    const { el } = await mount(
      withView({
        lines: VIEW.lines.map((line) =>
          line.id === "croquetas" ? { ...line, available: false, reason: refused } : line,
        ),
      }),
    );
    await choose(el, "dishes");
    expect(text(root(el).querySelector("[data-line-reason=croquetas]"))).toBe(
      "The tax agency refused this receipt, or sending it to the agency is on hold. Fiscal filing, on the dashboard, shows which and what to do. Until then, dishes or goodwill cannot be refunded; money owed for cancelled dishes and the extra paid on top can.",
    );
  });

  it("carries a help-mode badge saying what the window does, linked to its guide section", async () => {
    const { el } = await mount();
    const badge = root(el).querySelector("wt-help-tooltip")!;
    expect(badge.getAttribute("mode")).toBe("help-mode");
    expect(badge.getAttribute("aria-label")).toBe("Help: Refund");
    expect(text(badge)).toBe(
      "Refund a guest: for a dish, as goodwill, or the extra paid on top. If you close it before it is all refunded, find the receipt in Find a bill under Refunds under way; if it is not there, open Refund on the receipt again on this till.",
    );
    expect(badge.getAttribute("guide-href")).toBe(guideHref("table-service.give-money-back"));
  });

  it("shows a choice with nothing to give back quiet, with no line", async () => {
    const { el } = await mount(
      withView({ choices: { ...VIEW.choices, dishes: { available: false, reason: null } } }),
    );
    expect(choice(el, "dishes")!.getAttribute("aria-disabled")).toBe("true");
    expect(root(el).querySelector("[data-choice-reason]")).toBeNull();
  });

  it("says why the receipt could not be read and offers to read it again", async () => {
    const api = fakeGiveBackApi();
    api.readGiveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mount(api);
    expect(bottom(el)).toBe(t("give_back.read_failed"));
    root(el).querySelector<HTMLElement>("[data-reload]")!.click();
    await vi.waitFor(() => expect(choice(el, "dishes")).not.toBeNull());
  });

  it("goes back from a form to the choice", async () => {
    const { el } = await mount();
    await choose(el, "goodwill");
    root(el).querySelector<HTMLElement>("[data-back]")!.click();
    await el.updateComplete;
    expect(choice(el, "dishes")).not.toBeNull();
  });

  it("goes back with nothing staged at once", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    root(el).querySelector<HTMLElement>("[data-back]")!.click();
    await el.updateComplete;
    expect(choice(el, "dishes")).not.toBeNull();
  });
});

describe("A dish", () => {
  it("lists the dishes with only what Waitron knows, extras under their dish", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    expect(text(root(el).querySelector("[data-which]"))).toBe("Which dishes?");
    expect(
      ["croquetas", "paella", "salad"].map((id) => [
        dish(el, id)!.label,
        dish(el, id)!.description,
      ]),
    ).toEqual([
      ["2 × Croquetas · €8.00", ""],
      ["Paella · €18.50", "Cancelled, not served"],
      ["Salad · €9.50", "Cancelled, refunded"],
    ]);
    expect(text(root(el).querySelector("[data-extra-of=paella]"))).toBe("Aioli · €1.50");
    expect(dish(el, "aioli")).toBeNull();
    expect(dish(el, "cake")).toBeNull();
    expect(text(root(el).querySelector("[data-free=cake]"))).toContain("Given free");
    expect([...root(el).querySelectorAll("wt-switch")].map((row) => row.description)).not.toContain(
      "Served",
    );
  });

  it("says a cancelled dish's money is waiting while a card refund of it waits for the card company", async () => {
    const salad = VIEW.lines.find((line) => line.id === "salad")!;
    const waiting = { ...salad, cancelled: { ...salad.cancelled!, waiting: "4.00" } };
    const { el } = await mount(
      withView({ lines: VIEW.lines.map((line) => (line.id === "salad" ? waiting : line)) }),
    );
    await choose(el, "dishes");
    expect(dish(el, "salad")!.description).toBe("Cancelled, refund waiting for the card company");
    expect(dish(el, "paella")!.description).toBe("Cancelled, not served");
  });

  it("fills the amount from what is left, a cancelled dish from what it is owed, and keeps an edit", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    await tick(el, "croquetas");
    expect(amountField(el).value).toBe("8.00");
    await tick(el, "paella");
    expect(amountField(el).value).toBe("28.00");
    await tick(el, "croquetas");
    expect(amountField(el).value).toBe("20.00");
    await type(el, "15");
    await tick(el, "croquetas");
    expect(amountField(el).value).toBe("15");
  });

  it("takes an amount up to all the money left on the receipt, and refuses more", async () => {
    const { el, api } = await mount();
    await choose(el, "dishes");
    await tick(el, "croquetas");
    await reason(el, "complaint");
    await type(el, "47.00");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    expect(api.previewGiveBack).toHaveBeenLastCalledWith("sale-1", {
      purpose: "dishes",
      lineIds: ["croquetas"],
      amount: "47.00",
      extra: "0.00",
      way: "cash",
    });
    expect(amountField(el).error).toBe("");
    await type(el, "47.01");
    submit(el).click();
    await el.updateComplete;
    expect(amountField(el).error).toBe(t("give_back.amount_invalid").replace("{amount}", "€47.00"));
  });

  it("does not let a line that must wait be ticked, says why, and ticks the others", async () => {
    const waiting = { code: "invoice_correction.refund_pending" };
    const { el } = await mount(
      withView({
        lines: VIEW.lines.map((line) =>
          line.id === "croquetas" ? { ...line, available: false, reason: waiting } : line,
        ),
      }),
    );
    await choose(el, "dishes");
    expect(dish(el, "croquetas")!.disabled).toBe(true);
    expect(text(root(el).querySelector("[data-line-reason=croquetas]"))).toBe(
      codeMessage(waiting.code, "en"),
    );
    expect(dish(el, "salad")!.disabled).toBe(true);
    expect(root(el).querySelector("[data-line-reason=salad]")).toBeNull();
    await tick(el, "paella");
    expect(amountField(el).value).toBe("20.00");
  });

  it("offers the extra too with the owner's words, and previews it with the dishes", async () => {
    const { el, api } = await mount();
    await choose(el, "dishes");
    expect(root(el).querySelector("wt-switch[name=extra]")).toBeNull();
    way(el, "card-1")!.click();
    await el.updateComplete;
    const extra =
      root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("wt-switch[name=extra]")!;
    expect(extra.label).toBe("Refund the extra paid on top too (€3.00)");
    await tick(el, "croquetas");
    extra.shadowRoot!.querySelector("input")!.click();
    await vi.waitFor(() =>
      expect(api.previewGiveBack).toHaveBeenLastCalledWith("sale-1", {
        purpose: "dishes",
        lineIds: ["croquetas"],
        amount: "8.00",
        extra: "3.00",
        way: "card-1",
      }),
    );
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-total]"))).toBe("€11.00"),
    );
  });

  it("lists a dish given free's priced extras under it", async () => {
    const { el } = await mount(
      withView({
        lines: [
          ...VIEW.lines,
          {
            ...VIEW.lines[2]!,
            id: "cake-cream",
            descriptions: { en: "Cream", es: "Nata" },
            partOf: "cake",
          },
        ],
      }),
    );
    await choose(el, "dishes");
    expect(text(root(el).querySelector("[data-extra-of=cake]"))).toBe("Cream · €1.50");
  });
});

describe("a card refund the box knows is waiting", () => {
  const held = { code: "tender.refund_in_progress" };
  const waiting = { code: "invoice_correction.refund_pending" };
  const PENDING: GiveBackView = {
    ...VIEW,
    ways: [{ ...CARD, pending: true, reason: held }],
    choices: {
      dishes: { available: false, reason: waiting },
      goodwill: { available: false, reason: waiting },
      extra: { available: false, reason: held },
    },
  };
  const check = (el: TillGiveBackDialog) =>
    root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-check-pending]");
  const status = (el: TillGiveBackDialog) => text(root(el).querySelector("[data-pending-status]"));

  it("offers Check again, which reads the receipt again without sending anything", async () => {
    const api = fakeGiveBackApi(PENDING);
    const { el } = await mount(api);
    expect(text(check(el))).toBe(t("give_back.check_again"));
    expect(status(el)).toBe("");
    check(el)!.click();
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(api.readGiveBack).toHaveBeenCalledTimes(2);
    expect(choice(el, "goodwill")!.getAttribute("aria-disabled")).toBe("true");
    api.readGiveBack.mockResolvedValueOnce(VIEW);
    check(el)!.click();
    await vi.waitFor(() => expect(choice(el, "goodwill")!.tagName).toBe("WT-CHOICE-ROW"));
    expect(check(el)).toBeNull();
    expect(status(el)).toBe("");
    expect(api.readGiveBack).toHaveBeenCalledTimes(3);
    expect(api.giveBack).not.toHaveBeenCalled();
    expect(api.refundTransaction).not.toHaveBeenCalled();
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  });

  it("says when the receipt could not be read again, and keeps what it showed", async () => {
    const api = fakeGiveBackApi(PENDING);
    const { el } = await mount(api);
    api.readGiveBack.mockRejectedValueOnce({ code: "network" });
    check(el)!.click();
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.read_failed")));
    expect(choice(el, "goodwill")!.getAttribute("aria-disabled")).toBe("true");
    expect(check(el)).not.toBeNull();
  });

  it("holds back the full-disk screen while Check again is out and while its answer is shown", async () => {
    const api = fakeGiveBackApi(PENDING);
    const { el } = await mount(api);
    const held = vi.fn();
    el.addEventListener("give-back-held", (event) => held((event as CustomEvent).detail.held));
    const answer = deferred<GiveBackView>();
    api.readGiveBack.mockImplementationOnce(() => answer.promise);
    check(el)!.click();
    await el.updateComplete;
    expect(held.mock.calls).toEqual([[true]]);
    answer.resolve(PENDING);
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(held.mock.calls).toEqual([[true]]);
    api.readGiveBack.mockResolvedValueOnce(VIEW);
    check(el)!.click();
    await vi.waitFor(() => expect(check(el)).toBeNull());
    expect(held.mock.calls).toEqual([[true], [false]]);
  });

  const prompt = (el: TillGiveBackDialog) =>
    root(el).querySelector<HTMLElementTagNameMap["till-supervisor-override-dialog"]>(
      "till-supervisor-override-dialog",
    );
  const approve = (el: TillGiveBackDialog) =>
    prompt(el)!.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "boss", pin: "1234" } }),
    );
  const notPermitted = {
    code: "authorization.not_permitted",
    permission: "sale.refund",
    status: 403,
  };
  /** A receipt whose card refund, sent by another till, the box has waiting. */
  function waitingApi() {
    const api = fakeGiveBackApi(PENDING);
    api.getRefundableTenders.mockResolvedValue([WAITING_TENDER]);
    return api;
  }

  it("has the box ask the card company about that same refund, and says it is back once it is", async () => {
    const api = waitingApi();
    const { el } = await mount(api);
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
    check(el)!.click();
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(api.retryTenderRefund.mock.calls).toEqual([["refund-1", undefined]]);
    expect(choice(el, "goodwill")!.getAttribute("aria-disabled")).toBe("true");

    api.retryTenderRefund.mockResolvedValueOnce(refundAnswer({ state: "completed" }));
    api.readGiveBack.mockResolvedValueOnce(PENDING).mockResolvedValueOnce(VIEW);
    check(el)!.click();
    await vi.waitFor(() => expect(status(el)).toBe("€5.00 is refunded to card ···4242."));
    expect(choice(el, "goodwill")!.tagName).toBe("WT-CHOICE-ROW");
    expect(check(el)).toBeNull();
    expect(api.retryTenderRefund).toHaveBeenCalledTimes(2);
    expect(api.giveBack).not.toHaveBeenCalled();
    expect(api.refundTransaction).not.toHaveBeenCalled();
    await choose(el, "goodwill");
    root(el).querySelector<HTMLElement>("[data-back]")!.click();
    await el.updateComplete;
    expect(status(el)).toBe("");
  });

  it("only reads the receipt when the box has settled the refund meanwhile, asking the card company nothing", async () => {
    const api = waitingApi();
    const { el } = await mount(api);
    api.readGiveBack.mockResolvedValueOnce(VIEW);
    check(el)!.click();
    await vi.waitFor(() => expect(check(el)).toBeNull());
    expect(status(el)).toBe("");
    expect(api.getRefundableTenders).not.toHaveBeenCalled();
    expect(api.retryTenderRefund).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "tender_refund.failed"],
    ["provider_balance_unavailable", "refund.provider_balance_unavailable"],
  ] as const)(
    "says the card company did not make it (reason %s), and offers the choices again",
    async (refusalReason, key) => {
      const api = waitingApi();
      const { el } = await mount(api);
      api.retryTenderRefund.mockResolvedValueOnce(
        refundAnswer({ state: "failed", ...(refusalReason && { refusalReason }) }),
      );
      api.readGiveBack.mockResolvedValueOnce(PENDING).mockResolvedValueOnce(VIEW);
      check(el)!.click();
      await vi.waitFor(() => expect(status(el)).toContain(t(key)));
      expect(status(el)).toContain(t("tender_refund.failed"));
      expect(status(el).includes(t("refund.provider_balance_unavailable"))).toBe(
        refusalReason !== undefined,
      );
      expect(choice(el, "goodwill")!.tagName).toBe("WT-CHOICE-ROW");
    },
  );

  it("names no card number when the card has none, and keeps the outcome when the receipt cannot be read after it", async () => {
    const api = waitingApi();
    api.getRefundableTenders.mockResolvedValue([{ ...WAITING_TENDER, last4: null }]);
    const { el } = await mount(api);
    api.retryTenderRefund.mockResolvedValueOnce(
      refundAnswer({ state: "completed", appliedAmount: "4.00", tipAmount: "1.50" }),
    );
    api.readGiveBack
      .mockResolvedValueOnce(PENDING)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    check(el)!.click();
    await vi.waitFor(() =>
      expect(status(el)).toBe(`€5.50 is refunded to the card. ${t("tender_refund.read_failed")}`),
    );
    expect(check(el)).not.toBeNull();
  });

  it("asks an approver when the person signed in may not, then asks the card company with their PIN", async () => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce(notPermitted);
    const { el } = await mount(api);
    check(el)!.click();
    await vi.waitFor(() => expect(prompt(el)).not.toBeNull());
    expect(api.listApprovers).toHaveBeenCalledWith(["sale.refund"], {
      signal: expect.any(AbortSignal),
    });
    api.retryTenderRefund.mockRejectedValueOnce({ code: "pin.invalid", status: 401 });
    approve(el);
    await vi.waitFor(() => expect(prompt(el)!.error).not.toBeNull());
    api.retryTenderRefund.mockResolvedValueOnce(refundAnswer({ state: "completed" }));
    api.readGiveBack.mockResolvedValueOnce(PENDING).mockResolvedValueOnce(VIEW);
    approve(el);
    await vi.waitFor(() => expect(status(el)).toBe("€5.00 is refunded to card ···4242."));
    expect(prompt(el)).toBeNull();
    const approver = { personId: "boss", pin: "1234" };
    expect(api.retryTenderRefund.mock.calls).toEqual([
      ["refund-1", undefined],
      ["refund-1", approver],
      ["refund-1", approver],
    ]);
  });

  it("asks the card company nothing when the approver step is cancelled, and still offers Check again", async () => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce(notPermitted);
    const { el } = await mount(api);
    check(el)!.click();
    await vi.waitFor(() => expect(prompt(el)).not.toBeNull());
    prompt(el)!.dispatchEvent(new CustomEvent("override-cancel"));
    await el.updateComplete;
    expect(prompt(el)).toBeNull();
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
    expect(check(el)!.disabled).toBe(false);
  });

  it.each([
    ["the box's answer is lost", () => new TypeError("Failed to fetch"), "give_back.uw_unknown"],
    [
      "the refund is one the box does not know",
      () => ({ code: "tender.refund_not_found", status: 404 }),
      "tender.refund_not_found",
    ],
    [
      "the box's disk is full",
      () => ({ code: "storage.disk_full", status: 507 }),
      "storage.disk_full",
    ],
    [
      "the box's time is not confirmed",
      () => ({ code: "clock.unconfirmed", status: 409 }),
      "clock.unconfirmed",
    ],
  ] as const)("says so when %s, claiming nothing about the money", async (_what, error, said) => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce(error());
    const { el } = await mount(api);
    check(el)!.click();
    await vi.waitFor(() =>
      expect(status(el)).toBe(said === "give_back.uw_unknown" ? t(said) : codeMessage(said, "en")),
    );
    expect(check(el)!.disabled).toBe(false);
    check(el)!.click();
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.pending_unanswered")));
    expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1", "refund-1"]);
  });

  it("says who may approve could not be read, pointing at Check again", async () => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce(notPermitted);
    api.listApprovers.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mount(api);
    check(el)!.click();
    await vi.waitFor(() => expect(status(el)).toBe(t("give_back.uw_approvers_failed")));
    expect(prompt(el)).toBeNull();
  });

  it("tells the till the sign-in ended when the asking is refused for it", async () => {
    const api = waitingApi();
    api.retryTenderRefund.mockRejectedValueOnce({ code: "session.required", status: 401 });
    const { el } = await mount(api);
    const signedOut = vi.fn();
    el.addEventListener("give-back-signed-out", signedOut);
    check(el)!.click();
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
  });

  it("asks once when pressed twice, and keeps the window open until that is answered", async () => {
    const api = waitingApi();
    const { el } = await mount(api);
    const answer = deferred<ReturnType<typeof refundAnswer>>();
    api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
    const held = vi.fn();
    el.addEventListener("give-back-held", (event) => held((event as CustomEvent).detail.held));
    check(el)!.click();
    check(el)!.click();
    await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
    await el.updateComplete;
    check(el)!.click();
    expect(check(el)!.disabled).toBe(true);
    const dialog = root(el).querySelector("wt-dialog")!;
    expect(dialog.dismissible).toBe(false);
    root(el).querySelector<HTMLElement>("[data-close]")!.click();
    await dialog.updateComplete;
    expect(dialog.open).toBe(true);
    expect(held.mock.calls).toEqual([[true]]);

    answer.resolve(refundAnswer({ state: "completed" }));
    api.readGiveBack.mockResolvedValueOnce(VIEW);
    await vi.waitFor(() => expect(status(el)).toBe("€5.00 is refunded to card ···4242."));
    expect(api.readGiveBack).toHaveBeenCalledTimes(3);
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
    expect(dialog.dismissible).toBe(true);
    expect(held.mock.calls).toEqual([[true]]);
  });

  it("asks no approver when the window is taken away while the asking is out", async () => {
    const api = waitingApi();
    const { el } = await mount(api);
    const answer = deferred<ReturnType<typeof refundAnswer>>();
    api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
    check(el)!.click();
    await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
    el.remove();
    answer.reject(notPermitted);
    await vi.waitFor(() => expect(api.listApprovers).toHaveBeenCalledOnce());
    await api.listApprovers.mock.results[0]!.value;
    await el.updateComplete;
    expect(prompt(el)).toBeNull();
    expect(api.retryTenderRefund).toHaveBeenCalledOnce();
  });

  const reads = [
    ["the receipt is", "readGiveBack", PENDING],
    ["its payments are", "getRefundableTenders", [WAITING_TENDER]],
  ] as const;
  it.each(reads)(
    "asks the card company nothing, sending no approver's PIN, when the window is taken away while %s read",
    async (_what, read, answer) => {
      const api = waitingApi();
      api.retryTenderRefund.mockRejectedValueOnce(notPermitted);
      const { el } = await mount(api);
      check(el)!.click();
      await vi.waitFor(() => expect(prompt(el)).not.toBeNull());
      const held = deferred<never>();
      api[read].mockClear();
      api[read].mockImplementationOnce(() => held.promise);
      const ended = checkEnded(el);
      approve(el);
      await vi.waitFor(() => expect(api[read]).toHaveBeenCalledOnce());
      el.remove();
      held.resolve(answer as never);
      await ended();
      expect(api.retryTenderRefund.mock.calls).toEqual([["refund-1", undefined]]);
    },
  );

  it("asks about no further refund when the window is taken away while one is asked about", async () => {
    const api = waitingApi();
    api.getRefundableTenders.mockResolvedValue([
      WAITING_TENDER,
      { ...WAITING_TENDER, tenderId: "card-2", pendingRefundId: "refund-2" },
    ]);
    const { el } = await mount(api);
    const answer = deferred<ReturnType<typeof refundAnswer>>();
    api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
    const ended = checkEnded(el);
    check(el)!.click();
    await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
    el.remove();
    answer.resolve(refundAnswer({ state: "completed" }));
    await ended();
    expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1"]);
  });

  it("tells the till the sign-in ended when that refuses a later refund, though one was answered", async () => {
    const api = waitingApi();
    api.getRefundableTenders.mockResolvedValue([
      WAITING_TENDER,
      { ...WAITING_TENDER, tenderId: "card-2", pendingRefundId: "refund-2" },
    ]);
    api.retryTenderRefund
      .mockResolvedValueOnce(refundAnswer({ state: "completed" }))
      .mockRejectedValueOnce({ code: "session.required", status: 401 });
    const { el } = await mount(api);
    const signedOut = vi.fn();
    el.addEventListener("give-back-signed-out", signedOut);
    check(el)!.click();
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
  });

  it("offers no Check again while nothing waits for the card company", async () => {
    const { el } = await mount();
    expect(check(el)).toBeNull();
  });
});

describe("How it goes back", () => {
  it("offers each payment up to what it holds, and shows a held one unavailable with its line", async () => {
    const held = { code: "tender.refund_in_progress" };
    const { el } = await mount(
      withView({ ways: [CASH, { ...CARD, pending: true, reason: held }] }),
    );
    await choose(el, "goodwill");
    expect(text(root(el).querySelector("[data-how] legend"))).toBe("How to refund");
    expect(text(way(el, "cash")!.closest("label"))).toBe("Cash · up to €30.00");
    expect(text(way(el, "card-1")!.closest("label"))).toBe("Card ···4242 · up to €17.00");
    expect(way(el, "cash")!.checked).toBe(true);
    expect(way(el, "card-1")!.disabled).toBe(true);
    expect(text(root(el).querySelector('[data-way-reason="card-1"]'))).toBe(
      codeMessage(held.code, "en"),
    );
  });

  it("says up to what can go back on goodwill, all the money left", async () => {
    const { el } = await mount();
    await choose(el, "goodwill");
    expect(amountField(el).value).toBe("");
    expect(text(root(el).querySelector("[data-up-to]"))).toBe("Refund up to €47.00.");
  });

  it("treats a payment this device does not take as held, and picks the next", async () => {
    const { el } = await mount(withView({ ways: [{ ...CASH, allowedHere: false }, CARD] }));
    await choose(el, "goodwill");
    expect(way(el, "cash")!.disabled).toBe(true);
    expect(text(root(el).querySelector("[data-way-reason=cash]"))).toBe(
      t("give_back.way_not_here"),
    );
    expect(way(el, "card-1")!.checked).toBe(true);
    await reason(el, "complaint");
    await type(el, "5");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(asksOf(el)).toHaveLength(1));
    expect(asksOf(el)[0]!.request.way).toBe("card-1");
  });
});

describe("the extra paid on top", () => {
  it("fills the extra in, offers only payments holding one, and previews it alone", async () => {
    const { el, api } = await mount();
    await choose(el, "extra");
    expect(amountField(el).label).toBe("Extra to refund");
    expect(amountField(el).value).toBe("3.00");
    expect(way(el, "cash")).toBeNull();
    expect(text(way(el, "card-1")!.closest("label"))).toBe("Card ···4242 · up to €3.00");
    expect(root(el).querySelector("wt-switch[name=extra]")).toBeNull();
    await vi.waitFor(() =>
      expect(api.previewGiveBack).toHaveBeenLastCalledWith("sale-1", {
        purpose: "extra",
        amount: "3.00",
        extra: "0.00",
        way: "card-1",
      }),
    );
  });
});

describe("the summary", () => {
  async function ready(api = fakeGiveBackApi()) {
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "10");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    return el;
  }

  it("says what goes back in cash, with no PIN line when none is needed", async () => {
    const el = await ready();
    expect(text(root(el).querySelector("[data-summary-total]"))).toBe("€10.00");
    expect(text(root(el).querySelector("[data-summary-way]"))).toBe(
      "€10.00 is refunded in cash. The cash drawer opens: hand it over.",
    );
    expect(root(el).querySelector("[data-pin]")).toBeNull();
    expect(root(el).querySelector("[data-summary-rest]")).toBeNull();
    expect(text(submit(el))).toBe("Refund €10.00");
  });

  it("names the card, the PIN step and what stays under way from the preview", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockImplementation(async (_saleId: string, request: GiveBackRequest) => ({
      ...previewFor(request),
      parts: [{ kind: "correction", amount: "7.00", way: request.way, lineIds: [] }],
      leftUnderWay: "3.00",
      needs: ["sale.rectify"],
    }));
    const el = await ready(api);
    way(el, "card-1")!.click();
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toBe(
        "€7.00 is refunded to card ···4242 by the card reader.",
      ),
    );
    expect(text(root(el).querySelector("[data-summary-rest]"))).toBe(
      "€3.00 cannot be refunded this way: it stays under way for other payments.",
    );
    expect(text(root(el).querySelector("[data-pin]"))).toBe(
      "If you cannot give refunds yourself, a supervisor or manager approves it with their PIN next.",
    );
  });

  it("says a hand-keyed card goes back on the separate terminal", async () => {
    const api = withView({ ways: [CASH, { ...CARD, manual: true }] });
    api.previewGiveBack.mockImplementation(async (_saleId: string, request: GiveBackRequest) => ({
      ...previewFor(request),
      manual: true,
    }));
    const el = await ready(api);
    way(el, "card-1")!.click();
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toBe(
        "€10.00 is refunded to card ···4242 on the separate card terminal.",
      ),
    );
  });

  it("puts a wait the preview finds at the bottom, and no summary", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue({ code: "clock.unconfirmed" });
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "10");
    await vi.waitFor(() => expect(bottom(el)).toBe(codeMessage("clock.unconfirmed", "en")));
    expect(summary(el)).toBeNull();
  });

  it("says a preview that could not reach the box could not be checked", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "5");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.preview_failed")));
  });
});

describe("Give back", () => {
  it("stays disabled until a dish is ticked", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    expect(submit(el).disabled).toBe(true);
    await tick(el, "croquetas");
    expect(submit(el).disabled).toBe(false);
  });

  it("marks what is missing on the first press and stays disabled until it is fixed", async () => {
    const { el } = await mount();
    await choose(el, "goodwill");
    submit(el).click();
    await el.updateComplete;
    expect(amountField(el).error).not.toBe("");
    expect(
      root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=reason]")!
        .error,
    ).toBe(t("adjust.reason_required"));
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(submit(el).disabled).toBe(true);
    await type(el, "10");
    expect(submit(el).disabled).toBe(true);
    await reason(el, "complaint");
    expect(submit(el).disabled).toBe(false);
    expect(bottom(el)).toBe("");
  });

  it("is drawn quiet until the box checked the money back and a reason is chosen, and in its own colour from then until its press is answered", async () => {
    const api = fakeGiveBackApi();
    const check = deferred<GiveBackPreview>();
    api.previewGiveBack.mockImplementationOnce(() => check.promise);
    const answer = deferred<never>();
    api.giveBack.mockImplementationOnce(() => answer.promise);
    const { el } = await mount(api);
    await choose(el, "goodwill");
    expect(submit(el).variant).toBe("secondary");
    await type(el, "5");
    await vi.waitFor(() => expect(api.previewGiveBack).toHaveBeenCalledOnce());
    await reason(el, "complaint");
    expect(submit(el).variant).toBe("secondary");
    check.resolve(previewFor(api.previewGiveBack.mock.calls[0]![1]));
    await vi.waitFor(() => expect(submit(el).variant).toBe("primary"));
    expect(submit(el).disabled).toBe(false);
    await reason(el, "");
    expect(summary(el)).not.toBeNull();
    expect(submit(el).variant).toBe("secondary");
    await reason(el, "complaint");
    expect(submit(el).variant).toBe("primary");
    submit(el).click();
    await vi.waitFor(() => expect(submit(el).loading).toBe(true));
    expect(submit(el).variant).toBe("primary");
  });

  it("is drawn quiet while a field a press marked is not fixed", async () => {
    const { el } = await mount();
    await choose(el, "goodwill");
    await type(el, "5");
    await reason(el, "other");
    await vi.waitFor(() => expect(submit(el).variant).toBe("primary"));
    submit(el).click();
    await vi.waitFor(() => expect(submit(el).disabled).toBe(true));
    expect(summary(el)).not.toBeNull();
    expect(submit(el).variant).toBe("secondary");
    await reason(el, "complaint");
    expect(submit(el).variant).toBe("primary");
  });

  it.each(["0", "0.00", "-1", "0.001", "abc", "1,000.00"])(
    "refuses the amount %s under the amount, asking the box nothing and giving nothing back",
    async (amount) => {
      const { el, api } = await mount();
      await choose(el, "goodwill");
      await reason(el, "complaint");
      amountField(el).dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: amount }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      submit(el).click();
      await vi.waitFor(() =>
        expect(amountField(el).error).toBe(
          t("give_back.amount_invalid").replace("{amount}", formatMoney("47.00", "en")),
        ),
      );
      expect(submit(el).disabled).toBe(true);
      expect(api.previewGiveBack).not.toHaveBeenCalled();
      expect(api.giveBack).not.toHaveBeenCalled();
    },
  );

  it("hands on what was previewed when pressed", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    await tick(el, "paella");
    await reason(el, "complaint");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(asksOf(el)).toHaveLength(1));
    expect(asksOf(el)[0]).toEqual({
      request: {
        purpose: "dishes",
        lineIds: ["paella"],
        amount: "20.00",
        extra: "0.00",
        way: "cash",
      },
      reasonId: "complaint",
      note: null,
      expected: [{ kind: "refund", amount: "20.00", way: "cash" }],
    });
  });

  it("hands on the preview's parts with their cancels and dishes", async () => {
    const api = fakeGiveBackApi();
    const parts = [
      { kind: "refund" as const, amount: "20.00", way: "cash", cancellationIds: ["cancel-1"] },
      { kind: "correction" as const, amount: "5.00", way: "cash", lineIds: ["croquetas"] },
    ];
    api.previewGiveBack.mockImplementation(async (_saleId: string, request: GiveBackRequest) => ({
      ...previewFor(request),
      parts,
    }));
    const { el } = await mount(api);
    await choose(el, "dishes");
    await tick(el, "paella");
    await tick(el, "croquetas");
    await type(el, "25");
    await reason(el, "complaint");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(asksOf(el)).toHaveLength(1));
    expect(asksOf(el)[0]!.expected).toEqual(parts);
  });
});

describe("in Spanish", () => {
  beforeEach(() => setLocale("es-ES"));

  it("words the choice, a dish and the extra from the approved screens", async () => {
    const said = (key: keyof typeof es, amount = "", card = "") =>
      es[key]
        .replace("{amount}", () => formatMoney(amount, "es-ES"))
        .replace("{card}", () => card)
        .replace(/\s+/g, " ")
        .trim();
    const { el } = await mount();
    expect(text(root(el).querySelector("[data-what-for]"))).toBe(said("give_back.what_for"));
    expect([...root(el).querySelectorAll("wt-choice-row")].map((row) => row.heading)).toEqual([
      said("give_back.dishes"),
      said("give_back.goodwill"),
      said("give_back.extra"),
    ]);
    expect(text(choice(el, "extra"))).toBe(said("give_back.extra_hint", "3.00"));
    await choose(el, "dishes");
    expect(text(root(el).querySelector("[data-which]"))).toBe(said("give_back.which"));
    expect(dish(el, "paella")!.description).toBe(said("give_back.cancelled_owed"));
    expect(dish(el, "salad")!.description).toBe(said("give_back.cancelled_back"));
    expect(text(root(el).querySelector("[data-free=cake]"))).toContain(
      said("give_back.given_free"),
    );
    expect(amountField(el).label).toBe(said("give_back.amount"));
    expect(text(way(el, "cash")!.closest("label"))).toBe(said("give_back.way_cash", "30.00"));
    way(el, "card-1")!.click();
    await el.updateComplete;
    expect(
      root(el)
        .querySelector<HTMLElementTagNameMap["wt-switch"]>("wt-switch[name=extra]")!
        .label.replace(/\s+/g, " "),
    ).toBe(said("give_back.extra_too", "3.00"));
    await tick(el, "croquetas");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toBe(
        said("give_back.summary_card", "8.00", "···4242"),
      ),
    );
    expect(text(submit(el))).toBe(said("give_back.submit", "8.00"));
  });

  it("words a cancelled dish's money still waiting for the card company", async () => {
    const salad = VIEW.lines.find((line) => line.id === "salad")!;
    const waiting = { ...salad, cancelled: { ...salad.cancelled!, waiting: "9.50" } };
    const { el } = await mount(
      withView({ lines: VIEW.lines.map((line) => (line.id === "salad" ? waiting : line)) }),
    );
    await choose(el, "dishes");
    expect(dish(el, "salad")!.description).toBe(es["give_back.cancelled_waiting"]);
  });

  it("words Check again and its answer while a card refund waits", async () => {
    const held = { code: "tender.refund_in_progress" };
    const api = withView({ ways: [{ ...CARD, pending: true, reason: held }] });
    const { el } = await mount(api);
    const check = root(el).querySelector("[data-check-pending]")!;
    expect(text(check)).toBe(es["give_back.check_again"]);
    (check as HTMLElement).click();
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-pending-status]"))).toBe(
        es["give_back.pending_unanswered"],
      ),
    );
  });
});

describe("choosing and changing", () => {
  it("empties the amount when the last dish is unticked", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    await tick(el, "croquetas");
    await tick(el, "croquetas");
    expect(amountField(el).value).toBe("");
    expect(submit(el).disabled).toBe(true);
  });

  it("chooses no payment when every one must wait, and Give back stays disabled", async () => {
    const held = { code: "tender.refund_unavailable" };
    const { el, api } = await mount(
      withView({
        ways: [
          { ...CASH, reason: held },
          { ...CARD, reason: held },
        ],
      }),
    );
    await choose(el, "goodwill");
    expect(way(el, "cash")!.checked).toBe(false);
    await type(el, "5");
    expect(submit(el).disabled).toBe(true);
    expect(api.previewGiveBack).not.toHaveBeenCalled();
  });

  it("drops the extra when the payment changes to one with none", async () => {
    const other = { ...CARD, way: "card-2", last4: null, moneyLeft: "5.00", extraLeft: "1.50" };
    const { el, api } = await mount(withView({ ways: [CASH, CARD, other] }));
    await choose(el, "dishes");
    await tick(el, "croquetas");
    way(el, "card-1")!.click();
    await el.updateComplete;
    root(el).querySelector("wt-switch[name=extra]")!.shadowRoot!.querySelector("input")!.click();
    await el.updateComplete;
    way(el, "cash")!.click();
    await el.updateComplete;
    expect(root(el).querySelector("wt-switch[name=extra]")).toBeNull();
    await vi.waitFor(() =>
      expect(api.previewGiveBack).toHaveBeenLastCalledWith(
        "sale-1",
        expect.objectContaining({ way: "cash", extra: "0.00" }),
      ),
    );
    expect(text(way(el, "card-2")!.closest("label"))).toBe("Card · up to €5.00");
  });

  it("refills the extra's amount per payment until one is typed", async () => {
    const other = { ...CARD, way: "card-2", last4: null, moneyLeft: "5.00", extraLeft: "1.50" };
    const { el } = await mount(withView({ ways: [CASH, CARD, other] }));
    await choose(el, "extra");
    expect(amountField(el).value).toBe("3.00");
    way(el, "card-2")!.click();
    await el.updateComplete;
    expect(amountField(el).value).toBe("1.50");
    await type(el, "1");
    way(el, "card-1")!.click();
    await el.updateComplete;
    expect(amountField(el).value).toBe("1");
  });

  it("names no card number where the payment has none", async () => {
    const api = withView({ ways: [{ ...CARD, last4: null }] });
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "2");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toBe(
        "€2.00 is refunded to card by the card reader.",
      ),
    );
  });

  it("keeps an older preview's late answer off the screen", async () => {
    const api = fakeGiveBackApi();
    let answerFirst: () => void = () => {};
    api.previewGiveBack.mockImplementationOnce(
      (_saleId: string, request: GiveBackRequest) =>
        new Promise((resolve) => {
          answerFirst = () => resolve({ ...previewFor(request), needs: ["sale.refund"] });
        }),
    );
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "4");
    await type(el, "5");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-total]"))).toBe("€5.00"),
    );
    answerFirst();
    await el.updateComplete;
    expect(root(el).querySelector("[data-pin]")).toBeNull();
  });
});

describe("the reason", () => {
  it("asks for a note where the reason needs one, and hands it on trimmed", async () => {
    const { el } = await mount();
    await choose(el, "goodwill");
    await type(el, "5");
    await reason(el, "other");
    submit(el).click();
    await el.updateComplete;
    const note = () =>
      root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!;
    expect(note().error).toBe(t("adjust.note_required"));
    const fillNote = async (value: string) => {
      await note().updateComplete;
      await userEvent.fill(page.elementLocator(note().shadowRoot!.querySelector("input")!), value);
      await el.updateComplete;
    };
    await fillNote("x".repeat(1000));
    expect(note().error).toBe(t("bill_refund.reason_long"));
    await fillNote("  Spilt wine  ");
    await vi.waitFor(() => expect(submit(el).disabled).toBe(false));
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(asksOf(el)).toHaveLength(1));
    expect(asksOf(el)[0]!.note).toBe("Spilt wine");
    expect(asksOf(el)[0]!.reasonId).toBe("other");
  });

  it("reads the reasons again when they could not be read", async () => {
    const api = fakeGiveBackApi();
    api.listAdjustmentReasons.mockRejectedValueOnce(new Error("offline"));
    const { el } = await mount(api);
    await choose(el, "goodwill");
    const retry = root(el).querySelector<HTMLElement>("[data-reasons-retry]");
    expect(retry).not.toBeNull();
    retry!.click();
    await vi.waitFor(() => expect(api.listAdjustmentReasons).toHaveBeenCalledTimes(2));
  });
});

describe("pressing before the preview answered", () => {
  function slowApi() {
    const api = fakeGiveBackApi();
    const pending: (() => void)[] = [];
    api.previewGiveBack.mockImplementation(
      (_saleId: string, request: GiveBackRequest) =>
        new Promise((resolve) => pending.push(() => resolve(previewFor(request)))),
    );
    return { api, pending };
  }

  it("waits for it, then hands on what it answered", async () => {
    const { api, pending } = slowApi();
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "6");
    submit(el).click();
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    pending.forEach((answer) => answer());
    await vi.waitFor(() => expect(asksOf(el)).toHaveLength(1));
    expect(asksOf(el)[0]!.request.amount).toBe("6.00");
  });

  it("hands nothing on when the form changed meanwhile, and says so", async () => {
    const { api, pending } = slowApi();
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "6");
    submit(el).click();
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    await type(el, "7");
    pending.forEach((answer) => answer());
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.changed_while_checking")));
    expect(asksOf(el)).toEqual([]);
  });

  it("hands nothing on when the preview refuses", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue({ code: "invoice_correction.refund_pending" });
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "6");
    submit(el).click();
    await vi.waitFor(() => expect(api.previewGiveBack).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    expect(asksOf(el)).toEqual([]);
    expect(bottom(el)).toBe(codeMessage("invoice_correction.refund_pending", "en"));
  });

  it("puts an amount the preview refuses under the amount", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue({ code: "invoice_correction.money_short" });
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "6");
    await vi.waitFor(() =>
      expect(amountField(el).error).toBe(codeMessage("invoice_correction.money_short", "en")),
    );
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(submit(el).disabled).toBe(false);
  });
});

describe("a fiscal conflict", () => {
  const conflict = {
    code: "sif.allocation_invalid",
    reason: "conflict_requires_administrator",
    recoveryUrl: "/recovery/fiscal-conflict",
  };
  const link = (el: TillGiveBackDialog) =>
    root(el).querySelector<HTMLAnchorElement>("wt-form-actions [data-recovery]");

  it("says new invoices are stopped and links to recovery when the check refuses", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue({ ...conflict, status: 409 });
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "5");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("recovery.issuance_stopped")));
    expect(link(el)!.getAttribute("href")).toBe("/recovery/fiscal-conflict");
    expect(text(link(el))).toBe(t("recovery.open"));
  });

  it("says so on each choice the read holds back, with the recovery link", async () => {
    const { code, ...params } = conflict;
    const closed = { available: false, reason: { code, params } };
    const { el } = await mount(
      withView({ choices: { dishes: closed, goodwill: closed, extra: closed } }),
    );
    expect(text(root(el).querySelector("[data-choice-reason=dishes]"))).toBe(
      t("recovery.issuance_stopped"),
    );
    expect(link(el)!.getAttribute("href")).toBe("/recovery/fiscal-conflict");
  });

  it("says nothing was given back when Give back is refused, with the recovery link", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({ ...conflict, status: 409 });
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "5");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(`${t("recovery.issuance_stopped")} ${t("give_back.nothing_given")}`),
    );
    expect(link(el)!.getAttribute("href")).toBe("/recovery/fiscal-conflict");
  });

  it("says so after part of the money went back, with the recovery link", async () => {
    const api = fakeGiveBackApi();
    const { code, ...params } = conflict;
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      refusal: { code, params },
    }));
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "5");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-outcome]"))).toContain(
        t("recovery.issuance_stopped"),
      ),
    );
    expect(link(el)!.getAttribute("href")).toBe("/recovery/fiscal-conflict");
  });
});

describe("closing", () => {
  it("does not close for a close event from something inside it", async () => {
    const { el } = await mount();
    const closes = vi.fn();
    el.addEventListener("give-back-close", closes);
    choice(el, "dishes")!.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(closes).not.toHaveBeenCalled();
  });

  it("offers no second read when the receipt refused to be read", async () => {
    const api = fakeGiveBackApi();
    api.readGiveBack.mockRejectedValue({ code: "sale.not_found" });
    const { el } = await mount(api);
    expect(bottom(el)).toBe(codeMessage("sale.not_found", "en"));
    expect(root(el).querySelector("[data-reload]")).toBeNull();
  });
});

describe("sending", () => {
  type Api = ReturnType<typeof fakeGiveBackApi>;
  const approval = (el: TillGiveBackDialog) =>
    root(el).querySelector<HTMLElementTagNameMap["till-supervisor-override-dialog"]>(
      "till-supervisor-override-dialog",
    );
  async function approve(el: TillGiveBackDialog, pin = "1234") {
    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    approval(el)!.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "boss", pin } }),
    );
    await el.updateComplete;
  }
  const outcomeText = (el: TillGiveBackDialog) => text(root(el).querySelector("[data-outcome]"));
  /** Whether the window last said it holds back the full-disk screen. */
  function holding() {
    const seen = vi.fn<(held: boolean) => void>();
    const listen = (event: Event) => seen((event as CustomEvent<{ held: boolean }>).detail.held);
    document.addEventListener("give-back-held", listen);
    onTestFinished(() => document.removeEventListener("give-back-held", listen));
    return () => seen.mock.lastCall?.[0] ?? false;
  }
  const sent = (api: Api, index = 0) => api.giveBack.mock.calls[index]![1];
  /** As `ready`, with Give back pressed. */
  async function press(api: Api, wayId = "cash", amount = "5") {
    const el = await ready(api, wayId, amount);
    submit(el).click();
    return el;
  }
  /** Goodwill of `amount` from `wayId`, its preview answered, not pressed yet. */
  async function ready(api: Api, wayId = "cash", amount = "5") {
    const { el } = await mount(api);
    await choose(el, "goodwill");
    if (wayId !== "cash") {
      way(el, wayId)!.click();
      await el.updateComplete;
    }
    await reason(el, "complaint");
    await type(el, amount);
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    return el;
  }
  const answering = (api: Api, over: Partial<GiveBackPreview>) =>
    api.previewGiveBack.mockImplementation(async (_saleId: string, request: GiveBackRequest) => ({
      ...previewFor(request),
      ...over,
    }));

  it("gives cash back with no PIN, under saved ids, and says it is back", async () => {
    const api = fakeGiveBackApi();
    const el = await press(api);
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(api.giveBack).toHaveBeenCalledOnce();
    expect(sent(api)).toMatchObject({
      request: { purpose: "goodwill", amount: "5.00", extra: "0.00", way: "cash" },
      reasonId: "complaint",
      note: null,
      expected: [{ kind: "refund", amount: "5.00", way: "cash" }],
    });
    expect(Object.values(sent(api).submissionIds)).toHaveLength(4);
    expect(sent(api).override).toBeUndefined();
    expect(api.listApprovers).not.toHaveBeenCalled();
    expect(outcomeText(el)).not.toContain(t("give_back.print_later"));
  });

  it("says a card correction's receipt prints from Find a bill, and a cash one's prints itself", async () => {
    const parts = (way: string): GiveBackPreview["parts"] => [
      { kind: "correction", amount: "5.00", way, lineIds: [] },
    ];
    const card = fakeGiveBackApi();
    answering(card, { parts: parts("card-1") });
    const onCard = await press(card, "card-1");
    await vi.waitFor(() =>
      expect(outcomeText(onCard)).toContain("€5.00 is refunded to card ···4242."),
    );
    expect(outcomeText(onCard)).toContain(t("give_back.print_later"));
    cleanupWidgets();
    localStorage.clear();
    const cash = fakeGiveBackApi();
    answering(cash, { parts: parts("cash") });
    const inCash = await press(cash);
    await vi.waitFor(() =>
      expect(outcomeText(inCash)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(outcomeText(inCash)).not.toContain(t("give_back.print_later"));
  });

  it("says a full invoice's card correction prints from Find a bill as its corrective invoice", async () => {
    const api = fakeGiveBackApi();
    answering(api, { parts: [{ kind: "correction", amount: "5.00", way: "card-1", lineIds: [] }] });
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.print_later")));
    el.fullInvoice = true;
    await el.updateComplete;
    expect(outcomeText(el)).toContain("Its corrective invoice can be printed from Find a bill.");
    expect(outcomeText(el)).not.toContain(t("give_back.print_later"));
  });

  it("asks for an approver holding every right the preview needs, then sends the PIN", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund", "sale.rectify"] });
    const el = await press(api);
    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    expect(api.listApprovers).toHaveBeenCalledWith(["sale.refund", "sale.rectify"], {
      signal: expect.any(AbortSignal),
    });
    expect(approval(el)!.authorizers).toEqual([{ personId: "boss", displayName: "Boss" }]);
    expect(api.giveBack).not.toHaveBeenCalled();
    await approve(el);
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(sent(api).override).toEqual({ personId: "boss", pin: "1234" });
    expect(approval(el)).toBeNull();
  });

  it("shows a PIN lock-out in the prompt, sending nothing more and showing no outcome", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    api.giveBack.mockRejectedValueOnce({ code: "pin.throttled", retryAfterSeconds: 5 });
    const el = await press(api);
    await approve(el, "0000");
    await vi.waitFor(() =>
      expect(approval(el)!.error).toEqual({
        code: "pin.throttled",
        personId: "boss",
        retryAfterSeconds: 5,
      }),
    );
    expect(api.giveBack).toHaveBeenCalledOnce();
    expect(root(el).querySelector("[data-outcome]")).toBeNull();
  });

  it("shows a wrong PIN in place and sends the same press again under the same ids", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
    const el = await press(api);
    await approve(el, "0000");
    await vi.waitFor(() =>
      expect(approval(el)!.error).toEqual({ code: "pin.invalid", personId: "boss" }),
    );
    expect(root(el).querySelector("[data-outcome]")).toBeNull();
    await approve(el, "1234");
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(sent(api, 1).submissionIds).toEqual(sent(api, 0).submissionIds);
  });

  it.each([
    [{ code: "authorization.not_permitted", permission: "sale.rectify" }, "sale.rectify"],
    [{ code: "tender.manual_refund_pin_required" }, "sale.refund"],
  ])(
    "asks for an approver when the write refuses %o, which the preview did not name",
    async (refusal, right) => {
      const api = fakeGiveBackApi();
      api.giveBack.mockRejectedValueOnce({ ...refusal, status: 403 });
      const el = await press(api);
      await approve(el);
      await vi.waitFor(() =>
        expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
      );
      expect(api.listApprovers).toHaveBeenCalledWith([right], { signal: expect.any(AbortSignal) });
      expect(sent(api, 1).override).toEqual({ personId: "boss", pin: "1234" });
    },
  );

  it("goes back to the form, sending nothing, when the approver step is cancelled", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    const el = await press(api);
    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    approval(el)!.dispatchEvent(new CustomEvent("override-cancel"));
    await el.updateComplete;
    expect(approval(el)).toBeNull();
    expect(api.giveBack).not.toHaveBeenCalled();
    expect(amountField(el).value).toBe("5");
  });

  it("says the approvers could not be read, and sends nothing", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    api.listApprovers.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const el = await press(api);
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.approvers_failed")));
    expect(approval(el)).toBeNull();
    expect(api.giveBack).not.toHaveBeenCalled();
  });

  it("gives up reading who may approve at the time limit, says so and sends nothing", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    api.listApprovers.mockImplementationOnce(
      (_permission, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const el = await ready(api);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      submit(el).click();
      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1);
      await el.updateComplete;
      expect(api.listApprovers).toHaveBeenCalledOnce();
      expect(bottom(el)).toBe("");

      await vi.advanceTimersByTimeAsync(1);
      await el.updateComplete;

      expect(bottom(el)).toBe(t("give_back.approvers_failed"));
      expect(approval(el)).toBeNull();
      expect(api.giveBack).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the press could not be saved, and sends nothing", async () => {
    const api = fakeGiveBackApi();
    const el = await ready(api);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    submit(el).click();
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.storage")));
    expect(api.giveBack).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("shows the separate terminal's step only once the preview answered, and records it with a PIN", async () => {
    const api = fakeGiveBackApi({ ...VIEW, ways: [CASH, { ...CARD, manual: true }] });
    let answer!: (preview: GiveBackPreview) => void;
    const { el } = await mount(api);
    await choose(el, "goodwill");
    way(el, "card-1")!.click();
    await el.updateComplete;
    await reason(el, "complaint");
    api.previewGiveBack.mockImplementation(
      (_saleId: string, request: GiveBackRequest) =>
        new Promise<GiveBackPreview>((resolve) => {
          answer = (preview) => resolve({ ...preview, parts: previewFor(request).parts });
        }),
    );
    await type(el, "10");
    submit(el).click();
    await el.updateComplete;
    expect(root(el).querySelector("[data-terminal]")).toBeNull();
    answer({
      ...previewFor({ purpose: "goodwill", amount: "10.00", extra: "0.00", way: "card-1" }),
      manual: true,
    });
    await vi.waitFor(() => expect(root(el).querySelector("[data-terminal]")).not.toBeNull());
    const step = text(root(el).querySelector("[data-terminal]"));
    expect(step).toContain("Refund it on the separate card terminal");
    expect(step).toContain("€10.00");
    expect(step).toContain(
      "This card was keyed on a separate card terminal, so Waitron cannot refund it itself. Refund €10.00 on that terminal now, then confirm it here.",
    );
    expect(step).toContain("A supervisor or manager then approves recording it with their PIN.");
    root(el).querySelector<HTMLElement>("[data-terminal-back]")!.click();
    await el.updateComplete;
    expect(root(el).querySelector("[data-terminal]")).toBeNull();
    submit(el).click();
    await vi.waitFor(() => expect(root(el).querySelector("[data-terminal]")).not.toBeNull());
    const done = root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(
      "wt-switch[name=terminal-done]",
    )!;
    expect(done.label).toBe("I have refunded €10.00 on the separate card terminal *");
    const record = root(el).querySelector<HTMLElement>("[data-record]")!;
    record.click();
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-terminal-error]"))).toBe(
      t("give_back.terminal_required"),
    );
    expect(api.listApprovers).not.toHaveBeenCalled();
    done.shadowRoot!.querySelector("input")!.click();
    await el.updateComplete;
    record.click();
    await approve(el);
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain(
        "€10.00 refunded on the separate card terminal is recorded.",
      ),
    );
    expect(api.listApprovers).toHaveBeenCalledWith(["sale.refund"], {
      signal: expect.any(AbortSignal),
    });
    expect(sent(api)).toMatchObject({
      manualConfirmed: true,
      override: { personId: "boss", pin: "1234" },
    });
  });

  it("shows a saved card refund and its Check again when the receipt cannot be read", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [{ kind: "refund", amount: "5.00", state: "pending", refundId: "refund-1" }],
    }));
    const el = await press(api, "card-1");
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 is waiting for the card company's answer."),
    );
    cleanupWidgets();
    api.readGiveBack.mockRejectedValue(new TypeError("Failed to fetch"));
    const { el: reopened } = await mount(api);
    await vi.waitFor(() => expect(api.readGiveBack).toHaveBeenCalledTimes(2));
    await reopened.updateComplete;

    expect(outcomeText(reopened)).toContain("€5.00 is waiting for the card company's answer.");
    expect(root(reopened).querySelector("[data-reload]")).toBeNull();
    root(reopened).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(reopened)).toContain(
        t("give_back.done_card_any").replace("{amount}", "€5.00"),
      ),
    );
    expect(api.getTenderRefund).toHaveBeenLastCalledWith("refund-1", {});
    expect(root(reopened).querySelector("[data-check-again]")).toBeNull();
    expect(new GiveBackSession(SCOPE, api).read("sale-1")).toBeNull();
  });

  it("offers Check again for a card refund left waiting, and says once it is back", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [{ kind: "refund", amount: "5.00", state: "pending", refundId: "refund-1" }],
    }));
    api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
    const el = await press(api, "card-1");
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 is waiting for the card company's answer."),
    );
    const again = () => root(el).querySelector<HTMLElement>("[data-check-again]");
    again()!.click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.still_waiting")));
    cleanupWidgets();
    const { el: reopened } = await mount(api);
    expect(outcomeText(reopened)).toContain("€5.00 is waiting for the card company's answer.");
    reopened.shadowRoot!.querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(reopened)).toContain("€5.00 is refunded to card ···4242."),
    );
    expect(api.getTenderRefund).toHaveBeenLastCalledWith("refund-1", {});
    expect(reopened.shadowRoot!.querySelector("[data-check-again]")).toBeNull();
    expect(new GiveBackSession(SCOPE, api).read("sale-1")).toBeNull();
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("says a card refund left waiting failed when the card company did not make it", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [{ kind: "refund", amount: "5.00", state: "pending", refundId: "refund-1" }],
    }));
    api.getTenderRefund.mockResolvedValueOnce({ state: "failed" });
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain(codeMessage("give_back.refund_failed", "en")),
    );
    expect(outcomeText(el)).not.toContain("waiting");
  });

  it("names no card number in the outcome when the card has none", async () => {
    const api = fakeGiveBackApi({ ...VIEW, ways: [CASH, { ...CARD, last4: null }] });
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(outcomeText(el)).toContain("€5.00 is refunded to the card."));
  });

  it("counts an open correction as under way, not as waiting for the card company", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [
        { kind: "refund", amount: "2.00", state: "completed", refundId: "refund-1" },
        { kind: "correction", amount: "3.00", state: "pending", correctionId: "c-1" },
      ],
    }));
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(outcomeText(el)).toContain("€2.00 is refunded to card ···4242."));
    expect(outcomeText(el)).not.toContain("waiting");
    expect(root(el).querySelector("[data-check-again]")).toBeNull();
  });

  it("forgets a first send refused for its PIN when the approver step is cancelled", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    api.giveBack.mockRejectedValueOnce({ code: "pin.invalid", status: 403 });
    const el = await press(api);
    await approve(el, "0000");
    await vi.waitFor(() => expect(approval(el)!.error).not.toBeNull());
    approval(el)!.dispatchEvent(new CustomEvent("override-cancel"));
    await el.updateComplete;
    expect(new GiveBackSession(SCOPE, api).read("sale-1")).toBeNull();
    cleanupWidgets();
    const { el: reopened } = await mount(api);
    expect(reopened.shadowRoot!.querySelector("[data-lost]")).toBeNull();
    expect(choice(reopened, "dishes")).not.toBeNull();
  });

  it("opens on a refused press saying what the box answered, not that it did not answer", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({
      code: "tender.refund_exceeds_payment",
      tenderId: "card-1",
      status: 409,
    });
    await press(api);
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledOnce());
    cleanupWidgets();
    const { el } = await mount(api);
    expect(text(root(el).querySelector("[data-lost]"))).toBe(
      codeMessage("tender.refund_exceeds_payment", "en", { tenderId: "card-1" } as never),
    );
  });

  it("sending a lost press again asks for every right the preview named", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund", "sale.rectify"] });
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.giveBack.mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 });
    const el = await press(api);
    await approve(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-lost]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await approve(el);
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(api.listApprovers).toHaveBeenLastCalledWith(["sale.refund", "sale.rectify"], {
      signal: expect.any(AbortSignal),
    });
  });

  const restRequest: GiveBackRequest = {
    purpose: "goodwill",
    amount: "3.00",
    extra: "0.00",
    way: "card-1",
  };
  const withRest = (api: Api) =>
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [
        { kind: "refund", amount: "2.00", state: "pending", refundId: "refund-1" },
        { kind: "correction", amount: "3.00", state: "not_started" },
      ],
      rest: restRequest,
    }));

  it("says what follows the card company's answer, and Check again sends it with fresh ids", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    api.getTenderRefund.mockResolvedValueOnce({ state: "pending" });
    const el = await press(api, "card-1");
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain(
        "€3.00 is not refunded yet: it follows when the card company answers.",
      ),
    );
    expect(outcomeText(el)).toContain("€2.00 is waiting for the card company's answer.");
    const again = () => root(el).querySelector<HTMLElement>("[data-check-again]")!;
    again().click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.still_waiting")));
    expect(api.getTenderRefund).toHaveBeenCalledWith("refund-1", {});
    expect(api.giveBack).toHaveBeenCalledOnce();
    again().click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain("€3.00 is refunded to card ···4242."));
    expect(api.previewGiveBack).toHaveBeenLastCalledWith("sale-1", restRequest);
    expect(sent(api, 1)).toMatchObject({ request: restRequest, reasonId: "complaint" });
    for (const id of Object.values(sent(api, 1).submissionIds))
      expect(Object.values(sent(api, 0).submissionIds)).not.toContain(id);
  });

  it("sends no rest when the window is taken away while Check again reads the card company's answer", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    let release!: () => void;
    api.getTenderRefund.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ state: "completed" }))),
    );
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() => expect(api.getTenderRefund).toHaveBeenCalledOnce());
    el.remove();
    release();
    // Check again marks the first refund back as its last step before it would send the rest.
    await vi.waitFor(() => expect(outcomeText(el)).toContain("is refunded to card ···4242."));
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("asks no approver when the window is taken away while it reads who may approve", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({
      code: "authorization.not_permitted",
      permission: "sale.rectify",
      status: 403,
    });
    let release!: () => void;
    api.listApprovers.mockImplementationOnce(
      () =>
        new Promise(
          (resolve) => (release = () => resolve([{ personId: "boss", displayName: "Boss" }])),
        ),
    );
    const el = await press(api);
    await vi.waitFor(() => expect(api.listApprovers).toHaveBeenCalledOnce());
    el.remove();
    release();
    await api.listApprovers.mock.results[0]!.value;
    await el.updateComplete;
    expect(approval(el)).toBeNull();
    expect(api.giveBack).toHaveBeenCalledOnce();
    expect(new GiveBackSession(SCOPE, api).read("sale-1")?.sent).toBeTruthy();
  });

  it("says to close and open the window again when a press finds money back already under way", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({ code: "invoice_correction.already_open", status: 409 });
    const el = await press(api);
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(codeMessage("invoice_correction.already_open", "en")),
    );
    expect(api.giveBack).toHaveBeenCalledOnce();
    expect(root(el).querySelector("[data-outcome]")).toBeNull();
  });

  describe("Check again has the box ask the card company about the same refund", () => {
    const refused = {
      code: "authorization.not_permitted",
      permission: "sale.refund",
      status: 403,
    };
    const again = (el: TillGiveBackDialog) =>
      root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-check-again]")!;
    /** A card press whose refund the card company has not answered, with a rest to follow. */
    async function waiting(api = fakeGiveBackApi()) {
      withRest(api);
      api.getTenderRefund.mockResolvedValue({ state: "pending" });
      const el = await press(api, "card-1");
      await vi.waitFor(() => expect(again(el)).not.toBeNull());
      return { el, api };
    }

    it("sends the rest once the card company says it went through, giving the first refund back once", async () => {
      const { el, api } = await waiting();
      api.retryTenderRefund.mockResolvedValueOnce(refundAnswer({ state: "completed" }));
      again(el).click();
      await vi.waitFor(() =>
        expect(outcomeText(el)).toContain("€3.00 is refunded to card ···4242."),
      );
      expect(api.retryTenderRefund.mock.calls).toEqual([["refund-1", undefined]]);
      expect(api.giveBack).toHaveBeenCalledTimes(2);
      expect(sent(api, 1).request).toEqual(restRequest);
    });

    it("still offers itself while the card company has not answered, asking under the same id each time", async () => {
      const { el, api } = await waiting();
      again(el).click();
      await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.still_waiting")));
      again(el).click();
      await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledTimes(2));
      expect(api.retryTenderRefund.mock.calls.map(([id]) => id)).toEqual(["refund-1", "refund-1"]);
      expect(api.giveBack).toHaveBeenCalledOnce();
    });

    it.each([undefined, "provider_balance_unavailable"] as const)(
      "says the card company did not make it and drops the rest (reason %s)",
      async (refusalReason) => {
        const { el, api } = await waiting();
        api.retryTenderRefund.mockResolvedValueOnce(
          refundAnswer({ state: "failed", ...(refusalReason && { refusalReason }) }),
        );
        again(el).click();
        await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.rest_failed")));
        expect(outcomeText(el).includes(t("refund.provider_balance_unavailable"))).toBe(
          refusalReason !== undefined,
        );
        expect(again(el)).toBeNull();
        expect(api.giveBack).toHaveBeenCalledOnce();
      },
    );

    it("asks an approver when the person signed in may not, asks with their PIN, then sends the rest", async () => {
      const { el, api } = await waiting();
      api.retryTenderRefund.mockRejectedValueOnce(refused);
      again(el).click();
      await vi.waitFor(() => expect(approval(el)).not.toBeNull());
      expect(api.listApprovers).toHaveBeenLastCalledWith(["sale.refund"], {
        signal: expect.any(AbortSignal),
      });
      api.retryTenderRefund.mockRejectedValueOnce({ code: "pin.invalid", status: 401 });
      await approve(el);
      await vi.waitFor(() => expect(approval(el)!.error).not.toBeNull());
      api.retryTenderRefund.mockResolvedValueOnce(refundAnswer({ state: "completed" }));
      await approve(el);
      await vi.waitFor(() =>
        expect(outcomeText(el)).toContain("€3.00 is refunded to card ···4242."),
      );
      expect(approval(el)).toBeNull();
      const approver = { personId: "boss", pin: "1234" };
      expect(api.retryTenderRefund.mock.calls).toEqual([
        ["refund-1", undefined],
        ["refund-1", approver],
        ["refund-1", approver],
      ]);
      expect(sent(api, 1).override).toBeUndefined();
    });

    it("keeps the rest waiting when the approver step is cancelled or who may approve cannot be read", async () => {
      const { el, api } = await waiting();
      api.retryTenderRefund.mockRejectedValue(refused);
      again(el).click();
      await vi.waitFor(() => expect(approval(el)).not.toBeNull());
      approval(el)!.dispatchEvent(new CustomEvent("override-cancel"));
      await el.updateComplete;
      expect(approval(el)).toBeNull();
      expect(outcomeText(el)).toContain("€2.00 is waiting for the card company's answer.");
      api.listApprovers.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      again(el).click();
      await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.uw_approvers_failed")));
      expect(outcomeText(el)).not.toContain("Nothing has been refunded");
      expect(again(el).disabled).toBe(false);
      expect(api.giveBack).toHaveBeenCalledOnce();
    });

    it.each([
      ["lost", new TypeError("Failed to fetch"), "give_back.uw_unknown"],
      ["refused on a full disk", { code: "storage.disk_full", status: 507 }, "storage.disk_full"],
      [
        "refused as the box's time is not confirmed",
        { code: "clock.unconfirmed", status: 409 },
        "clock.unconfirmed",
      ],
    ] as const)("says so when the asking is %s, and keeps Check again", async (_, error, said) => {
      const { el, api } = await waiting();
      api.retryTenderRefund.mockRejectedValueOnce(error);
      again(el).click();
      await vi.waitFor(() =>
        expect(outcomeText(el)).toContain(
          said === "give_back.uw_unknown" ? t(said) : codeMessage(said, "en"),
        ),
      );
      expect(outcomeText(el)).not.toContain("Nothing has been refunded");
      expect(new GiveBackSession(SCOPE, api).read("sale-1")?.rest?.waitFor).toBe("refund-1");
      expect(again(el).disabled).toBe(false);
    });

    it("says it could not find out, asking nothing, when this device's storage cannot be read", async () => {
      const { el, api } = await waiting();
      const reading = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("Storage blocked");
      });
      onTestFinished(() => reading.mockRestore());
      again(el).click();
      await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.uw_unknown")));
      expect(outcomeText(el)).not.toContain("Nothing has been refunded");
      expect(api.getTenderRefund).not.toHaveBeenCalled();
      expect(again(el).disabled).toBe(false);
    });

    it("tells the till the sign-in ended when the asking is refused for it", async () => {
      const { el, api } = await waiting();
      api.retryTenderRefund.mockRejectedValueOnce({ code: "session.required", status: 401 });
      const signedOut = vi.fn();
      el.addEventListener("give-back-signed-out", signedOut);
      again(el).click();
      await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
    });

    it("asks once when pressed twice, and keeps the window open until that is answered", async () => {
      const { el, api } = await waiting();
      const answer = deferred<ReturnType<typeof refundAnswer>>();
      api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
      again(el).click();
      again(el).click();
      await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
      await el.updateComplete;
      const dialog = root(el).querySelector("wt-dialog")!;
      expect(dialog.dismissible).toBe(false);
      expect(again(el).disabled).toBe(true);
      expect(outcomeText(el)).not.toContain(t("give_back.busy"));
      answer.resolve(refundAnswer());
      await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.still_waiting")));
      expect(dialog.dismissible).toBe(true);
      expect(api.getTenderRefund).toHaveBeenCalledOnce();
      expect(api.retryTenderRefund).toHaveBeenCalledOnce();
    });

    it("asks the card company nothing, sending no approver's PIN, when the window is taken away while the refund's state is read", async () => {
      const { el, api } = await waiting();
      api.retryTenderRefund.mockRejectedValueOnce(refused);
      again(el).click();
      await vi.waitFor(() => expect(approval(el)).not.toBeNull());
      const read = deferred<{ state: string }>();
      api.getTenderRefund.mockImplementationOnce(() => read.promise);
      const ended = checkEnded(el);
      await approve(el);
      await vi.waitFor(() => expect(api.getTenderRefund).toHaveBeenCalledTimes(2));
      el.remove();
      read.resolve({ state: "pending" });
      await ended();
      expect(api.retryTenderRefund.mock.calls).toEqual([["refund-1", undefined]]);
      expect(new GiveBackSession(SCOPE, api).read("sale-1")?.rest?.request).toEqual(restRequest);
    });

    it("sends no rest and asks no approver when the window is taken away while the asking is out", async () => {
      const { el, api } = await waiting();
      const answer = deferred<ReturnType<typeof refundAnswer>>();
      api.retryTenderRefund.mockImplementationOnce(() => answer.promise);
      again(el).click();
      await vi.waitFor(() => expect(api.retryTenderRefund).toHaveBeenCalledOnce());
      el.remove();
      answer.resolve(refundAnswer({ state: "completed" }));
      await vi.waitFor(() => expect(outcomeText(el)).toContain("is refunded to card ···4242."));
      expect(api.giveBack).toHaveBeenCalledOnce();
      expect(new GiveBackSession(SCOPE, api).read("sale-1")?.rest?.request).toEqual(restRequest);
    });
  });

  it("drops the rest when the card company did not make the first refund", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    api.getTenderRefund.mockResolvedValueOnce({ state: "failed" });
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.rest_failed")));
    expect(root(el).querySelector("[data-check-again]")).toBeNull();
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("keeps a rest's refusal on the outcome, with Check again still offered", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    api.giveBack.mockRejectedValueOnce({ code: "give_back.changed", status: 409 });
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain(codeMessage("give_back.changed", "en")),
    );
    expect(root(el).querySelector("[data-check-again]")).not.toBeNull();
  });

  it("says Check again could not reach the box", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    api.getTenderRefund.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.uw_unknown")));
    expect(outcomeText(el)).not.toContain("Nothing has been refunded");
  });

  it("says Check again waits while another send on the receipt is still out, asking nothing", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    let release!: (value: { state: string }) => void;
    api.getTenderRefund.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const out = el.session.checkRest("sale-1");
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain(t("give_back.busy")));
    expect(api.getTenderRefund).toHaveBeenCalledOnce();
    release({ state: "pending" });
    await out;
  });

  it("tells the till the sign-in ended when Check again is refused for it, for the till to lock", async () => {
    const api = fakeGiveBackApi();
    withRest(api);
    api.getTenderRefund.mockRejectedValueOnce({ code: "session.required", status: 401 });
    const el = await press(api, "card-1");
    const signedOut = vi.fn();
    el.addEventListener("give-back-signed-out", signedOut);
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-check-again]")!.click();
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
    expect(signedOut.mock.calls[0]![0]).toMatchObject({ bubbles: true, composed: true });
  });

  it("says what went back and why the rest did not when a later part is refused", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [
        { kind: "refund", amount: "2.00", state: "completed", refundId: "refund-1" },
        { kind: "correction", amount: "3.00", state: "failed" },
      ],
      refusal: { code: "give_back.refund_failed", params: {} },
    }));
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(outcomeText(el)).toContain("€2.00 is refunded to card ···4242."));
    expect(outcomeText(el)).toContain(codeMessage("give_back.refund_failed", "en"));
    expect(root(el).querySelector("[data-check-again]")).toBeNull();
  });

  it.each([
    ["en", en],
    ["es-ES", es],
  ] as const)(
    "says in %s that the card company cannot refund yet, when it says so",
    async (locale, words) => {
      setLocale(locale);
      const api = fakeGiveBackApi();
      api.giveBack.mockImplementation(async (_saleId: string, body: GiveBackWrite) => ({
        ...completedFor(body),
        parts: [{ kind: "refund", amount: "5.00", state: "failed", refundId: "refund-1" }],
        refusal: { code: "give_back.refund_failed", params: {} },
        refusalReason: "provider_balance_unavailable",
      }));
      const el = await press(api, "card-1");
      await vi.waitFor(() =>
        expect(outcomeText(el)).toBe(
          `${codeMessage("give_back.refund_failed", locale)} ${words["refund.provider_balance_unavailable"]}`,
        ),
      );
    },
  );

  it("says only that a card refund was not made, when the card company gives no reason", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [{ kind: "refund", amount: "5.00", state: "failed", refundId: "refund-1" }],
      refusal: { code: "give_back.refund_failed", params: {} },
    }));
    const el = await press(api, "card-1");
    await vi.waitFor(() =>
      expect(outcomeText(el)).toBe(codeMessage("give_back.refund_failed", "en")),
    );
  });

  it("moves to the under-way view when money is left under way", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      underWay: UNDER_WAY,
    }));
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(underWay(el)).not.toBeNull());
    expect(heading(el)).toBe(t("give_back.under_way"));
    expect(outcomeText(el)).toContain("€5.00 is refunded to card ···4242.");
    expect(underWay(el)!.correction).toBe(UNDER_WAY);
    expect(root(el).querySelector("[data-check-again]")).toBeNull();
  });

  it("keeps Check again, not the under-way view, while the rest waits for the card company", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      underWay: UNDER_WAY,
      rest: { ...body.request, amount: "1.00" },
    }));
    const el = await press(api, "card-1");
    await vi.waitFor(() => expect(root(el).querySelector("[data-check-again]")).not.toBeNull());
    expect(underWay(el)).toBeNull();
    expect(text(root(el).querySelector("[data-under-way]"))).toBe(t("give_back.under_way"));
  });

  it("shows give_back.changed with the new preview, and gives nothing back", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({ code: "give_back.changed", status: 409 });
    const el = await press(api);
    answering(api, { parts: [{ kind: "refund", amount: "4.00", way: "cash" }] });
    await vi.waitFor(() => expect(bottom(el)).toBe(codeMessage("give_back.changed", "en")));
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toContain("€4.00"),
    );
    expect(root(el).querySelector("[data-outcome]")).toBeNull();
    expect(new GiveBackSession(SCOPE, api).read("sale-1")).toBeNull();
  });

  it("shows a wait the read did not show at the bottom, and nothing moves", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({
      code: "sale.correction_not_admitted",
      reason: "filing_refused",
      status: 409,
    });
    const el = await press(api);
    await vi.waitFor(() =>
      expect(bottom(el)).toBe(
        codeMessage("sale.correction_not_admitted", "en", { reason: "filing_refused" }),
      ),
    );
    expect(root(el).querySelector("[data-outcome]")).toBeNull();
    expect(amountField(el).value).toBe("5");
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("offers to send a lost answer again, under the same ids", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const el = await press(api);
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-lost]"))).toContain(t("give_back.lost")),
    );
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(sent(api, 1).submissionIds).toEqual(sent(api, 0).submissionIds);
  });

  it("sends a lost answer again once when Send again is pressed twice", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const el = await press(api);
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).not.toBeNull());
    const again = root(el).querySelector<HTMLElement>("[data-send-again]")!;
    again.click();
    again.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(api.giveBack).toHaveBeenCalledTimes(2);
  });

  const goodwillAsk = {
    request: { purpose: "goodwill" as const, amount: "5.00", extra: "0.00", way: "cash" },
    reasonId: "complaint",
    note: null,
    expected: [{ kind: "refund" as const, amount: "5.00", way: "cash" }],
  };
  /** Holds the next give-back sent unanswered until the returned function answers it. */
  function holdNext(api: Api) {
    let answer!: (value: ReturnType<typeof completedFor>) => void;
    api.giveBack.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    return (body: GiveBackWrite) => answer(completedFor(body));
  }

  it("says a press waits while another give-back on the receipt is still out, sending nothing", async () => {
    const api = fakeGiveBackApi();
    const el = await ready(api);
    const answer = holdNext(api);
    const out = el.session.submit("sale-1", goodwillAsk);
    submit(el).click();
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.busy")));
    expect(root(el).querySelector("[data-lost]")).toBeNull();
    expect(amountField(el).value).toBe("5");
    expect(api.giveBack).toHaveBeenCalledOnce();
    answer(sent(api));
    await out;
  });

  it("says Send again waits while its press is still out, then shows that press's answer, sending it once", async () => {
    const api = fakeGiveBackApi();
    const session = new GiveBackSession(SCOPE, api);
    const answer = holdNext(api);
    const out = session.submit("sale-1", goodwillAsk);
    const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
      api,
      session,
      saleId: "sale-1",
      invoiceNumber: "A/1042",
      namesLocale: "en",
    });
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-lost]"))).toBe(t("give_back.busy")),
    );
    expect(root(el).querySelector("[data-send-again]")).not.toBeNull();
    answer(sent(api));
    await out;
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("opened while a press refused for its PIN is out again with one, opens on Send again, which shows that press's answer", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 });
    const session = new GiveBackSession(SCOPE, api);
    await expect(session.submit("sale-1", goodwillAsk)).rejects.toMatchObject({
      code: "authorization.not_permitted",
    });
    const answer = holdNext(api);
    const out = session.submit("sale-1", goodwillAsk, { personId: "boss", pin: "1234" });
    const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
      api,
      session,
      saleId: "sale-1",
      invoiceNumber: "A/1042",
      namesLocale: "en",
    });
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).not.toBeNull());
    expect(choice(el, "goodwill")).toBeNull();
    expect(text(root(el).querySelector("[data-lost]"))).toBe(t("give_back.lost"));
    answer(sent(api, 1));
    await out;
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(api.giveBack).toHaveBeenCalledTimes(2);
  });

  it("a press sent again and refused goes back to the choice with its sentence", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.giveBack.mockRejectedValueOnce({ code: "clock.unconfirmed", status: 409 });
    const el = await press(api);
    await vi.waitFor(() => expect(root(el).querySelector("[data-lost]")).not.toBeNull());
    cleanupWidgets();
    const { el: reopened } = await mount(api);
    reopened.shadowRoot!.querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() => expect(choice(reopened, "dishes")).not.toBeNull());
    expect(bottom(reopened)).toBe(codeMessage("clock.unconfirmed", "en"));
    expect(new GiveBackSession(SCOPE, api).read("sale-1")).toBeNull();
  });

  describe("Send again refused where neither the form nor the choice is drawn", () => {
    const UNDER: GiveBackView = { ...VIEW, underWay: UNDER_WAY };
    const diskFull = { code: "storage.disk_full", status: 507 };
    const lostText = (el: TillGiveBackDialog) => text(root(el).querySelector("[data-lost]"));
    const again = (el: TillGiveBackDialog) =>
      root(el).querySelector<HTMLElement>("[data-send-again]");
    /** Opens on a press whose answer was lost, and presses Send again, which `error` refuses. */
    async function sendAgain(api: Api, error: object) {
      api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      api.giveBack.mockRejectedValueOnce(error);
      await expect(new GiveBackSession(SCOPE, api).submit("sale-1", goodwillAsk)).rejects.toThrow();
      const held = holding();
      const { el } = await mount(api);
      again(el)!.click();
      await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
      return { el, held };
    }
    function breakStorage() {
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("unreadable");
      });
      onTestFinished(() => getItem.mockRestore());
    }
    /** An API whose receipt has money back under way, or whose receipt cannot be read. */
    const apis: readonly [string, () => Api][] = [
      ["a give-back is under way", () => fakeGiveBackApi(UNDER)],
      [
        "the receipt is unread",
        () => {
          const api = fakeGiveBackApi();
          api.readGiveBack.mockRejectedValue({ code: "server.internal", status: 500 });
          return api;
        },
      ],
    ];

    it.each(apis)(
      "while %s, says why and keeps Send again, which sends the same ids, when the box could not save it",
      async (_state, makeApi) => {
        const api = makeApi();
        const { el, held } = await sendAgain(api, diskFull);
        await vi.waitFor(() => expect(lostText(el)).toBe(codeMessage("storage.disk_full", "en")));
        expect(underWay(el)).toBeNull();
        expect(held()).toBe(true);
        again(el)!.click();
        await vi.waitFor(() => expect(outcomeText(el)).toContain("€5.00"));
        expect(api.giveBack).toHaveBeenCalledTimes(3);
        expect(sent(api, 2).submissionIds).toEqual(sent(api, 0).submissionIds);
      },
    );

    it.each(apis)(
      "while %s, says why and ends the press, when nothing went back under it",
      async (_state, makeApi) => {
        const api = makeApi();
        const { el, held } = await sendAgain(api, {
          code: "invoice_correction.already_open",
          status: 409,
        });
        await vi.waitFor(() =>
          expect(outcomeText(el)).toBe(codeMessage("invoice_correction.already_open", "en")),
        );
        expect(again(el)).toBeNull();
        expect(underWay(el)).toBeNull();
        expect(held()).toBe(true);
        expect(new GiveBackSession(SCOPE, api).read("sale-1")).toBeNull();
        expect(text(root(el).querySelector("[data-close]"))).toBe(t("give_back.done"));
        cleanupWidgets();
        api.readGiveBack.mockResolvedValue(UNDER);
        const { el: reopened } = await mount(api);
        expect(underWay(reopened)).not.toBeNull();
        expect(api.giveBack).toHaveBeenCalledTimes(2);
      },
    );

    it("ends a press refused by a fiscal conflict with the recovery link, saying nothing was given back", async () => {
      const { el } = await sendAgain(fakeGiveBackApi(UNDER), {
        code: "sif.allocation_invalid",
        reason: "conflict_requires_administrator",
        recoveryUrl: "/recovery/fiscal-conflict",
        status: 409,
      });
      await vi.waitFor(() =>
        expect(
          [...root(el).querySelectorAll("[data-outcome] p")].map((line) => text(line)),
        ).toEqual([t("recovery.issuance_stopped"), t("give_back.nothing_given")]),
      );
      expect(root(el).querySelector("wt-form-actions [data-recovery]")!.getAttribute("href")).toBe(
        "/recovery/fiscal-conflict",
      );
    });

    it.each(apis)(
      "while %s, ends a press refused as changed saying only that nothing was given back",
      async (_state, makeApi) => {
        const { el } = await sendAgain(makeApi(), { code: "give_back.changed", status: 409 });
        await vi.waitFor(() => expect(outcomeText(el)).toBe(t("give_back.nothing_given")));
        expect(again(el)).toBeNull();
        expect(submit(el)).toBeNull();
        expect(text(root(el).querySelector("[data-close]"))).toBe(t("give_back.done"));
      },
    );

    it.each([false, true])(
      "keeps Send again when who may approve it cannot be read (nor this device's storage: %s)",
      async (unreadable) => {
        const api = fakeGiveBackApi(UNDER);
        api.listApprovers.mockImplementationOnce(async () => {
          if (unreadable) breakStorage();
          throw new TypeError("Failed to fetch");
        });
        const { el, held } = await sendAgain(api, {
          code: "authorization.not_permitted",
          permission: "sale.refund",
          status: 403,
        });
        await vi.waitFor(() => expect(lostText(el)).toBe(t("give_back.uw_approvers_failed")));
        expect(again(el)).not.toBeNull();
        expect(held()).toBe(true);
      },
    );

    it("keeps Send again when this device's storage cannot be read", async () => {
      const api = fakeGiveBackApi(UNDER);
      const { el } = await sendAgain(api, diskFull);
      await vi.waitFor(() => expect(lostText(el)).toBe(codeMessage("storage.disk_full", "en")));
      breakStorage();
      again(el)!.click();
      await vi.waitFor(() => expect(lostText(el)).toBe(t("give_back.uw_unknown")));
      expect(again(el)).not.toBeNull();
      expect(api.giveBack).toHaveBeenCalledTimes(2);
    });

    it("drops the choice's refusal at Check again, which may find a give-back under way", async () => {
      const refused = { code: "tender.refund_in_progress" };
      const api = fakeGiveBackApi({ ...VIEW, ways: [{ ...CARD, pending: true, reason: refused }] });
      const { el, held } = await sendAgain(api, { ...refused, status: 409 });
      await vi.waitFor(() => expect(bottom(el)).toBe(codeMessage(refused.code, "en")));
      expect(held()).toBe(true);
      api.readGiveBack.mockResolvedValue(UNDER);
      root(el).querySelector<HTMLElement>("[data-check-pending]")!.click();
      await vi.waitFor(() => expect(underWay(el)).not.toBeNull());
      await vi.waitFor(() => expect(held()).toBe(false));
    });
  });

  describe("Send again once another tab saved a newer press on the receipt", () => {
    const newerAsk = {
      ...goodwillAsk,
      request: { ...goodwillAsk.request, amount: "9.00" },
      expected: [{ ...goodwillAsk.expected[0]!, amount: "9.00" }],
    };
    const failed = () => new TypeError("Failed to fetch");
    const lostText = (el: TillGiveBackDialog) => text(root(el).querySelector("[data-lost]"));
    const again = (el: TillGiveBackDialog) =>
      root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-send-again]");
    const idle = (el: TillGiveBackDialog) =>
      vi.waitFor(() => expect(again(el)?.disabled).toBe(false));
    /** The other tab settles the press saved here, then presses for €9.00, whose answer is lost. */
    async function pressNewer(api: Api) {
      const other = new GiveBackSession(SCOPE, api);
      if (other.read("sale-1")) await other.resend("sale-1");
      api.giveBack.mockRejectedValueOnce(failed());
      await expect(other.submit("sale-1", newerAsk)).rejects.toThrow();
      return api.giveBack.mock.calls.length;
    }
    /** Opened on a press of €5.00 whose answer was lost. */
    async function lostWindow(api: Api) {
      api.giveBack.mockRejectedValueOnce(failed());
      await expect(new GiveBackSession(SCOPE, api).submit("sale-1", goodwillAsk)).rejects.toThrow();
      const { el } = await mount(api);
      return el;
    }
    /** Presses Send again and checks it sends nothing and stays, each of `times`. */
    async function sendsNothing(el: TillGiveBackDialog, api: Api, sends: number, times = 2) {
      for (let press = 0; press < times; press++) {
        again(el)!.click();
        await el.updateComplete;
        await idle(el);
        expect(lostText(el)).toBe(t("give_back.lost"));
      }
      expect(api.giveBack).toHaveBeenCalledTimes(sends);
      expect(new GiveBackSession(SCOPE, api).read("sale-1")?.sent?.request.amount).toBe("9.00");
    }

    it("sends neither press, however often it is pressed, and still says its own answer is not known", async () => {
      const api = fakeGiveBackApi();
      const el = await lostWindow(api);
      await sendsNothing(el, api, await pressNewer(api));
    });

    it("sends neither press once an approver signs in for it", async () => {
      const api = fakeGiveBackApi();
      const el = await lostWindow(api);
      api.giveBack.mockRejectedValueOnce({
        code: "authorization.not_permitted",
        permission: "sale.refund",
        status: 403,
      });
      again(el)!.click();
      await vi.waitFor(() => expect(approval(el)).not.toBeNull());
      const sends = await pressNewer(api);
      await approve(el);
      await vi.waitFor(() => expect(approval(el)).toBeNull());
      expect(lostText(el)).toBe(t("give_back.lost"));
      await sendsNothing(el, api, sends, 1);
    });

    it("stays on its own press when that was answered as still starting meanwhile", async () => {
      const api = fakeGiveBackApi();
      const el = await lostWindow(api);
      const answer = deferred<GiveBackOutcome>();
      api.giveBack.mockImplementationOnce(() => answer.promise);
      again(el)!.click();
      await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
      const sends = await pressNewer(api);
      const done = completedFor(sent(api));
      answer.resolve({
        ...done,
        parts: done.parts.map((part) => ({ ...part, state: "not_started" })),
      });
      await idle(el);
      await sendsNothing(el, api, sends);
    });

    it("ends its own press, saying nothing was given back, once that was refused as changed", async () => {
      const api = fakeGiveBackApi({ ...VIEW, underWay: UNDER_WAY });
      const session = new GiveBackSession(SCOPE, api);
      const answer = deferred<GiveBackOutcome>();
      api.giveBack.mockImplementationOnce(() => answer.promise);
      const out = session.submit("sale-1", goodwillAsk);
      const { el } = await mount(api, session);
      answer.reject({ code: "give_back.changed", status: 409 });
      await expect(out).rejects.toMatchObject({ code: "give_back.changed" });
      const sends = await pressNewer(api);
      again(el)!.click();
      await vi.waitFor(() => expect(outcomeText(el)).toBe(t("give_back.nothing_given")));
      expect(again(el)).toBeNull();
      expect(api.giveBack).toHaveBeenCalledTimes(sends);
    });

    it("keeps its Send again when it is refused without proof that nothing went back", async () => {
      const api = fakeGiveBackApi({ ...VIEW, underWay: UNDER_WAY });
      const el = await lostWindow(api);
      const answer = deferred<GiveBackOutcome>();
      api.giveBack.mockImplementationOnce(() => answer.promise);
      again(el)!.click();
      await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
      const sends = await pressNewer(api);
      answer.reject({ code: "storage.disk_full", status: 507 });
      await vi.waitFor(() => expect(lostText(el)).toBe(codeMessage("storage.disk_full", "en")));
      await idle(el);
      await sendsNothing(el, api, sends);
    });
  });

  it("holds back the full-disk screen while it reads who may approve and while it asks, until cancelled", async () => {
    const held = holding();
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    const read = deferred<typeof APPROVERS>();
    api.listApprovers.mockImplementationOnce(() => read.promise);
    const el = await press(api);
    await vi.waitFor(() => expect(api.listApprovers).toHaveBeenCalledOnce());
    await el.updateComplete;
    expect(held()).toBe(true);
    read.resolve(APPROVERS);
    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    expect(held()).toBe(true);
    approval(el)!.dispatchEvent(new CustomEvent("override-cancel"));
    await vi.waitFor(() => expect(approval(el)).toBeNull());
    expect(held()).toBe(false);
    expect(api.giveBack).not.toHaveBeenCalled();
  });

  it("opens on a press whose answer was lost, or on a rest still to follow", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const ask = {
      request: { purpose: "goodwill" as const, amount: "5.00", extra: "0.00", way: "cash" },
      reasonId: "complaint",
      note: null,
      expected: [{ kind: "refund" as const, amount: "5.00", way: "cash" }],
    };
    await expect(new GiveBackSession(SCOPE, api).submit("sale-1", ask)).rejects.toThrow();
    const { el } = await mount(api);
    expect(root(el).querySelector("[data-lost]")).not.toBeNull();
    cleanupWidgets();
    localStorage.clear();
    const later = fakeGiveBackApi();
    withRest(later);
    await new GiveBackSession(SCOPE, later).submit("sale-1", {
      ...ask,
      request: { ...ask.request, way: "card-1" },
    });
    const { el: reopened } = await mount(later);
    expect(outcomeText(reopened)).toContain(
      "€3.00 is not refunded yet: it follows when the card company answers.",
    );
    expect(reopened.shadowRoot!.querySelector("[data-check-again]")).not.toBeNull();
  });

  it("says a rest with nothing waiting goes back at a press, and sends it with fresh ids, also after reopening", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [
        { kind: "refund", amount: "2.00", state: "completed", refundId: "refund-1" },
        { kind: "correction", amount: "3.00", state: "not_started" },
      ],
      rest: restRequest,
    }));
    const ready = t("give_back.rest_ready").replace("{amount}", "€3.00");
    const button = (el: TillGiveBackDialog) =>
      root(el).querySelector<HTMLElement>("[data-check-again]")!;
    const live = await press(api, "card-1");
    await vi.waitFor(() => expect(outcomeText(live)).toContain(ready));
    expect(outcomeText(live)).not.toContain(t("give_back.rest").replace("{amount}", "€3.00"));
    expect(text(button(live))).toBe(t("give_back.send_rest"));
    cleanupWidgets();
    const { el } = await mount(api);
    expect(outcomeText(el)).toContain(ready);
    expect(outcomeText(el)).not.toContain("card company");
    expect(text(button(el))).toBe(t("give_back.send_rest"));
    button(el).click();
    await vi.waitFor(() => expect(outcomeText(el)).toContain("€3.00 is refunded to card ···4242."));
    expect(api.getTenderRefund).not.toHaveBeenCalled();
    expect(api.previewGiveBack).toHaveBeenLastCalledWith("sale-1", restRequest);
    for (const id of Object.values(sent(api, 1).submissionIds))
      expect(Object.values(sent(api, 0).submissionIds)).not.toContain(id);
  });

  it("says what the box answered when a changed press is refused while an earlier one is kept", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({
      code: "tender.refund_exceeds_payment",
      tenderId: "cash",
      status: 409,
    });
    const el = await press(api);
    const said = codeMessage("tender.refund_exceeds_payment", "en", { tenderId: "cash" } as never);
    await vi.waitFor(() => expect(amountField(el).error).toBe(said));
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(submit(el).disabled).toBe(false);
    await type(el, "4");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toContain("€4.00"),
    );
    submit(el).click();
    await vi.waitFor(() => expect(root(el).querySelector("[data-lost]")).not.toBeNull());
    expect(text(root(el).querySelector("[data-lost]"))).toBe(said);
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("keeps a first press refused while the time zone is not ready, and sends only that press again", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({
      code: "venue.time_zone_not_ready",
      reason: "missing",
      status: 409,
    });
    const el = await press(api);
    const said = codeMessage("venue.time_zone_not_ready", "en", { reason: "missing" } as never);
    await vi.waitFor(() => expect(bottom(el)).toBe(said));
    await type(el, "4");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toContain("€4.00"),
    );
    submit(el).click();
    await vi.waitFor(() => expect(root(el).querySelector("[data-lost]")).not.toBeNull());
    expect(text(root(el).querySelector("[data-lost]"))).toBe(said);
    expect(api.giveBack).toHaveBeenCalledOnce();
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(sent(api, 1).submissionIds).toEqual(sent(api, 0).submissionIds);
  });

  it("offers to send again an answer whose parts have not started yet", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId: string, body: GiveBackWrite) => ({
      ...completedFor(body),
      parts: [{ kind: "refund", amount: "5.00", state: "not_started" }],
    }));
    const el = await press(api);
    await vi.waitFor(() => expect(root(el).querySelector("[data-lost]")).not.toBeNull());
    expect(root(el).querySelector("[data-outcome]")).toBeNull();
  });

  it("asks an approver for the saved rights and the one a resend's refusal names", async () => {
    const api = fakeGiveBackApi();
    answering(api, { needs: ["sale.refund"] });
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.giveBack.mockRejectedValueOnce({
      code: "authorization.not_permitted",
      permission: "sale.rectify",
      status: 403,
    });
    const el = await press(api);
    await approve(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-lost]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await approve(el);
    await vi.waitFor(() =>
      expect(outcomeText(el)).toContain("€5.00 refunded in cash. Give it to the customer."),
    );
    expect(api.listApprovers).toHaveBeenLastCalledWith(["sale.refund", "sale.rectify"], {
      signal: expect.any(AbortSignal),
    });
  });
});

describe("opened filled in after a cancel (D9)", () => {
  const FILL = { cancellationIds: ["cancel-1"], reasonId: "complaint" };
  async function mountFilled(api = fakeGiveBackApi(), fill = FILL) {
    const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
      api,
      session: new GiveBackSession(SCOPE, api),
      saleId: "sale-1",
      invoiceNumber: "A/1042",
      namesLocale: "en",
      fill,
    });
    await vi.waitFor(() => expect(root(el).querySelector("[data-purpose]")).not.toBeNull());
    await el.updateComplete;
    return { el, api };
  }
  const radio = (el: TillGiveBackDialog, id: string) =>
    root(el).querySelector<HTMLInputElement>(`input[name=way][value="${id}"]`)!;

  it("opens on A dish with the dish still owed on a cancel ticked at what it is owed, the cancel's reason and the payment chosen", async () => {
    const { el, api } = await mountFilled();
    expect(text(root(el).querySelector("[data-purpose]"))).toBe(t("give_back.dishes"));
    expect(dish(el, "paella")!.checked).toBe(true);
    expect(dish(el, "croquetas")!.checked).toBe(false);
    expect(amountField(el).value).toBe("20.00");
    expect(
      root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=reason]")!
        .value,
    ).toBe("complaint");
    expect(radio(el, "cash").checked).toBe(true);
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    expect(api.previewGiveBack).toHaveBeenLastCalledWith("sale-1", {
      purpose: "dishes",
      lineIds: ["paella"],
      amount: "20.00",
      extra: "0.00",
      way: "cash",
      fromCancel: ["cancel-1"],
    });
    expect(root(el).querySelector("[data-pin]")).toBeNull();
  });

  it("gives the dish back sending the cancel's ids and asks for no PIN", async () => {
    const { el, api } = await mountFilled();
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledOnce());
    expect(api.giveBack.mock.calls[0]![1]).toMatchObject({
      request: {
        purpose: "dishes",
        lineIds: ["paella"],
        amount: "20.00",
        extra: "0.00",
        way: "cash",
        fromCancel: ["cancel-1"],
      },
      reasonId: "complaint",
    });
    expect(api.giveBack.mock.calls[0]![1].override).toBeUndefined();
    expect(api.listApprovers).not.toHaveBeenCalled();
  });

  it("chooses the only payment this device can use", async () => {
    const { el } = await mountFilled(withView({ ways: [{ ...CASH, allowedHere: false }, CARD] }));
    expect(radio(el, "card-1").checked).toBe(true);
    expect(radio(el, "cash").disabled).toBe(true);
    expect(text(root(el).querySelector("[data-way-reason=cash]"))).toBe(
      t("give_back.way_not_here"),
    );
  });

  it("says so when this device cannot take the payment, choosing none and keeping Give back disabled", async () => {
    const { el, api } = await mountFilled(withView({ ways: [{ ...CASH, allowedHere: false }] }));
    expect(radio(el, "cash").checked).toBe(false);
    expect(radio(el, "cash").disabled).toBe(true);
    expect(text(root(el).querySelector("[data-way-reason=cash]"))).toBe(
      t("give_back.way_not_here"),
    );
    expect(submit(el).disabled).toBe(true);
    expect(api.previewGiveBack).not.toHaveBeenCalled();
  });

  it("ticks only a dish whose cancels still owed are all the ones it was opened with", async () => {
    const earlier = {
      ...VIEW.lines[1]!,
      id: "flan",
      descriptions: { en: "Flan", es: "Flan" },
      cancelled: { quantity: "1.000", owed: "5.00", back: "0.00", waiting: "0.00" },
      cancelIds: ["cancel-0"],
    };
    const { el } = await mountFilled(withView({ lines: [...VIEW.lines, earlier] }));
    expect(dish(el, "paella")!.checked).toBe(true);
    expect(dish(el, "flan")!.checked).toBe(false);
    expect(amountField(el).value).toBe("20.00");
  });

  it("sends the cancel's ids only while the ticked dishes are the ones it opened with", async () => {
    const { el, api } = await mountFilled();
    await tick(el, "croquetas");
    await vi.waitFor(() =>
      expect(api.previewGiveBack.mock.lastCall![1].lineIds).toEqual(["paella", "croquetas"]),
    );
    expect(api.previewGiveBack.mock.lastCall![1]).not.toHaveProperty("fromCancel");
    await tick(el, "croquetas");
    await vi.waitFor(() =>
      expect(api.previewGiveBack.mock.lastCall![1].fromCancel).toEqual(["cancel-1"]),
    );
    root(el).querySelector<HTMLElement>("[data-back]")!.click();
    await el.updateComplete;
    await choose(el, "dishes");
    await tick(el, "croquetas");
    await reason(el, "complaint");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    expect(api.previewGiveBack.mock.lastCall![1]).toMatchObject({ lineIds: ["croquetas"] });
    expect(api.previewGiveBack.mock.lastCall![1]).not.toHaveProperty("fromCancel");
  });

  it("sends no cancel ids from a window opened without them", async () => {
    const { el, api } = await mount();
    await choose(el, "dishes");
    await tick(el, "croquetas");
    await reason(el, "complaint");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    expect(api.previewGiveBack.mock.lastCall![1]).toMatchObject({ lineIds: ["croquetas"] });
    expect(api.previewGiveBack.mock.lastCall![1]).not.toHaveProperty("fromCancel");
  });

  it("opens on the choice when A dish cannot be chosen", async () => {
    const api = withView({
      choices: { ...VIEW.choices, dishes: { available: false, reason: null } },
    });
    const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
      api,
      session: new GiveBackSession(SCOPE, api),
      saleId: "sale-1",
      namesLocale: "en",
      fill: FILL,
    });
    await vi.waitFor(() => expect(root(el).querySelector("[data-what-for]")).not.toBeNull());
    expect(root(el).querySelector("[data-purpose]")).toBeNull();
  });
});

describe("a give-back still under way", () => {
  it("opens straight onto what is left to do, titled Money back under way", async () => {
    const api = withView({ underWay: UNDER_WAY });
    const { el } = await mount(api);

    expect(heading(el)).toBe(t("give_back.under_way"));
    expect(choice(el, "goodwill")).toBeNull();
    const view = underWay(el)!;
    expect(view.correction).toBe(UNDER_WAY);
    expect(view.saleId).toBe("sale-1");
    await vi.waitFor(() =>
      expect(text(view.shadowRoot!.querySelector("[data-left]"))).toBe(
        t("give_back.uw_left").replace("{amount}", "€4.00"),
      ),
    );
  });

  it("opens on the choice when what this till saved cannot be read", async () => {
    localStorage.setItem(
      `waitron.tender-refund:${JSON.stringify([SCOPE.deviceId, SCOPE.personId])}:${JSON.stringify(["give-back", "sale-1"])}`,
      "{not json",
    );
    const { el } = await mount();
    expect(choice(el, "goodwill")).not.toBeNull();
    expect(root(el).querySelector("[data-lost]")).toBeNull();
  });
});

describe("pressing Give back", () => {
  /** Goodwill of €5.00 in cash, its preview answered, not pressed yet. */
  async function ready(api = fakeGiveBackApi()) {
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "5");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    return { el, api };
  }

  it("gives back once when it is pressed twice before the window shows it busy", async () => {
    const { el, api } = await ready();
    submit(el).click();
    submit(el).click();
    await vi.waitFor(() => expect(root(el).querySelector("[data-outcome]")).not.toBeNull());
    expect(api.giveBack).toHaveBeenCalledOnce();
  });

  it("gives back on Enter in the amount, as the button does", async () => {
    const { el, api } = await ready();
    amountField(el)
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledOnce());
  });

  it("gives nothing back when the window is taken away while the preview is asked again", async () => {
    const api = fakeGiveBackApi();
    let release!: () => void;
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await reason(el, "complaint");
    api.previewGiveBack.mockImplementation(
      (_saleId: string, request: GiveBackRequest) =>
        new Promise((resolve) => (release = () => resolve(previewFor(request)))),
    );
    await type(el, "5");
    submit(el).click();
    await vi.waitFor(() => expect(api.previewGiveBack).toHaveBeenCalledTimes(2));
    el.remove();
    release();
    // Give back stops showing busy once the press has ended, or the window has left the form.
    await vi.waitFor(() =>
      expect(
        root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")?.loading,
      ).not.toBe(true),
    );
    expect(api.giveBack).not.toHaveBeenCalled();
  });
});

describe("layout and focus", () => {
  function focused(): Element | null {
    let found = document.activeElement;
    while (found?.shadowRoot?.activeElement) found = found.shadowRoot.activeElement;
    return found;
  }

  it("opens with focus on the first choice, and a dish's form on its first dish", async () => {
    const { el } = await mount();
    await vi.waitFor(() =>
      expect(
        choice(el, "dishes")!.contains(focused()) ||
          choice(el, "dishes")!.shadowRoot!.contains(focused()),
      ).toBe(true),
    );
    await choose(el, "dishes");
    await vi.waitFor(() =>
      expect(dish(el, "croquetas")!.shadowRoot!.contains(focused())).toBe(true),
    );
  });

  it("opens a press whose answer was lost with focus on Send again", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      new GiveBackSession(SCOPE, api).submit("sale-1", {
        request: { purpose: "goodwill", amount: "5.00", extra: "0.00", way: "cash" },
        reasonId: "complaint",
        note: null,
        expected: [{ kind: "refund", amount: "5.00", way: "cash" }],
      }),
    ).rejects.toThrow();
    const { el } = await mount(api);
    const again = root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-send-again]")!;
    await vi.waitFor(() =>
      expect(again.contains(focused()) || again.shadowRoot!.contains(focused())).toBe(true),
    );
  });

  it("puts each dish on a row of its own, however wide the window", async () => {
    const previous = { width: innerWidth, height: innerHeight };
    await page.viewport(1280, 800);
    try {
      const { el } = await mount();
      await choose(el, "dishes");
      const [first, second] = [dish(el, "croquetas"), dish(el, "paella")].map((node) =>
        node!.getBoundingClientRect(),
      );
      expect(second!.top).toBeGreaterThanOrEqual(first!.bottom);
      expect(second!.left).toBe(first!.left);
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  });
});
