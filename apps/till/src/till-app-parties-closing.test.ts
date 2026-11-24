import type { FinishTableResolution } from "./api/finish-table-types.js";
import { switchToBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { cancelReason, expectNoA11yViolations } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCancelCreditDialog } from "./widgets/cancel-credit-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import type { PartyBill } from "./api/client.js";
import {
  seated,
  table4,
  table7,
  table9,
  tabBill,
  checkBill,
  saleResult,
  till,
  api,
  stubApi,
  drafts,
  mountApp,
  flush,
  emit,
  lock,
  shell,
  floor,
  tableOrder,
  banner,
  openPartyTable,
  closingEdits,
  held,
} from "../test/party-app-fixture.js";

describe("till-app: cancelling and crediting an invoiced bill", () => {
  const invoiced: PartyBill = {
    ...checkBill,
    status: "placed",
    receiptAvailable: true,
    receiptLanguage: "es",
    invoiceNumber: "A/12",
    correctives: [],
  };
  const cancelled: PartyBill = {
    ...invoiced,
    billNumber: null,
    status: "abandoned",
    outstanding: "0.00",
    correctives: ["R/3"],
  };
  const dialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillCancelCreditDialog>("till-cancel-credit-dialog");
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog[data-cancel-credit-approval]",
    );
  const bottom = (el: TillApp) =>
    dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
      .error;
  const doneText = (el: TillApp) =>
    dialog(el)!
      .shadowRoot!.querySelector("[data-cancel-credit-done]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;
  const offered = (el: TillApp) =>
    tableOrder(el)!.shadowRoot!.querySelector("[data-cancel-credit]");

  /** The server's side of the party's bills: `cancelOrder` cancels the bill unless it rejects. */
  function billServer(cancel: (id: string) => Promise<void> = async () => {}) {
    let bills: PartyBill[] = [tabBill, invoiced];
    let readsFail = false;
    return {
      getPartyBills: vi.fn(async () => {
        if (readsFail) throw new TypeError("Failed to fetch");
        return bills;
      }),
      cancelOrder: vi.fn(async (id: string) => {
        await cancel(id);
        bills = [tabBill, cancelled];
      }),
      cancelBehindTheScenes: () => {
        bills = [tabBill, cancelled];
      },
      failReads: () => {
        readsFail = true;
      },
    };
  }

  /** The table is opened and the invoiced bill's Cancel and credit is pressed. */
  async function openCancel(overrides: Record<string, unknown> = {}) {
    const mounted = await mountApp({
      listCancelCreditAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "sup-1", displayName: "Luis" }]),
      ...billServer(),
      ...overrides,
    });
    await openPartyTable(mounted.el);
    await pressCancelCredit(mounted.el);
    return mounted;
  }

  /** The invoiced bill is put on screen, and the ⋮'s Cancel and credit is pressed. */
  async function pressCancelCredit(el: TillApp): Promise<void> {
    const order = tableOrder(el)!;
    if (order.orderId !== "wo-check") {
      await switchToBill(order, "wo-check");
      await flush(el);
    }
    order.shadowRoot!.querySelector<HTMLElement>("[data-table-menu] [data-cancel-credit]")!.click();
    await flush(el);
  }

  async function typeReason(el: TillApp, reason: string): Promise<void> {
    const input = dialog(el)!
      .shadowRoot!.querySelector('wt-input[name="reason"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = reason;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
  }

  async function confirmCancel(el: TillApp): Promise<void> {
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]")!.click();
    await flush(el, 6);
  }

  it("opens over the table naming the bill's invoice and amount, and sends nothing yet", async () => {
    const { el } = await openCancel();

    expect(dialog(el)!.invoiceNumber).toBe("A/12");
    expect(dialog(el)!.amount).toBe("30.00");
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it("with the permission, sends the reason alone and names the corrective the bills now carry", async () => {
    const { el } = await openCancel();

    await typeReason(el, "  Charged to the wrong table ");
    await confirmCancel(el);

    expect(api.cancelOrder).toHaveBeenCalledOnce();
    expect(vi.mocked(api.cancelOrder).mock.calls[0]).toEqual([
      "wo-check",
      "Charged to the wrong table",
      undefined,
      { signal: expect.any(AbortSignal) },
    ]);
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
    expect(offered(el)).toBeNull();

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
  });

  it("without the permission, asks someone who may issue corrective invoices for their PIN and sends it with the same reason", async () => {
    let refuse = true;
    const server = billServer(async () => {
      if (refuse) {
        refuse = false;
        throw { code: "authorization.not_permitted", status: 403 };
      }
    });
    const { el } = await openCancel({ ...server, openDrawer: vi.fn() });

    await typeReason(el, "Wrong table");
    await confirmCancel(el);

    expect(api.listCancelCreditAuthorizers).toHaveBeenCalledOnce();
    expect(approval(el)!.authorizers).toEqual([{ personId: "sup-1", displayName: "Luis" }]);
    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(server.cancelOrder.mock.calls[1]).toEqual([
      "wo-check",
      "Wrong table",
      { personId: "sup-1", pin: "4321" },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(approval(el)).toBeNull();
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
    expect(api.openDrawer).not.toHaveBeenCalled();
  });

  it("shows a wrong PIN in the PIN prompt, and sends nothing more", async () => {
    let sends = 0;
    const server = billServer(async () => {
      sends++;
      throw sends === 1
        ? { code: "authorization.not_permitted", status: 403 }
        : { code: "pin.invalid", status: 401 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);

    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "0000" });
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(approval(el)!.error).toEqual({ code: "pin.invalid", personId: "sup-1" });
    expect(doneText(el)).toBeNull();
  });

  it.each([
    ["bill.payments_received", "cancel_credit.refused_payments"],
    ["order.payment_in_flight", "cancel_credit.refused_payment_in_flight"],
  ] as const)(
    "closes the PIN prompt and keeps the dialog open with %s's sentence when it follows the approver's PIN, and reads the bills again",
    async (code, key) => {
      let sends = 0;
      const server = billServer(async () => {
        sends++;
        throw sends === 1
          ? { code: "authorization.not_permitted", status: 403 }
          : { code, status: 409 };
      });
      const { el } = await openCancel(server);
      const billReads = server.getPartyBills.mock.calls.length;
      await typeReason(el, "Wrong table");
      await confirmCancel(el);

      emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
      await flush(el, 6);

      expect(server.cancelOrder).toHaveBeenCalledTimes(2);
      expect(approval(el)).toBeNull();
      expect(dialog(el)).not.toBeNull();
      expect(bottom(el)).toBe(t(key));
      expect(doneText(el)).toBeNull();
      expect(server.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
    },
  );

  it("Cancel on the PIN prompt closes it, leaves the dialog open and sends nothing more", async () => {
    const server = billServer(async () => {
      throw { code: "authorization.not_permitted", status: 403 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);

    emit(approval(el)!, "override-cancel");
    await flush(el);

    expect(approval(el)).toBeNull();
    expect(dialog(el)).not.toBeNull();
    expect(server.cancelOrder).toHaveBeenCalledOnce();
  });

  it("says who can approve it could not be read, and opens no PIN prompt", async () => {
    const { el } = await openCancel({
      ...billServer(async () => {
        throw { code: "authorization.not_permitted", status: 403 };
      }),
      listCancelCreditAuthorizers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(approval(el)).toBeNull();
    expect(bottom(el)).toBe(t("cancel_credit.approvers_failed"));
  });

  it("gives up reading who can approve it at the time limit, and says it could not be read", async () => {
    const { el } = await openCancel({
      ...billServer(async () => {
        throw { code: "authorization.not_permitted", status: 403 };
      }),
      listCancelCreditAuthorizers: vi.fn(
        (options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    });
    await typeReason(el, "Wrong table");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await confirmCancel(el);
      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1);
      await flush(el, 6);
      expect(dialog(el)!.busy).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await flush(el, 6);

      expect(dialog(el)!.busy).toBe(false);
      expect(approval(el)).toBeNull();
      expect(bottom(el)).toBe(t("cancel_credit.approvers_failed"));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["bill.payments_received", "cancel_credit.refused_payments"],
    ["order.payment_in_flight", "cancel_credit.refused_payment_in_flight"],
    ["series.no_corrective_for_node", null],
    ["device.unauthorized", null],
    ["sale.correction_exceeds_total", null],
    ["sale.correction_not_whole", null],
    ["working_order.not_placed", null],
  ] as const)(
    "keeps the dialog open with %s's sentence, and reads the bills again",
    async (code, key) => {
      const server = billServer(async () => {
        throw { code, status: 409 };
      });
      const { el } = await openCancel(server);
      const billReads = server.getPartyBills.mock.calls.length;
      await typeReason(el, "Wrong table");

      await confirmCancel(el);

      expect(server.cancelOrder).toHaveBeenCalledOnce();
      expect(bottom(el)).toBe(key === null ? codeMessage(code) : t(key));
      expect(doneText(el)).toBeNull();
      expect(server.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
    },
  );

  it("when the cancel got no answer and the bills read again show it cancelled, says so without sending it again", async () => {
    const server = billServer();
    server.cancelOrder.mockImplementationOnce(async () => {
      server.cancelBehindTheScenes();
      throw new TypeError("Failed to fetch");
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
  });

  it("when the cancel got no answer and the bill still waits for payment, says it may have been made, without sending it again", async () => {
    const server = billServer();
    server.cancelOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(bottom(el)).toBe(t("cancel_credit.unconfirmed"));
    expect(doneText(el)).toBeNull();
  });

  it("a second press refused as no longer waiting, once the first cancel that got no answer has landed, names the corrective", async () => {
    const server = billServer();
    server.cancelOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    server.cancelOrder.mockImplementationOnce(async () => {
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);
    expect(bottom(el)).toBe(t("cancel_credit.unconfirmed"));

    server.cancelBehindTheScenes();
    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
  });

  it("a cancel refused as no longer waiting shows that refusal when the bills cannot be read again", async () => {
    const server = billServer(async () => {
      server.cancelBehindTheScenes();
      server.failReads();
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(bottom(el)).toBe(codeMessage("working_order.not_placed"));
    expect(doneText(el)).toBeNull();
  });

  it("when the bills cannot be read after the cancel, still says the bill is cancelled and offers no cancel again", async () => {
    const server = billServer();
    server.cancelOrder.mockImplementationOnce(async () => server.failReads());
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(offered(el)).toBeNull();
  });

  it("shows a completed table cancel while the corrective read has not answered", async () => {
    const server = billServer();
    const { el } = await openCancel(server);
    server.getPartyBills.mockImplementationOnce(() => new Promise<PartyBill[]>(() => undefined));
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(dialog(el)!.busy).toBe(false);
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
  });

  it("shows a table cancel refusal while the follow-up bills read has not answered", async () => {
    const server = billServer(async () => {
      throw { code: "bill.payments_received", status: 409 };
    });
    const { el } = await openCancel(server);
    server.getPartyBills.mockImplementationOnce(() => new Promise<PartyBill[]>(() => undefined));
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(dialog(el)!.busy).toBe(false);
    expect(bottom(el)).toBe(t("cancel_credit.refused_payments"));
  });

  it("keeps the retry's corrective number when the earlier bills read answers late", async () => {
    let sends = 0;
    const server = billServer(async () => {
      sends++;
      if (sends === 1) throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openCancel(server);
    let answerFirst: (bills: PartyBill[]) => void = () => undefined;
    server.getPartyBills.mockImplementationOnce(
      () => new Promise<PartyBill[]>((resolve) => (answerFirst = resolve)),
    );
    await typeReason(el, "Wrong table");

    await confirmCancel(el);
    expect(dialog(el)!.busy).toBe(false);
    expect(dialog(el)!.refusal).not.toBeNull();

    await confirmCancel(el);
    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));

    answerFirst([tabBill, { ...cancelled, correctives: [] }]);
    await flush(el, 5);

    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
  });

  it("an earlier operator's cancel answering after a sign-out leaves the next operator's PIN prompt open", async () => {
    let sends = 0;
    let answerFirst: () => void = () => undefined;
    const server = billServer(async () => {
      sends++;
      if (sends === 1) await new Promise<void>((resolve) => (answerFirst = resolve));
      else throw { code: "authorization.not_permitted", status: 403 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);
    emit(tableOrder(el)!, "logout");
    const warning = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => warning.open).toBe(true);
    await warning.updateComplete;
    warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => warning.open).toBe(false);
    await flush(el);
    expect(dialog(el)).toBeNull();
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    await pressCancelCredit(el);
    await typeReason(el, "Charged to the wrong table");
    await confirmCancel(el);
    expect(approval(el)).not.toBeNull();

    answerFirst();
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(approval(el)).not.toBeNull();
    expect(dialog(el)!.done).toBeNull();
  });

  describe("a cancel that gets no answer at all", () => {
    afterEach(() => vi.useRealTimers());

    /** A cancel that never answers, and rejects as `fetch` does once its signal aborts, after
     * `meanwhile` runs. */
    function unanswered(meanwhile: () => void = () => undefined) {
      return vi.fn(
        (_id: string, _reason: string, _override?: unknown, options?: { signal?: AbortSignal }) =>
          new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () => {
              meanwhile();
              reject(new DOMException("aborted", "AbortError"));
            }),
          ),
      );
    }

    it("is given up at the time limit, the bills are read again, and the operator may try again while the bill still waits", async () => {
      const server = billServer();
      const cancelOrder = unanswered();
      const { el } = await openCancel({ ...server, cancelOrder });
      await typeReason(el, "Wrong table");
      const billReads = server.getPartyBills.mock.calls.length;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await confirmCancel(el);
      expect(dialog(el)!.busy).toBe(true);

      await vi.advanceTimersByTimeAsync(150_000);
      await flush(el, 6);

      expect(cancelOrder).toHaveBeenCalledOnce();
      expect(cancelOrder.mock.calls[0]![3]).toEqual({ signal: expect.any(AbortSignal) });
      expect(server.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
      expect(dialog(el)!.busy).toBe(false);
      expect(bottom(el)).toBe(t("cancel_credit.unconfirmed"));
      expect(
        dialog(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
          "[data-cancel-credit-confirm]",
        )!.disabled,
      ).toBe(false);
    });

    it("is given up at the time limit, and a bill the bills read again show cancelled is shown cancelled", async () => {
      const server = billServer();
      const cancelOrder = unanswered(() => server.cancelBehindTheScenes());
      const { el } = await openCancel({ ...server, cancelOrder });
      await typeReason(el, "Wrong table");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await confirmCancel(el);

      await vi.advanceTimersByTimeAsync(150_000);
      await flush(el, 6);

      expect(cancelOrder).toHaveBeenCalledOnce();
      expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
    });
  });

  it("an accepted table credit clears unload protection before its bill refresh starts", async () => {
    const { el } = await openCancel();
    await typeReason(el, "  Wrong table  ");
    let protectedAtRefresh: boolean | undefined;
    vi.mocked(api.getPartyBills).mockImplementation(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      protectedAtRefresh = event.defaultPrevented;
      return new Promise(() => {});
    });
    await confirmCancel(el);
    expect(protectedAtRefresh).toBe(false);
    expect(vi.mocked(api.cancelOrder).mock.calls).toEqual([
      ["wo-check", "Wrong table", undefined, { signal: expect.any(AbortSignal) }],
    ]);
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });

  for (const action of ["Keep the bill", "Escape"]) {
    it(`table cancel-credit ${action} discards only the local reason and keeps both bills`, async () => {
      const { el } = await openCancel();
      await typeReason(el, "  Wrong table  ");
      if (action === "Escape") {
        dialog(el)!
          .shadowRoot!.querySelector("wt-input")!
          .shadowRoot!.querySelector("input")!
          .focus();
        await userEvent.keyboard("{Escape}");
      } else
        dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
      await flush(el);
      const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
      await q.updateComplete;
      expect(q.open).toBe(true);
      expect(api.cancelOrder).not.toHaveBeenCalled();
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(dialog(el)!.shadowRoot!.querySelector("wt-input")!.value).toBe("  Wrong table  ");
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
      await flush(el);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => dialog(el)).toBeNull();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el)!.bills).toEqual([tabBill, invoiced]);
      expect(api.cancelOrder).not.toHaveBeenCalled();
      expect(api.listCancelCreditAuthorizers).not.toHaveBeenCalled();
    });
  }

  it("Cancel closes the dialog and sends nothing", async () => {
    const { el } = await openCancel();

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });
});

describe("till-app: reopening a printed bill to split it", () => {
  const invoiced: PartyBill = {
    ...checkBill,
    status: "placed",
    receiptAvailable: true,
    invoiceNumber: "A/12",
    correctives: [],
  };
  const cancelled: PartyBill = {
    ...invoiced,
    status: "abandoned",
    outstanding: "0.00",
    correctives: ["R/3"],
  };
  const reopened: PartyBill = { ...checkBill, workingOrderId: "wo-split", billNumber: 3 };
  const unserved = [
    { lineId: "l-1", dishName: "Steak", quantity: "1", released: true },
    { lineId: "l-2", dishName: "Tarta", quantity: "1", released: false },
  ];
  const dialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillCancelCreditDialog>("till-cancel-credit-dialog");
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog[data-cancel-credit-approval]",
    );
  const bottom = (el: TillApp) =>
    dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
      .error;
  const doneText = (el: TillApp) =>
    dialog(el)!
      .shadowRoot!.querySelector("[data-cancel-credit-done]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;

  /** The server's side: `splitAfterPrint` cancels the bill and opens `wo-split`, unless it rejects. */
  function billServer(
    refuse: () => Promise<void> = async () => {},
    first: PartyBill[] = [tabBill, invoiced],
  ) {
    let bills: PartyBill[] = first;
    return {
      getPartyBills: vi.fn(async () => bills),
      splitAfterPrint: vi.fn(async () => {
        await refuse();
        bills = [tabBill, cancelled, reopened];
        return { billId: "wo-split", correctiveNumber: "R/3" };
      }),
      splitBehindTheScenes: () => {
        bills = [tabBill, cancelled, reopened];
      },
      /** Cancel and credit made on another till: the bill is credited and no new bill opens. */
      cancelledElsewhere: () => {
        bills = [tabBill, cancelled];
      },
      /** Cancel and credit on another till of the party's only bill in use: the server opens it a
       * fresh empty bill (`ensureFamilyBill`). */
      cancelledElsewhereLeavingEmptyBill: () => {
        bills = [cancelled, { ...reopened, total: "0.00", outstanding: "0.00" }];
      },
    };
  }

  async function openSplit(overrides: Record<string, unknown> = {}, handsOver = true) {
    const mounted = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        capabilities: [...till.capabilities, ...(handsOver ? ["hand-over-orders"] : [])],
      }),
      listCancelCreditAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "sup-1", displayName: "Luis" }]),
      ...billServer(),
      ...overrides,
    });
    await openPartyTable(mounted.el);
    const order = tableOrder(mounted.el)!;
    if (order.orderId !== "wo-check") await switchToBill(order, "wo-check");
    await flush(mounted.el);
    order
      .shadowRoot!.querySelector<HTMLElement>("[data-table-menu] [data-split-after-print]")!
      .click();
    await flush(mounted.el);
    return mounted;
  }

  async function confirmSplit(el: TillApp): Promise<void> {
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]")!.click();
    await flush(el, 8);
  }

  it("opens in split mode, splits, names the corrective and opens the new bill", async () => {
    const server = billServer();
    const cancelOrder = vi.fn();
    const { el } = await openSplit({ ...server, cancelOrder });

    expect(dialog(el)!.mode).toBe("split");
    expect(dialog(el)!.invoiceNumber).toBe("A/12");
    expect(server.splitAfterPrint).not.toHaveBeenCalled();
    await confirmSplit(el);

    expect(server.splitAfterPrint.mock.calls).toEqual([
      ["wo-check", undefined, { signal: expect.any(AbortSignal) }],
    ]);
    expect(doneText(el)).toBe(t("split.done").replace("{number}", "R/3"));
    await expect.poll(() => tableOrder(el)!.orderId).toBe("wo-split");
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("when the split got no answer and the bills read again show a new bill, says it split", async () => {
    const server = billServer();
    server.splitAfterPrint.mockImplementationOnce(async () => {
      server.splitBehindTheScenes();
      throw new TypeError("Failed to fetch");
    });
    const { el } = await openSplit(server);

    await confirmSplit(el);

    expect(server.splitAfterPrint).toHaveBeenCalledOnce();
    expect(doneText(el)).toBe(t("split.done").replace("{number}", "R/3"));
  });

  it("a second press refused as no longer waiting, once the first split that got no answer has landed, says it split", async () => {
    const server = billServer();
    server.splitAfterPrint.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    server.splitAfterPrint.mockImplementationOnce(async () => {
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openSplit(server);
    await confirmSplit(el);
    expect(bottom(el)).toBe(t("split.unconfirmed"));

    server.splitBehindTheScenes();
    await confirmSplit(el);

    expect(server.splitAfterPrint).toHaveBeenCalledTimes(2);
    expect(doneText(el)).toBe(t("split.done").replace("{number}", "R/3"));
  });

  it("a split refused as no longer waiting, because the bill was cancelled and credited elsewhere, does not say it split", async () => {
    const server = billServer();
    server.splitAfterPrint.mockImplementationOnce(async () => {
      server.cancelledElsewhere();
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openSplit(server);

    await confirmSplit(el);

    expect(doneText(el)).not.toContain("Move each guest");
    expect(doneText(el)).toBe(t("split.credited_elsewhere").replace("{number}", "R/3"));
    expect(tableOrder(el)!.orderId).not.toBe("wo-split");
  });

  it("a split refused as no longer waiting, because the party's only bill was cancelled and credited elsewhere and an empty bill opened in its place, does not say it split", async () => {
    const server = billServer(async () => {}, [invoiced]);
    server.splitAfterPrint.mockImplementationOnce(async () => {
      server.cancelledElsewhereLeavingEmptyBill();
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openSplit(server);

    await confirmSplit(el);

    expect(doneText(el)).toBe(t("split.credited_elsewhere").replace("{number}", "R/3"));
  });

  it("without the permission, asks for an approver's PIN and sends it with the split", async () => {
    let refused = false;
    const server = billServer(async () => {
      if (!refused) {
        refused = true;
        throw { code: "authorization.not_permitted", status: 403 };
      }
    });
    const { el } = await openSplit(server);
    await confirmSplit(el);

    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el, 8);

    expect(server.splitAfterPrint.mock.calls[1]).toEqual([
      "wo-check",
      { personId: "sup-1", pin: "4321" },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(approval(el)).toBeNull();
    expect(doneText(el)).toBe(t("split.done").replace("{number}", "R/3"));
  });

  it("lists the dishes not marked served, and Mark served serves them and splits again", async () => {
    let refused = false;
    const server = billServer(async () => {
      if (!refused) {
        refused = true;
        throw {
          code: "bill.unserved_dishes",
          status: 409,
          workingOrderId: "wo-check",
          dishes: unserved,
        };
      }
    });
    const { el } = await openSplit(server);
    await confirmSplit(el);

    expect(dialog(el)!.refusal?.dishes).toEqual(unserved);
    expect(dialog(el)!.canMarkServed).toBe(true);
    emit(dialog(el)!, "split-mark-served", { items: [{ lineId: "l-1", quantity: "1" }] });
    await flush(el, 8);

    expect(api.markServed).toHaveBeenCalledWith("v1", [{ lineId: "l-1", quantity: "1" }], {
      submissionId: expect.any(String),
      expectedPartyRevision: expect.any(Number),
    });
    expect(server.splitAfterPrint).toHaveBeenCalledTimes(2);
    expect(doneText(el)).toBe(t("split.done").replace("{number}", "R/3"));
  });

  it("on a device that does not hand orders over, offers no Mark served and says where to mark them", async () => {
    const server = billServer(async () => {
      throw {
        code: "bill.unserved_dishes",
        status: 409,
        workingOrderId: "wo-check",
        dishes: unserved,
      };
    });
    const { el } = await openSplit(server, false);
    await confirmSplit(el);

    expect(dialog(el)!.refusal?.dishes).toEqual(unserved);
    expect(dialog(el)!.canMarkServed).toBe(false);
    const box = dialog(el)!.shadowRoot!.querySelector("[data-split-unserved]")!;
    expect(box.textContent).toContain(t("split.unserved_no_mark"));
    expect(box.querySelector("[data-split-mark-served]")).toBeNull();
  });

  it("says Mark served's refusal and splits nothing more", async () => {
    const server = billServer(async () => {
      throw {
        code: "bill.unserved_dishes",
        status: 409,
        workingOrderId: "wo-check",
        dishes: unserved,
      };
    });
    const { el } = await openSplit({
      ...server,
      markServed: vi.fn().mockRejectedValue({ code: "group.line_held", status: 409 }),
    });
    await confirmSplit(el);

    emit(dialog(el)!, "split-mark-served", { items: [{ lineId: "l-1", quantity: "1" }] });
    await flush(el, 8);

    expect(server.splitAfterPrint).toHaveBeenCalledOnce();
    expect(bottom(el)).toBe(codeMessage("group.line_held"));
  });

  it.each([
    ["bill.left_unpaid", "split.refused_left_unpaid"],
    ["bill.not_at_table", "split.refused_not_at_table"],
    ["bill.not_issued", "split.refused_not_issued"],
  ] as const)("keeps the dialog open with %s's sentence", async (code, key) => {
    const server = billServer(async () => {
      throw { code, status: 409, workingOrderId: "wo-check" };
    });
    const { el } = await openSplit(server);
    await confirmSplit(el);

    expect(bottom(el)).toBe(t(key));
    expect(doneText(el)).toBeNull();
    expect(tableOrder(el)!.orderId).toBe("wo-check");
  });
});

describe("till-app: Finish table confirms paid unserved dishes", () => {
  type Dish = import("./api/finish-table-types.js").UnservedDish;
  type Consent = import("./api/line-cancel-types.js").CancellationRead;
  type FinishDialog = HTMLElementTagNameMap["till-finish-table-dialog"];
  const cash = {
    tenderId: "cash-1",
    method: "cash",
    manual: false,
    last4: null,
    appliedRemaining: "30.00",
    tipRemaining: "2.00",
    pendingRefundId: null,
  };
  function dish(lineId = "line-1", billId = "wo-4"): Dish {
    return {
      billId,
      billRevision: 0,
      lineId,
      name: lineId === "line-1" ? "Flan" : "Water",
      quantity: "1.000",
      context: {
        billStatus: "settled",
        stage: "not_started",
        components: [
          {
            id: `ticket-${lineId}`,
            lineId,
            state: "queued",
            firedAt: null,
            requestedAt: null,
            stationId: "station-1",
            quantity: "2.000",
            kitchenQuantity: "2.000",
            servedQuantity: "1.000",
            cancelledQuantity: "0.000",
          },
        ],
      },
    };
  }
  function consent(row = dish()): Consent {
    return {
      billId: row.billId,
      billRevision: row.billRevision,
      revision: 3,
      context: structuredClone(row.context),
      saleId: `sale-${row.billId}`,
      refundValue: { quantity: "2.000", gross: "11.00" },
    };
  }
  const refusal = (rows = [dish()]) => ({
    code: "party.unserved_dishes",
    partyId: "v1",
    dishes: rows,
  });
  const finishDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<FinishDialog>("till-finish-table-dialog");
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>("[data-finish-approval]");
  async function mountFinish(overrides: Record<string, unknown> = {}) {
    return mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "take-cash"] }),
      finishTable: vi.fn().mockRejectedValueOnce(refusal()).mockResolvedValue({ state: "closed" }),
      getPartyBills: vi.fn(async (partyId: string) =>
        partyId === "v7"
          ? [{ ...tabBill, partyId, workingOrderId: "wo-7" }]
          : [tabBill, checkBill].map((row) => ({
              ...row,
              status: "settled",
              outstanding: "0.00",
              hasPayments: true,
            })),
      ),
      getCancellation: vi.fn(async (_party: string, lineId: string) =>
        consent(dish(lineId, lineId === "line-1" ? "wo-4" : "wo-check")),
      ),
      getRefundableTenders: vi.fn().mockResolvedValue([cash]),
      getTransactionReceipt: vi.fn().mockResolvedValue(saleResult),
      listRefundAuthorizers: vi.fn().mockResolvedValue([{ personId: "m1", displayName: "Marta" }]),
      refundTransaction: vi.fn(),
      ...overrides,
    });
  }
  async function openFinish(el: TillApp) {
    emit(await openPartyTable(el), "finish-table");
    await flush(el, 8);
    return finishDialog(el);
  }
  async function choose(el: TillApp, refund = false) {
    const dialog = finishDialog(el)!;
    expect(dialog).not.toBeNull();
    await dialog.updateComplete;
    emit(dialog.shadowRoot!.querySelector('wt-combobox[name="reason"]')!, "wt-change", {
      value: "r-cancel",
    });
    await dialog.updateComplete;
    if (!refund)
      for (const input of dialog.shadowRoot!.querySelectorAll<HTMLInputElement>(
        'input[name="refund"]',
      )) {
        if (input.checked) await userEvent.click(input);
      }
    await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!);
    await flush(el, 8);
  }

  it("opens the paid-food dialog with the authoritative filed remainder and no guessed reason", async () => {
    const { el } = await mountFinish();
    const dialog = await openFinish(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.dishes).toEqual([dish()]);
    expect(dialog!.refunds).toEqual({ "line-1": "5.50" });
    expect(dialog!.defaultReasonId).toBe("");
    expect(dialog!.reasons?.map((row) => row.id)).toEqual(["r-cancel"]);
    expect(api.getCancellation).toHaveBeenCalledWith(
      "v1",
      "line-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(api.getRefundableTenders).toHaveBeenCalledWith(
      "sale-wo-4",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(api.finishTable).toHaveBeenCalledOnce();
    expect(tableOrder(el)).not.toBeNull();
  });

  it("cancels the complete observed set and closes with every family editing observation", async () => {
    const { el } = await mountFinish();
    await openFinish(el);
    await choose(el);
    expect(api.finishTable).toHaveBeenCalledTimes(2);
    const call = vi.mocked(api.finishTable).mock.calls[1]!;
    expect(call.slice(0, 3)).toEqual(["v1", 3, closingEdits]);
    expect(call[3]).toEqual({
      submissionId: expect.any(String),
      cancellations: [
        {
          lineId: "line-1",
          quantity: "1.000",
          expectedBillRevision: 0,
          expectedContext: dish().context,
          reasonId: "r-cancel",
        },
      ],
    });
    expect(call[4]).toEqual({ signal: expect.any(AbortSignal) });
    expect(finishDialog(el)).toBeNull();
    expect(tableOrder(el)).toBeNull();
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    expect(drafts.saveDraft).not.toHaveBeenCalled();
    expect(drafts.takeOverDraft).not.toHaveBeenCalled();
  });

  it.each(["none", "pending", "tip-only"])(
    "shows no Refund tick for %s principal on this device",
    async (kind) => {
      const { el } = await mountFinish(
        kind === "none"
          ? {
              getTill: vi.fn().mockResolvedValue(till),
            }
          : {
              getRefundableTenders: vi.fn().mockResolvedValue([
                {
                  ...cash,
                  ...(kind === "pending"
                    ? { pendingRefundId: "pending" }
                    : { appliedRemaining: "0.00" }),
                },
              ]),
            },
      );
      const dialog = await openFinish(el);
      expect(dialog).not.toBeNull();
      expect(dialog!.refunds).toEqual({});
      expect(dialog!.shadowRoot!.querySelector('input[name="refund"]')).toBeNull();
      expect(dialog!.refundAtTill).toBe(kind === "none");
      await choose(el);
      expect(
        (vi.mocked(api.finishTable).mock.calls[1]![3] as FinishTableResolution).cancellations[0],
      ).not.toHaveProperty("refundHandoff");
      expect(api.listRefundAuthorizers).not.toHaveBeenCalled();
    },
  );

  it.each(["getCancellation", "getRefundableTenders"])(
    "retries a failed %s rather than assuming no refund",
    async (method) => {
      const read = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(method === "getCancellation" ? consent() : [cash]);
      const { el } = await mountFinish({
        [method]: read,
        finishTable: vi.fn().mockRejectedValue(refusal()),
      });
      await openFinish(el);
      expect(finishDialog(el)).toBeNull();
      expect(banner(el)).not.toBeNull();
      emit(tableOrder(el)!, "finish-table");
      await flush(el, 8);
      expect(finishDialog(el)).not.toBeNull();
      expect(finishDialog(el)!.refunds).toEqual({ "line-1": "5.50" });
    },
  );

  it("retains a failed reason read and retries it in the dialog", async () => {
    const reasons = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue([]);
    const { el } = await mountFinish({ listAdjustmentReasons: reasons });
    const dialog = await openFinish(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.reasons).toBeNull();
    expect(dialog!.refusal).toBe(t("adjust.reasons_error"));
    emit(dialog!, "finish-table-reasons");
    await flush(el);
    expect(finishDialog(el)!.reasons).toEqual([]);
    expect(finishDialog(el)!.refusal).toBe("");
  });

  it.each([
    ["starts Finish table's reason on Not served", true],
    ["starts it empty when no reason is marked", false],
  ])("%s", async (_name, marked) => {
    const notServed = {
      ...cancelReason,
      id: "r-not-served",
      name: "Never reached the table",
      startsFinishTable: marked,
    };
    const pending = held();
    const { el } = await mountFinish({ listAdjustmentReasons: pending.call });
    const dialog = await openFinish(el);
    expect(dialog!.reasons).toBeNull();
    pending.answer.settle([{ ...cancelReason, startsFinishTable: false }, notServed]);
    await flush(el, 6);
    const opened = finishDialog(el)!;
    await opened.updateComplete;
    const expected = marked ? "r-not-served" : "";
    expect(opened.defaultReasonId).toBe(expected);
    expect(opened.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="reason"]')!.value).toBe(
      expected,
    );
  });

  it.each(["getCancellation", "getRefundableTenders", "listAdjustmentReasons"])(
    "drops late %s answers after API replacement",
    async (method) => {
      const pending = held();
      const { el } = await mountFinish({ [method]: pending.call });
      await openFinish(el);
      el.api = stubApi();
      await flush(el);
      pending.answer.settle(
        method === "getCancellation" ? consent() : method === "getRefundableTenders" ? [cash] : [],
      );
      await flush(el, 6);
      expect(finishDialog(el)).toBeNull();
      expect(approval(el)).toBeNull();
      expect(banner(el)).toBeNull();
    },
  );

  it("keeps the finish action single while the first dish is being read", async () => {
    const pending = held();
    const { el } = await mountFinish({ getCancellation: pending.call });
    await openFinish(el);
    emit(tableOrder(el)!, "finish-table");
    await flush(el);
    expect(api.finishTable).toHaveBeenCalledOnce();
    pending.answer.settle(consent());
    await flush(el, 6);
    expect(finishDialog(el)).not.toBeNull();
  });

  it("opens the independent public refund only after the table closes", async () => {
    const pending = held();
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockImplementation(() => pending.call());
    const { el } = await mountFinish({ finishTable: finish });
    await openFinish(el);
    await choose(el, true);
    expect(tableOrder(el)).not.toBeNull();
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    pending.answer.settle({ state: "closed" });
    await flush(el, 10);
    expect(tableOrder(el)).toBeNull();
    expect(api.getTransactionReceipt).toHaveBeenCalledWith(
      "sale-wo-4",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-tender-refund-dialog"]>(
        "till-tender-refund-dialog",
      )!.attempt,
    ).toBeNull();
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("asks refund approval from the main action and keeps a wrong PIN retryable without storing it", async () => {
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockRejectedValueOnce({ code: "pin.invalid" })
      .mockResolvedValue({ state: "closed" });
    const { el } = await mountFinish({ finishTable: finish });
    await openFinish(el);
    await choose(el, true);
    expect(approval(el)?.authorizers).toEqual([{ personId: "m1", displayName: "Marta" }]);
    expect(approval(el)?.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Approval needed");
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    const first = finish.mock.calls[1]![3];
    expect(first.cancellations[0].refundHandoff).toBe(true);
    emit(approval(el)!, "override-confirm", { personId: "m1", pin: "1111" });
    await flush(el, 8);
    expect(approval(el)?.error).toEqual({ code: "pin.invalid", personId: "m1" });
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    emit(approval(el)!, "override-confirm", { personId: "m1", pin: "7777" });
    await flush(el, 10);
    expect(finish.mock.calls[3]![3]).toEqual({
      ...first,
      approver: { personId: "m1", pin: "7777" },
    });
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).not.toBeNull();
    for (const storage of [localStorage, sessionStorage])
      for (const key of Object.keys(storage)) expect(storage.getItem(key)).not.toContain("7777");
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it("keeps the chosen fields when approval is cancelled", async () => {
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    await openFinish(el);
    await choose(el, true);
    expect(approval(el)).not.toBeNull();
    emit(approval(el)!, "override-cancel");
    await flush(el);
    expect(approval(el)).toBeNull();
    const dialog = finishDialog(el)!;
    expect(dialog.busy).toBe(false);
    expect(
      dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="refund"]')!.checked,
    ).toBe(true);
    expect(dialog.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="reason"]')!.value).toBe(
      "r-cancel",
    );
  });

  it("retries an approver read failure from the retained main action", async () => {
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValue({ code: "authorization.not_permitted" }),
      listRefundAuthorizers: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue([]),
    });
    await openFinish(el);
    await choose(el, true);
    expect(approval(el)).toBeNull();
    expect(finishDialog(el)!.busy).toBe(false);
    expect(finishDialog(el)!.refusal).toBe(codeMessage("server.internal"));
    await userEvent.click(
      finishDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!,
    );
    await flush(el, 8);
    expect(approval(el)?.authorizers).toEqual([]);
  });

  it("gives up reading who can approve finishing the table at the time limit, and says so", async () => {
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValue({ code: "authorization.not_permitted" }),
      listRefundAuthorizers: vi.fn(
        (options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    });
    await openFinish(el);
    const dialog = finishDialog(el)!;
    await dialog.updateComplete;
    emit(dialog.shadowRoot!.querySelector('wt-combobox[name="reason"]')!, "wt-change", {
      value: "r-cancel",
    });
    await dialog.updateComplete;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1);
      await el.updateComplete;
      expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
      expect(finishDialog(el)!.busy).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await el.updateComplete;

      expect(finishDialog(el)!.busy).toBe(false);
      expect(approval(el)).toBeNull();
      expect(finishDialog(el)!.refusal).toBe(codeMessage("server.internal"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a late approver read after closing the paid-food dialog", async () => {
    const people = held();
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValue({ code: "authorization.not_permitted" }),
      listRefundAuthorizers: people.call,
    });
    await openFinish(el);
    await choose(el, true);
    emit(finishDialog(el)!, "finish-table-close");
    await flush(el);
    people.answer.settle([{ personId: "old", displayName: "Old" }]);
    await flush(el, 8);
    expect(finishDialog(el)).toBeNull();
    expect(approval(el)).toBeNull();
  });

  it("re-prompts a raced kitchen set without confirming its new facts automatically", async () => {
    const changed = {
      ...dish(),
      quantity: "0.500",
      context: { ...dish().context, stage: "started" as const },
    };
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce(refusal([changed]))
      .mockResolvedValue({ state: "closed" });
    const read = vi.fn().mockResolvedValueOnce(consent()).mockResolvedValue(consent(changed));
    const { el } = await mountFinish({ finishTable: finish, getCancellation: read });
    await openFinish(el);
    await choose(el);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(tableOrder(el)).not.toBeNull();
    expect(finishDialog(el)!.dishes).toEqual([changed]);
    expect(
      finishDialog(el)!.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="reason"]')!.value,
    ).toBe("");
    expect(
      finishDialog(el)!.shadowRoot!.querySelector<HTMLInputElement>('input[name="refund"]')!
        .checked,
    ).toBe(false);
    await choose(el);
    expect(finish.mock.calls[2]![3].cancellations[0].quantity).toBe("0.500");
    expect(finish.mock.calls[2]![3].submissionId).not.toBe(finish.mock.calls[1]![3].submissionId);
    expect(tableOrder(el)).toBeNull();
  });

  it.each(["bill", "party", "kitchen"])(
    "refuses an opening %s observation that changed during its reads",
    async (kind) => {
      const value = consent();
      if (kind === "bill") value.billRevision++;
      if (kind === "party") value.revision++;
      if (kind === "kitchen") value.context.stage = "started";
      const { el } = await mountFinish({ getCancellation: vi.fn().mockResolvedValue(value) });
      await openFinish(el);
      expect(finishDialog(el)).toBeNull();
      expect(api.finishTable).toHaveBeenCalledOnce();
      expect(banner(el)?.textContent).toContain(codeMessage("tab.cancel_context_changed"));
    },
  );

  it.each(["requestedAt", "stationId"])(
    "refuses an opening observation whose kitchen %s changed during its reads",
    async (field) => {
      const value = consent();
      const component = value.context.components[0]!;
      if (field === "requestedAt") component.requestedAt = "2026-09-27T10:00:00.000Z";
      else component.stationId = "station-2";
      const { el } = await mountFinish({ getCancellation: vi.fn().mockResolvedValue(value) });
      await openFinish(el);
      expect(finishDialog(el)).toBeNull();
      expect(api.finishTable).toHaveBeenCalledOnce();
      expect(banner(el)?.textContent).toContain(codeMessage("tab.cancel_context_changed"));
    },
  );

  it("keeps a changed editing observation from reaching the Finish command", async () => {
    let changed = false;
    const listDrafts = vi.fn(async () => {
      const snapshot = await drafts.listDrafts("v1");
      if (changed) snapshot.billEdits.find((row) => row.billId === "wo-check")!.editorVersion++;
      return snapshot;
    });
    const { el } = await mountFinish({ listDrafts });
    await openFinish(el);
    changed = true;
    const count = listDrafts.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await expect.poll(() => listDrafts.mock.calls.length).toBeGreaterThan(count);
    await flush(el, 6);
    await choose(el);
    expect(api.finishTable).toHaveBeenCalledOnce();
    expect(finishDialog(el)!.busy).toBe(false);
    expect(finishDialog(el)!.refusal).toBe(codeMessage("draft.out_of_date"));
  });

  it.each(["missing", "extra", "refund"])(
    "rejects a synthetic %s cancellation choice",
    async (fault) => {
      const { el } = await mountFinish(
        fault === "refund" ? { getTill: vi.fn().mockResolvedValue(till) } : {},
      );
      await openFinish(el);
      const cancellation = {
        lineId: "line-1",
        quantity: "1.000",
        expectedBillRevision: 0,
        expectedContext: dish().context,
        reasonId: "r-cancel",
        ...(fault === "refund" ? { refundHandoff: true } : {}),
      };
      emit(finishDialog(el)!, "finish-table-choice", {
        cancellations:
          fault === "missing"
            ? []
            : fault === "extra"
              ? [cancellation, { ...cancellation, lineId: "other" }]
              : [cancellation],
      });
      await flush(el, 6);
      expect(api.finishTable).toHaveBeenCalledOnce();
    },
  );

  it("deduplicates receipt reads and allocates remaining principal across two dishes on one sale", async () => {
    const rows = [dish(), dish("line-2")];
    const { el } = await mountFinish({
      finishTable: vi.fn().mockRejectedValue(refusal(rows)),
      getCancellation: vi.fn(async (_p: string, id: string) =>
        consent(rows.find((row) => row.lineId === id)!),
      ),
      getRefundableTenders: vi.fn().mockResolvedValue([{ ...cash, appliedRemaining: "8.00" }]),
    });
    const dialog = await openFinish(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.refunds).toEqual({ "line-1": "5.50", "line-2": "2.50" });
    expect(api.getRefundableTenders).toHaveBeenCalledOnce();
  });

  function unserved(lineId: string): Dish {
    const row = dish(lineId);
    row.context.components[0]!.quantity = "1.000";
    row.context.components[0]!.kitchenQuantity = "1.000";
    row.context.components[0]!.servedQuantity = "0.000";
    return row;
  }
  const freeWater = (row: Dish, comesBackWith: string[]): Consent => ({
    ...consent(row),
    refundValue: { quantity: "1.000", gross: "1.67" },
    givenFree: true,
    comesBackWith,
  });

  it.each([
    ["every paid dish it names is listed", ["line-1", "line-2"], ["line-1", "line-2"]],
    ["it names a paid dish missing from the list", ["line-1", "line-set"], []],
    ["it names none", [], []],
  ])(
    "has a free item follow exactly the paid dishes its read names: %s",
    async (_, comesBackWith, follows) => {
      const rows = [unserved("line-1"), unserved("line-2"), unserved("line-w")];
      const { el } = await mountFinish({
        finishTable: vi.fn().mockRejectedValue(refusal(rows)),
        getCancellation: vi.fn(async (_p: string, id: string) => {
          const row = rows.find((candidate) => candidate.lineId === id)!;
          return id === "line-w" ? freeWater(row, comesBackWith) : consent(row);
        }),
      });
      const dialog = await openFinish(el);
      expect(dialog!.freeItems).toEqual({ "line-w": follows });
    },
  );

  it("gives a paid dish worth €0.00 on its own a €0.00 refund when its free item gives money back", async () => {
    const rows = [unserved("line-1"), unserved("line-w"), unserved("line-2")];
    const { el } = await mountFinish({
      finishTable: vi.fn().mockRejectedValue(refusal(rows)),
      getCancellation: vi.fn(async (_p: string, id: string) => {
        const row = rows.find((candidate) => candidate.lineId === id)!;
        if (id === "line-w") return freeWater(row, ["line-1"]);
        return { ...consent(row), refundValue: { quantity: "1.000", gross: "0.00" } };
      }),
    });
    const dialog = await openFinish(el);
    expect(dialog!.refunds).toEqual({ "line-1": "0.00", "line-w": "1.67" });
  });

  it.each([
    ["the free item is listed first", ["line-w", "line-1"]],
    ["the free item is listed last", ["line-1", "line-w"]],
  ])("gives the money left to the paid dish a free item comes back with: %s", async (_, order) => {
    const rows = order.map((lineId) => unserved(lineId));
    const { el } = await mountFinish({
      finishTable: vi.fn().mockRejectedValue(refusal(rows)),
      getCancellation: vi.fn(async (_p: string, id: string) => {
        const row = rows.find((candidate) => candidate.lineId === id)!;
        return id === "line-w"
          ? freeWater(row, ["line-1"])
          : { ...consent(row), refundValue: { quantity: "1.000", gross: "7.00" } };
      }),
      getRefundableTenders: vi.fn().mockResolvedValue([{ ...cash, appliedRemaining: "1.00" }]),
    });
    const dialog = await openFinish(el);
    const ticks = dialog!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="refund"]');
    expect(
      [...ticks].map((tick) => tick.closest("[data-dish]")!.getAttribute("data-dish")),
    ).toEqual(["line-1"]);
    expect(dialog!.refunds).toEqual({ "line-1": "1.00" });
  });

  it("re-reads the dishes and says in Finish's own words why a free item's refund was refused", async () => {
    const rows = [unserved("line-1"), unserved("line-w")];
    const getCancellation = vi.fn(async (_p: string, id: string) => {
      const row = rows.find((candidate) => candidate.lineId === id)!;
      return id === "line-w" ? freeWater(row, ["line-1"]) : consent(row);
    });
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal(rows))
        .mockRejectedValueOnce({ code: "tab.free_item_with_dish", reason: "free_item" }),
      getCancellation,
    });
    await openFinish(el);
    expect(getCancellation).toHaveBeenCalledTimes(2);
    await choose(el, true);
    await expect
      .poll(() => finishDialog(el)?.refusal)
      .toBe(
        "A dish given free on this bill can no longer come back with the paid dishes ticked here: the bill changed since this window opened. The window now shows it as it is: check the dishes and choose again.",
      );
    expect(getCancellation).toHaveBeenCalledTimes(4);
    expect(finishDialog(el)!.freeItems).toEqual({ "line-w": ["line-1"] });
  });

  describe("each receipt's refund opens filled in", () => {
    // A refund left awaiting its answer is saved for its sale, and would reopen in the next case.
    afterEach(() => {
      for (const key of Object.keys(localStorage))
        if (key.startsWith("waitron.tender-refund:")) localStorage.removeItem(key);
    });
    type RefundForm = HTMLElementTagNameMap["till-tender-refund-dialog"];
    const refundForm = (el: TillApp) =>
      el.shadowRoot!.querySelector<RefundForm>("till-tender-refund-dialog");
    const refundPrompt = (el: TillApp) =>
      el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
        "till-supervisor-override-dialog[data-tender-refund-approval]",
      );
    function named(lineId: string, name: string, quantity: string, billId = "wo-4"): Dish {
      return { ...dish(lineId, billId), name, quantity };
    }
    const refundTransaction = () =>
      vi.fn(async (saleId: string, ask: { tenderId: string; appliedAmount: string }) => ({
        id: `refund-${saleId}-${ask.appliedAmount}`,
        saleId,
        tenderId: ask.tenderId,
        state: "completed",
        appliedAmount: ask.appliedAmount,
        tipAmount: "0.00",
        createdAt: "2026-10-22T11:01:00.000Z",
        completedAt: "2026-10-22T11:01:01.000Z",
      }));
    const sent = () => vi.mocked(api.refundTransaction).mock.calls.map((call) => call[1]);
    async function untick(el: TillApp, index: number) {
      const dialog = finishDialog(el)!;
      await dialog.updateComplete;
      await userEvent.click(
        dialog.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="refund"]')[index]!,
      );
      await dialog.updateComplete;
    }
    async function openedRefund(el: TillApp) {
      await expect.poll(() => refundForm(el)?.reasons ?? null).not.toBeNull();
      await refundForm(el)!.updateComplete;
      return refundForm(el)!;
    }
    async function sendRefund(el: TillApp, change: Record<string, string> = {}) {
      const form = await openedRefund(el);
      for (const [name, value] of Object.entries(change))
        emit(form.shadowRoot!.querySelector(`[name="${name}"]`)!, "wt-change", { value });
      await form.updateComplete;
      await userEvent.click(
        page.elementLocator(form.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!),
      );
      await flush(el, 8);
    }
    async function openReceipt(el: TillApp, saleId: string) {
      await expect
        .poll(() => el.shadowRoot!.querySelector(`[data-finish-refund="${saleId}"]`))
        .not.toBeNull();
      await userEvent.click(
        el.shadowRoot!.querySelector<HTMLElement>(`[data-finish-refund="${saleId}"]`)!,
      );
      await flush(el, 10);
    }
    async function backToList(el: TillApp) {
      await expect.poll(() => refundForm(el)).toBeNull();
      emit(el.shadowRoot!.querySelector("till-ticket-view")!, "back-to-find-bill");
      await flush(el, 8);
    }

    it("opens each sale's refund filled in with its ticked dishes", async () => {
      const rows = [
        named("line-c", "Croquetas", "2.000"),
        named("line-1", "Flan", "1.000"),
        named("line-3", "Water", "1.000"),
      ];
      const { el } = await mountFinish({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal(rows))
          .mockResolvedValue({
            state: "closed",
            refundLinks: [
              { lineId: "line-1", adjustmentId: "adj-1" },
              { lineId: "line-c", adjustmentId: "adj-c" },
            ],
          }),
        getCancellation: vi.fn(async (_p: string, id: string) =>
          consent(rows.find((row) => row.lineId === id)!),
        ),
        refundTransaction: refundTransaction(),
      });
      await openFinish(el);
      await untick(el, 2);
      await choose(el, true);
      const form = await openedRefund(el);
      expect(form.target).toBe("16.50");
      expect(form.dishes).toBe("2 × Croquetas, 1 × Flan");
      expect(form.startReasonId).toBe("r-cancel");
      await sendRefund(el);
      expect(sent()).toEqual([
        expect.objectContaining({
          appliedAmount: "16.50",
          tipAmount: "0.00",
          cancellationIds: ["adj-c", "adj-1"],
        }),
      ]);
      expect(sent()[0]).not.toHaveProperty("override");
    });

    it("names a free item listed first ahead of its paid dish in the refund", async () => {
      const rows = [named("line-w", "Water", "1.000"), named("line-1", "Salad", "1.000")];
      const { el } = await mountFinish({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal(rows))
          .mockResolvedValue({
            state: "closed",
            refundLinks: [
              { lineId: "line-w", adjustmentId: "adj-w" },
              { lineId: "line-1", adjustmentId: "adj-1" },
            ],
          }),
        getCancellation: vi.fn(async (_p: string, id: string) => {
          const row = rows.find((candidate) => candidate.lineId === id)!;
          return id === "line-w"
            ? freeWater(row, ["line-1"])
            : { ...consent(row), refundValue: { quantity: "1.000", gross: "7.00" } };
        }),
        refundTransaction: refundTransaction(),
      });
      await openFinish(el);
      await choose(el, true);
      const form = await openedRefund(el);
      expect(form.target).toBe("8.67");
      expect(form.dishes).toBe("1 × Water, 1 × Salad");
    });

    it("sends a free item's Refund with its paid dish when the money left covers only the dish", async () => {
      const rows = [unserved("line-1"), unserved("line-w")];
      const { el } = await mountFinish({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal(rows))
          .mockResolvedValue({
            state: "closed",
            refundLinks: [
              { lineId: "line-1", adjustmentId: "adj-1" },
              { lineId: "line-w", adjustmentId: "adj-w" },
            ],
          }),
        getCancellation: vi.fn(async (_p: string, id: string) => {
          const row = rows.find((candidate) => candidate.lineId === id)!;
          return id === "line-w"
            ? freeWater(row, ["line-1"])
            : { ...consent(row), refundValue: { quantity: "1.000", gross: "7.00" } };
        }),
        getRefundableTenders: vi.fn().mockResolvedValue([{ ...cash, appliedRemaining: "7.00" }]),
        refundTransaction: refundTransaction(),
      });
      await openFinish(el);
      expect(finishDialog(el)!.refunds).toEqual({ "line-1": "7.00" });
      await choose(el, true);
      const call = vi.mocked(api.finishTable).mock.calls[1]![3] as {
        cancellations: { lineId: string; refundHandoff?: boolean }[];
      };
      expect(call.cancellations.map((row) => [row.lineId, row.refundHandoff])).toEqual([
        ["line-1", true],
        ["line-w", true],
      ]);
      const form = await openedRefund(el);
      expect(form.target).toBe("7.00");
    });

    it("fills in the dish's share of a comp on the whole bill", async () => {
      // The filed value of 3 portions after a 10% comp on the whole bill is €9.00, one already
      // cancelled: the next portion's share is share(2) − share(1) of €9.00 over 3.
      const row = dish();
      row.context.components[0]!.cancelledQuantity = "1.000";
      const read = { ...consent(row), refundValue: { quantity: "3.000", gross: "9.00" } };
      const { el } = await mountFinish({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal([row]))
          .mockResolvedValue({
            state: "closed",
            refundLinks: [{ lineId: "line-1", adjustmentId: "adj-1" }],
          }),
        getCancellation: vi.fn().mockResolvedValue(read),
        refundTransaction: refundTransaction(),
      });
      await openFinish(el);
      expect(finishDialog(el)!.refunds).toEqual({ "line-1": "3.00" });
      await choose(el, true);
      const form = await openedRefund(el);
      expect(form.target).toBe("3.00");
      expect(form.dishes).toBe("1 × Flan");
    });

    describe("server-held approval after Finish table", () => {
      const twoSales = [dish(), dish("line-2", "wo-check")];
      function approvedFinish(more: Record<string, unknown> = {}) {
        return mountFinish({
          finishTable: vi
            .fn()
            .mockRejectedValueOnce(refusal(twoSales))
            .mockRejectedValueOnce({ code: "authorization.not_permitted" })
            .mockResolvedValue({
              state: "closed",
              refundLinks: [
                { lineId: "line-1", adjustmentId: "adj-1" },
                { lineId: "line-2", adjustmentId: "adj-2" },
              ],
            }),
          refundTransaction: refundTransaction(),
          ...more,
        });
      }
      async function approve(el: TillApp) {
        await openFinish(el);
        await choose(el, true);
        expect(approval(el)).not.toBeNull();
        emit(approval(el)!, "override-confirm", { personId: "m1", pin: "7777" });
        await flush(el, 10);
      }

      it("sends each sale's own cancellation IDs without its approval PIN", async () => {
        const { el } = await approvedFinish();
        await approve(el);
        await openReceipt(el, "sale-wo-4");
        const first = await openedRefund(el);
        expect(first.target).toBe("5.50");
        expect(first.dishes).toBe("1 × Flan");
        await sendRefund(el);
        await backToList(el);
        await openReceipt(el, "sale-wo-check");
        const second = await openedRefund(el);
        expect(second.target).toBe("5.50");
        expect(second.dishes).toBe("1 × Water");
        await sendRefund(el);
        expect(vi.mocked(api.refundTransaction).mock.calls.map((call) => call[0])).toEqual([
          "sale-wo-4",
          "sale-wo-check",
        ]);
        expect(sent()).toEqual([
          expect.objectContaining({
            appliedAmount: "5.50",
            cancellationIds: ["adj-1"],
          }),
          expect.objectContaining({
            appliedAmount: "5.50",
            cancellationIds: ["adj-2"],
          }),
        ]);
        for (const request of sent()) expect(request).not.toHaveProperty("override");
        expect(refundPrompt(el)).toBeNull();
        expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
        for (const storage of [localStorage, sessionStorage])
          for (const key of Object.keys(storage))
            expect(storage.getItem(key)).not.toContain("7777");
      });

      it("asks again for a second refund of the same sale", async () => {
        const { el } = await approvedFinish();
        await approve(el);
        await openReceipt(el, "sale-wo-4");
        await sendRefund(el, { appliedAmount: "3.00" });
        expect(sent()[0]).not.toHaveProperty("override");
        await expect.poll(() => refundForm(el)).toBeNull();
        vi.mocked(api.refundTransaction).mockRejectedValueOnce({
          code: "authorization.not_permitted",
        });
        emit(el.shadowRoot!.querySelector("till-ticket-view")!, "tender-refund-open");
        await flush(el);
        await sendRefund(el, { reason: "r-cancel", appliedAmount: "2.50", tipAmount: "0.00" });
        await expect.poll(() => refundPrompt(el)).not.toBeNull();
        expect(sent()[1]).not.toHaveProperty("override");
      });

      it("asks above the total and submits the other sale without a PIN", async () => {
        const { el } = await approvedFinish();
        await approve(el);
        vi.mocked(api.refundTransaction).mockRejectedValueOnce({
          code: "authorization.not_permitted",
        });
        await openReceipt(el, "sale-wo-4");
        await sendRefund(el, { appliedAmount: "5.51" });
        await expect.poll(() => refundPrompt(el)).not.toBeNull();
        expect(sent()[0]).not.toHaveProperty("override");
        expect(sent()[0]?.cancellationIds).toEqual(["adj-1"]);
        emit(refundPrompt(el)!, "override-confirm", { personId: "m1", pin: "1234" });
        await flush(el, 8);
        await expect.poll(() => sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({
          appliedAmount: "5.51",
          override: { personId: "m1", pin: "1234" },
        });
        await backToList(el);
        await openReceipt(el, "sale-wo-check");
        await sendRefund(el);
        expect(sent()[2]).toMatchObject({
          appliedAmount: "5.50",
          cancellationIds: ["adj-2"],
        });
      });
    });
  });

  it("offers every selected paid bill after closing instead of losing the second receipt", async () => {
    const rows = [dish(), dish("line-2", "wo-check")];
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal(rows))
        .mockResolvedValue({ state: "closed" }),
    });
    await openFinish(el);
    await choose(el, true);
    expect(tableOrder(el)).toBeNull();
    const choices = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-finish-refund]")];
    expect(choices.map((row) => row.getAttribute("data-finish-refund"))).toEqual([
      "sale-wo-4",
      "sale-wo-check",
    ]);
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    await userEvent.click(choices[1]!);
    await flush(el, 10);
    expect(api.getTransactionReceipt).toHaveBeenCalledWith(
      "sale-wo-check",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).not.toBeNull();
    emit(el.shadowRoot!.querySelector("till-tender-refund-dialog")!, "tender-refund-close");
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-ticket-view")!, "back-to-find-bill");
    await flush(el, 8);
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-finish-refund]")].map((row) =>
        row.getAttribute("data-finish-refund"),
      ),
    ).toEqual(["sale-wo-4"]);
  });

  it("reuses the exact command identity when an unanswered write is resent", async () => {
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ state: "closed" });
    const { el } = await mountFinish({ finishTable: finish });
    await openFinish(el);
    await choose(el);
    await expect.poll(() => finish.mock.calls.length).toBe(3);
    expect(finish.mock.calls[2]!.slice(0, 4)).toEqual(finish.mock.calls[1]!.slice(0, 4));
    await flush(el, 8);
    expect(tableOrder(el)).toBeNull();
  });

  it("locks an unanswered choice and retries the same body after all automatic resends fail", async () => {
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ state: "closed" });
    const { el } = await mountFinish({ finishTable: finish });
    await openFinish(el);
    await choose(el);
    await expect
      .poll(() => finishDialog(el)?.refusal, { timeout: 5000 })
      .toBe(t("adjust.unconfirmed"));
    const command = finish.mock.calls[1]![3];
    const dialog = finishDialog(el)!;
    expect(
      dialog.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="reason"]')!.disabled,
    ).toBe(true);
    await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!);
    await flush(el, 8);
    expect(finish.mock.calls[4]![3]).toEqual(command);
    expect(tableOrder(el)).toBeNull();
  });

  it("asks the same approver again without retaining the PIN when an approved answer is lost", async () => {
    let approved = 0;
    const finish = vi.fn(async (...args: unknown[]) => {
      if (args[3] === undefined) throw refusal();
      const command = args[3] as { approver?: { personId: string; pin: string } };
      if (command.approver === undefined) throw { code: "authorization.not_permitted" };
      if (++approved <= 3) throw new TypeError("Failed to fetch");
      return { state: "closed" };
    });
    const { el } = await mountFinish({ finishTable: finish });
    await openFinish(el);
    await choose(el, true);
    emit(approval(el)!, "override-confirm", { personId: "m1", pin: "7777" });
    await expect
      .poll(() => finishDialog(el)?.refusal, { timeout: 5000 })
      .toBe(t("adjust.unconfirmed"));
    expect(approval(el)).toBeNull();
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    vi.mocked(api.listRefundAuthorizers).mockResolvedValue([
      { personId: "m1", displayName: "Marta" },
      { personId: "m2", displayName: "Other" },
    ]);
    const sends = finish.mock.calls.length;
    await userEvent.click(
      finishDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!,
    );
    await flush(el, 8);
    expect(finish).toHaveBeenCalledTimes(sends);
    expect(approval(el)?.authorizers).toEqual([{ personId: "m1", displayName: "Marta" }]);
    emit(approval(el)!, "override-confirm", { personId: "m1", pin: "8888" });
    await flush(el, 10);
    expect((finish.mock.calls.at(-1)![3] as { submissionId: string }).submissionId).toBe(
      (finish.mock.calls[2]![3] as { submissionId: string }).submissionId,
    );
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).not.toBeNull();
    for (const storage of [localStorage, sessionStorage])
      for (const key of Object.keys(storage)) {
        expect(storage.getItem(key)).not.toContain("7777");
        expect(storage.getItem(key)).not.toContain("8888");
      }
  });

  it("ignores a late receipt after a new table is opened following Finish", async () => {
    const receipt = held();
    const { el } = await mountFinish({ getTransactionReceipt: receipt.call });
    await openFinish(el);
    await choose(el, true);
    expect(receipt.call).toHaveBeenCalledOnce();
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el, 8);
    receipt.answer.settle(saleResult);
    await flush(el, 10);
    expect(tableOrder(el)?.party?.id).toBe("v7");
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).toBeNull();
  });

  it("reveals a newly required note beside the field and retains the paid choices for retry", async () => {
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce({ code: "adjustment.note_required" })
      .mockResolvedValue({ state: "closed" });
    const { el } = await mountFinish({ finishTable: finish });
    await openFinish(el);
    await choose(el);
    const dialog = finishDialog(el)!;
    const note =
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="note"]');
    expect(note).not.toBeNull();
    expect(note!.required).toBe(true);
    expect(note!.error).toBe(codeMessage("adjustment.note_required"));
    expect(dialog.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    emit(note!, "wt-change", { value: "Guests left" });
    await flush(el);
    expect(note!.error).toBe("");
    await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!);
    await flush(el, 8);
    expect(finish.mock.calls[2]![3].cancellations[0]).toMatchObject({
      reasonId: "r-cancel",
      note: "Guests left",
    });
    expect(tableOrder(el)).toBeNull();
  });

  it("places a refused reason under its field and clears it when another reason is selected", async () => {
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValueOnce({ code: "adjustment_reason.not_found" })
        .mockResolvedValue({ state: "closed" }),
    });
    await openFinish(el);
    await choose(el);
    const dialog = finishDialog(el)!;
    const field = dialog.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="reason"]')!;
    expect(field.error).toBe(codeMessage("adjustment_reason.not_found"));
    expect(dialog.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    emit(field, "wt-change", { value: "r-cancel" });
    await flush(el);
    expect(field.error).toBe("");
  });

  it("rereads a changed party after confirmation and requires a fresh Finish action", async () => {
    let changed = false;
    const finish = vi.fn(async (...args: unknown[]) => {
      if (args[3] === undefined) throw refusal();
      changed = true;
      throw { code: "party.out_of_date", partyId: "v1", revision: 4 };
    });
    const { el } = await mountFinish({
      finishTable: finish,
      getTablesState: vi.fn(async () =>
        changed ? [seated({}, { revision: 4 }), table7, table9] : [table4, table7, table9],
      ),
    });
    await openFinish(el);
    await choose(el);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(finishDialog(el)).toBeNull();
    expect(tableOrder(el)?.party?.revision).toBe(4);
    expect(banner(el)).not.toBeNull();
    expect(drafts.saveDraft).not.toHaveBeenCalled();
  });

  it("returns to Take payment when a family bill becomes outstanding before confirmation", async () => {
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValueOnce({ code: "party.bill_outstanding" }),
    });
    await openFinish(el);
    await choose(el);
    expect(finishDialog(el)).toBeNull();
    expect(tableOrder(el)?.finishRefused).toBe(true);
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("keeps a failed reason retry open and allows a later successful read", async () => {
    const reasons = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue([]);
    const { el } = await mountFinish({ listAdjustmentReasons: reasons });
    await openFinish(el);
    emit(finishDialog(el)!, "finish-table-reasons");
    await flush(el, 6);
    expect(finishDialog(el)!.reasons).toBeNull();
    expect(finishDialog(el)!.reasonsLoading).toBe(false);
    expect(finishDialog(el)!.refusal).toBe(t("adjust.reasons_error"));
    emit(finishDialog(el)!, "finish-table-reasons");
    await flush(el, 6);
    expect(finishDialog(el)!.reasons).toEqual([]);
    expect(finishDialog(el)!.refusal).toBe("");
    expect(api.finishTable).toHaveBeenCalledOnce();
  });

  it("keeps only one reason retry in flight and ignores its answer after closing", async () => {
    const pending = held();
    const reasons = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(() => pending.call());
    const { el } = await mountFinish({ listAdjustmentReasons: reasons });
    await openFinish(el);
    const dialog = finishDialog(el)!;
    emit(dialog, "finish-table-reasons");
    emit(dialog, "finish-table-reasons");
    await flush(el);
    expect(reasons).toHaveBeenCalledTimes(2);
    expect(finishDialog(el)!.reasonsLoading).toBe(true);
    emit(dialog, "finish-table-close");
    pending.answer.settle([]);
    await flush(el, 8);
    expect(finishDialog(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
    expect(api.finishTable).toHaveBeenCalledOnce();
  });

  it.each(["sale", "value", "quantity"] as const)(
    "offers cancellation without a guessed refund when the filed %s is missing or empty",
    async (missing) => {
      const value = consent();
      if (missing === "sale") delete value.saleId;
      if (missing === "value") delete value.refundValue;
      if (missing === "quantity") value.refundValue!.quantity = "0.000";
      const { el } = await mountFinish({ getCancellation: vi.fn().mockResolvedValue(value) });
      await openFinish(el);
      expect(finishDialog(el)!.refunds).toEqual({});
      expect(finishDialog(el)!.shadowRoot!.querySelector('input[name="refund"]')).toBeNull();
      if (missing !== "quantity") expect(api.getRefundableTenders).not.toHaveBeenCalled();
      await choose(el);
      expect(
        (vi.mocked(api.finishTable).mock.calls[1]![3] as FinishTableResolution).cancellations,
      ).toEqual([
        {
          lineId: "line-1",
          quantity: "1.000",
          expectedBillRevision: 0,
          expectedContext: dish().context,
          reasonId: "r-cancel",
        },
      ]);
      expect(tableOrder(el)).toBeNull();
      expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    },
  );

  it("rereads a family payment refusal without closing or opening a refund", async () => {
    const { el } = await mountFinish({
      finishTable: vi
        .fn()
        .mockRejectedValueOnce(refusal())
        .mockRejectedValueOnce({ code: "bill.payments_received" }),
    });
    await openFinish(el);
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;
    await choose(el, true);
    expect(finishDialog(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
    expect(banner(el)?.textContent).toContain(t("table.finish_bill_holds_money"));
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(reads);
    expect(api.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it.each(["success", "refusal"] as const)(
    "ignores a late Finish confirmation %s after another table opens",
    async (outcome) => {
      const pending = held();
      const { el } = await mountFinish({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal())
          .mockImplementation(() => pending.call()),
      });
      await openFinish(el);
      await choose(el, true);
      emit(tableOrder(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el, 8);
      expect(tableOrder(el)?.party?.id).toBe("v7");
      if (outcome === "success") pending.answer.settle({ state: "closed" });
      else pending.answer.refuse({ code: "party.bill_outstanding" });
      await flush(el, 8);
      expect(tableOrder(el)?.party?.id).toBe("v7");
      expect(finishDialog(el)).toBeNull();
      expect(banner(el)).toBeNull();
      expect(api.getTransactionReceipt).not.toHaveBeenCalled();
    },
  );

  it("retains a failed receipt choice after closing and opens it on an explicit retry", async () => {
    const receipt = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(saleResult);
    const { el } = await mountFinish({ getTransactionReceipt: receipt });
    await openFinish(el);
    await choose(el, true);
    expect(tableOrder(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).toBeNull();
    const choice = el.shadowRoot!.querySelector<HTMLElement>('[data-finish-refund="sale-wo-4"]')!;
    expect(choice).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("find_bill.invoice_load_failed"));
    await userEvent.click(choice);
    await flush(el, 10);
    expect(receipt).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-finish-refund]")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).not.toBeNull();
    expect(api.refundTransaction).not.toHaveBeenCalled();
  });

  it.each(["back", "close"] as const)(
    "dismisses the remaining receipt choices with %s without initiating a refund",
    async (action) => {
      const { el } = await mountFinish({ getTransactionReceipt: vi.fn().mockRejectedValue({}) });
      await openFinish(el);
      await choose(el, true);
      const choice = el.shadowRoot!.querySelector<HTMLElement>("[data-finish-refund]")!;
      const dialog = choice.closest("wt-dialog")!;
      expect(dialog).not.toBeNull();
      if (action === "close") emit(dialog, "wt-close");
      else await userEvent.click(dialog.querySelector<HTMLElement>('[slot="cancel"]')!);
      await flush(el, 6);
      expect(el.shadowRoot!.querySelector("[data-finish-refund]")).toBeNull();
      expect(tableOrder(el)).toBeNull();
      expect(api.getTransactionReceipt).toHaveBeenCalledOnce();
      expect(api.refundTransaction).not.toHaveBeenCalled();
    },
  );

  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280]) {
        it(`paid Finish is accessible in ${locale}/${theme}/${width}`, async () => {
          const previousWidth = innerWidth,
            previousHeight = innerHeight;
          const bodyBackground = document.body.style.background;
          const documentBackground = document.documentElement.style.background;
          await page.viewport(width, 844);
          try {
            const rows = [dish(), dish("line-2", "wo-check")];
            const finish = vi
              .fn()
              .mockRejectedValueOnce(refusal(rows))
              .mockRejectedValueOnce({ code: "authorization.not_permitted" })
              .mockResolvedValue({ state: "closed" });
            const { el, host } = await mountFinish({ finishTable: finish });
            host.setAttribute("data-theme", theme);
            document.body.style.background = getComputedStyle(host).backgroundColor;
            document.documentElement.style.background = getComputedStyle(host).backgroundColor;
            await openPartyTable(el);
            setLocale(locale);
            await flush(el);
            emit(tableOrder(el)!, "finish-table");
            await flush(el, 8);
            const dialog = finishDialog(el)!;
            expect(dialog.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
              locale === "es" ? "2 platos sin servir" : "2 dishes not served",
            );
            await expectNoA11yViolations(dialog);
            expect(innerWidth).toBe(width);
            for (const selector of ["[data-confirm]", "[data-close]"]) {
              const button =
                dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(selector)!;
              const bounds = button.shadowRoot!.querySelector("button")!.getBoundingClientRect();
              expect(bounds.left).toBeGreaterThanOrEqual(0);
              expect(bounds.right).toBeLessThanOrEqual(width);
              expect(bounds.top).toBeGreaterThanOrEqual(0);
              expect(bounds.bottom).toBeLessThanOrEqual(844);
            }
            await page.screenshot({
              path: `__screenshots__/a773-finish-app/dishes-${locale}-${theme}-${width}.png`,
            });
            await choose(el, true);
            expect(approval(el)).not.toBeNull();
            await expectNoA11yViolations(approval(el)!);
            await page.screenshot({
              path: `__screenshots__/a773-finish-app/approval-${locale}-${theme}-${width}.png`,
            });
            emit(approval(el)!, "override-confirm", { personId: "m1", pin: "7777" });
            await flush(el, 10);
            expect([...el.shadowRoot!.querySelectorAll("[data-finish-refund]")]).toHaveLength(2);
            const chooser = el
              .shadowRoot!.querySelector("[data-finish-refund]")!
              .closest("wt-dialog")!;
            await expectNoA11yViolations(chooser);
            for (const button of chooser.querySelectorAll<HTMLElementTagNameMap["wt-button"]>(
              "wt-button",
            )) {
              const bounds = button.shadowRoot!.querySelector("button")!.getBoundingClientRect();
              expect(bounds.left).toBeGreaterThanOrEqual(0);
              expect(bounds.right).toBeLessThanOrEqual(width);
            }
            await page.screenshot({
              path: `__screenshots__/a773-finish-app/receipts-${locale}-${theme}-${width}.png`,
            });
          } finally {
            setLocale("en");
            document.body.style.background = bodyBackground;
            document.documentElement.style.background = documentBackground;
            await page.viewport(previousWidth, previousHeight);
          }
        });
      }

  it("returns a changed editing refusal from the PIN prompt without sending stale authority", async () => {
    let changed = false;
    const listDrafts = vi.fn(async () => {
      const snapshot = await drafts.listDrafts("v1");
      if (changed) snapshot.billEdits.find((row) => row.billId === "wo-check")!.editorVersion++;
      return snapshot;
    });
    const finish = vi
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValue({ code: "authorization.not_permitted" });
    const { el } = await mountFinish({ finishTable: finish, listDrafts });
    await openFinish(el);
    await choose(el, true);
    expect(approval(el)).not.toBeNull();
    changed = true;
    const count = listDrafts.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await expect.poll(() => listDrafts.mock.calls.length).toBeGreaterThan(count);
    await flush(el, 6);
    emit(approval(el)!, "override-confirm", { personId: "m1", pin: "7777" });
    await flush(el, 6);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(approval(el)).toBeNull();
    expect(finishDialog(el)!.busy).toBe(false);
    expect(finishDialog(el)!.refusal).toBe(codeMessage("draft.out_of_date"));
  });

  describe("collect at the counter", () => {
    const rows = [
      { ...dish("line-3", "wo-check"), billRevision: 5 },
      { ...dish("line-1", "wo-4"), billRevision: 2 },
      { ...dish("line-2", "wo-4"), billRevision: 2 },
    ];
    const toast = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean; message: string }>(
        "wt-toast[data-submitted-toast]",
      );
    async function mountCollect(overrides: Record<string, unknown> = {}) {
      return mountFinish({
        finishTable: vi.fn().mockRejectedValueOnce(refusal(rows)).mockResolvedValue({
          state: "closed",
        }),
        getCancellation: vi.fn(async (_p: string, id: string) =>
          consent(rows.find((row) => row.lineId === id)!),
        ),
        ...overrides,
      });
    }
    async function collect(el: TillApp) {
      const dialog = finishDialog(el)!;
      expect(dialog).not.toBeNull();
      await dialog.updateComplete;
      await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-collect]")!);
      await flush(el, 10);
    }

    it("sends the counter collection with each bill once and the revision it read, and leaves the table", async () => {
      const { el } = await mountCollect();
      await openFinish(el);
      const reads = vi.mocked(api.getTablesState).mock.calls.length;
      await collect(el);
      expect(api.finishTable).toHaveBeenCalledTimes(2);
      const call = vi.mocked(api.finishTable).mock.calls[1]!;
      expect(call.slice(0, 3)).toEqual(["v1", 3, closingEdits]);
      expect(call[3]).toEqual({
        submissionId: expect.any(String),
        collect: {
          bills: [
            { billId: "wo-4", expectedBillRevision: 2 },
            { billId: "wo-check", expectedBillRevision: 5 },
          ],
        },
      });
      expect(call[3]).not.toHaveProperty("cancellations");
      expect(finishDialog(el)).toBeNull();
      expect(tableOrder(el)).toBeNull();
      expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
    });

    it("says the order moved to the counter", async () => {
      const { el } = await mountCollect();
      await openFinish(el);
      await collect(el);
      expect(toast(el)!.open).toBe(true);
      expect(toast(el)!.message).toBe(t("station.notice.moved_to_counter"));
    });

    it("re-reads the waiting orders", async () => {
      const { el } = await mountCollect();
      await openFinish(el);
      const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
      await collect(el);
      expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads + 1);
      expect(vi.mocked(api.finishTable).mock.invocationCallOrder.at(-1)!).toBeLessThan(
        vi.mocked(api.listCounterWaiting).mock.invocationCallOrder.at(-1)!,
      );
    });

    it("re-reads the waiting orders and says the move stands when they cannot be read", async () => {
      const { el } = await mountCollect();
      await openFinish(el);
      vi.mocked(api.listCounterWaiting).mockRejectedValue(new TypeError("Failed to fetch"));
      await collect(el);
      expect(
        el
          .shadowRoot!.querySelector('[data-refresh-notice="waiting"] .refresh-message')!
          .textContent!.trim(),
      ).toBe(t("refresh.waiting_after_move"));
    });

    it("says nothing and reads no waiting orders when the answer comes after a sign-out", async () => {
      const pending = held();
      const { el } = await mountCollect({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal(rows))
          .mockImplementation(() => pending.call()),
      });
      await openFinish(el);
      await collect(el);
      expect(api.finishTable).toHaveBeenCalledTimes(2);
      emit(tableOrder(el)!, "logout");
      await flush(el);
      expect(el.shadowRoot!.querySelector("wt-unsaved-changes")?.open ?? false).toBe(false);
      emit(lock(el), "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
      await flush(el, 8);
      const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;

      pending.answer.settle({ state: "closed" });
      await flush(el, 10);

      expect(toast(el)?.open ?? false).toBe(false);
      expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
    });

    const lost = () => [1, 2, 3].map(() => new TypeError("Failed to fetch"));
    function lostThenClosed() {
      const finish = vi.fn().mockRejectedValueOnce(refusal(rows));
      for (const error of lost()) finish.mockRejectedValueOnce(error);
      return finish.mockResolvedValue({ state: "closed" });
    }
    const choice = () => ({
      cancellations: rows.map((row) => ({
        lineId: row.lineId,
        quantity: row.quantity,
        expectedBillRevision: row.billRevision,
        expectedContext: structuredClone(row.context),
        reasonId: "r-cancel",
      })),
    });

    it("re-reads the dishes when the set changed", async () => {
      const changed = { ...dish("line-4", "wo-check"), billRevision: 6 };
      const finish = vi
        .fn()
        .mockRejectedValueOnce(refusal(rows))
        .mockRejectedValueOnce(refusal([changed]))
        .mockResolvedValue({ state: "closed" });
      const { el } = await mountCollect({
        finishTable: finish,
        getCancellation: vi.fn(async (_p: string, id: string) =>
          consent([...rows, changed].find((row) => row.lineId === id)!),
        ),
      });
      await openFinish(el);
      await collect(el);
      expect(finish).toHaveBeenCalledTimes(2);
      expect(tableOrder(el)).not.toBeNull();
      expect(finishDialog(el)!.dishes).toEqual([changed]);
      expect(finishDialog(el)!.collectPending).toBe(false);
      expect(toast(el)?.open ?? false).toBe(false);
      await collect(el);
      expect(finish).toHaveBeenCalledTimes(3);
      expect(finish.mock.calls[2]![3]).toEqual({
        submissionId: expect.any(String),
        collect: { bills: [{ billId: "wo-check", expectedBillRevision: 6 }] },
      });
      expect(finish.mock.calls[2]![3].submissionId).not.toBe(finish.mock.calls[1]![3].submissionId);
      expect(tableOrder(el)).toBeNull();
    });

    it("shows a refusal in the dialog", async () => {
      const { el } = await mountCollect({
        finishTable: vi
          .fn()
          .mockRejectedValueOnce(refusal(rows))
          .mockRejectedValue({ code: "allergy.unanswered" }),
      });
      await openFinish(el);
      await collect(el);
      expect(api.finishTable).toHaveBeenCalledTimes(2);
      expect(codeMessage("allergy.unanswered")).not.toBe(codeMessage("server.internal"));
      expect(finishDialog(el)!.refusal).toBe(codeMessage("allergy.unanswered"));
      expect(finishDialog(el)!.busy).toBe(false);
      expect(finishDialog(el)!.collectPending).toBe(false);
      expect(finishDialog(el)!.confirmationLocked).toBe(false);
      expect(tableOrder(el)).not.toBeNull();
    });

    it("resends the same collection after a lost answer, and only the collection", async () => {
      const finish = lostThenClosed();
      const { el } = await mountCollect({ finishTable: finish });
      await openFinish(el);
      await collect(el);
      await expect
        .poll(() => finishDialog(el)?.refusal, { timeout: 5000 })
        .toBe(t("adjust.unconfirmed"));
      expect(finish).toHaveBeenCalledTimes(4);
      const dialog = finishDialog(el)!;
      expect(dialog.collectPending).toBe(true);
      expect(dialog.confirmationLocked).toBe(true);
      emit(dialog, "finish-table-choice", choice());
      await flush(el, 8);
      expect(finish).toHaveBeenCalledTimes(4);
      await dialog.updateComplete;
      await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-collect]")!);
      await flush(el, 10);
      expect(finish).toHaveBeenCalledTimes(5);
      expect(finish.mock.calls[4]![3]).toEqual(finish.mock.calls[1]![3]);
      expect(finish.mock.calls[4]![3]).toHaveProperty("collect");
      expect(tableOrder(el)).toBeNull();
    });

    it("a cancel left unconfirmed cannot be turned into a collection", async () => {
      const finish = lostThenClosed();
      const { el } = await mountCollect({ finishTable: finish });
      await openFinish(el);
      await choose(el);
      await expect
        .poll(() => finishDialog(el)?.refusal, { timeout: 5000 })
        .toBe(t("adjust.unconfirmed"));
      expect(finish).toHaveBeenCalledTimes(4);
      const dialog = finishDialog(el)!;
      expect(dialog.collectPending).toBe(false);
      expect(dialog.confirmationLocked).toBe(true);
      emit(dialog, "finish-table-collect", {});
      await flush(el, 8);
      expect(finish).toHaveBeenCalledTimes(4);
      await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!);
      await flush(el, 10);
      expect(finish).toHaveBeenCalledTimes(5);
      expect(finish.mock.calls[4]![3]).toEqual(finish.mock.calls[1]![3]);
      expect(finish.mock.calls[4]![3]).toHaveProperty("cancellations");
      expect(tableOrder(el)).toBeNull();
    });

    it("opens no refund and asks no PIN", async () => {
      const { el } = await mountCollect();
      const dialog = await openFinish(el);
      await dialog!.updateComplete;
      const ticks = [
        ...dialog!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="refund"]'),
      ];
      expect(ticks.some((input) => input.checked)).toBe(true);
      await collect(el);
      expect(api.finishTable).toHaveBeenCalledTimes(2);
      expect(tableOrder(el)).toBeNull();
      expect(api.listRefundAuthorizers).not.toHaveBeenCalled();
      expect(approval(el)).toBeNull();
      expect(api.getTransactionReceipt).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-tender-refund-dialog")).toBeNull();
    });
  });
});
