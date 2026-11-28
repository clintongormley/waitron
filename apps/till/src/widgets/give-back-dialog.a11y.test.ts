import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  SCOPE,
  UNDER_WAY,
  VIEW,
  completedFor,
  fakeGiveBackApi,
  previewFor,
  refundsOn,
} from "./give-back-dialog.test-helpers.js";
import { GiveBackSession } from "../state/give-back.js";
import "./give-back-dialog.js";
import type { TillGiveBackDialog } from "./give-back-dialog.js";

beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
  localStorage.clear();
});

describe.each(["light", "dark"] as const)("give money back accessibility (%s)", (theme) => {
  async function mount(api = fakeGiveBackApi()) {
    const mounted = await mountWidget<TillGiveBackDialog>(
      "till-give-back-dialog",
      {
        api,
        session: new GiveBackSession(SCOPE, api),
        refunds: refundsOn(api),
        saleId: "s1",
        invoiceNumber: "A/1042",
        namesLocale: "es",
      },
      theme,
    );
    await vi.waitFor(() =>
      expect(mounted.el.shadowRoot!.querySelector("[data-loading]")).toBeNull(),
    );
    await mounted.el.updateComplete;
    return mounted;
  }
  async function choose(el: TillGiveBackDialog, purpose: string) {
    el.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${purpose}]`)!.click();
    await el.updateComplete;
  }

  it("has no violations while the receipt is read", async () => {
    const api = fakeGiveBackApi();
    api.readGiveBack.mockReturnValue(new Promise(() => {}));
    const { host } = await mountWidget<TillGiveBackDialog>(
      "till-give-back-dialog",
      { api, session: new GiveBackSession(SCOPE, api), saleId: "s1", invoiceNumber: "A/1042" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations when the receipt could not be read", async () => {
    const api = fakeGiveBackApi();
    api.readGiveBack.mockRejectedValue(new TypeError("Failed to fetch"));
    const { host } = await mount(api);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the choice, one choice waiting and one with nothing left", async () => {
    const { host } = await mount(
      fakeGiveBackApi({
        ...VIEW,
        choices: {
          dishes: { available: false, reason: null },
          goodwill: { available: false, reason: { code: "invoice_correction.refund_pending" } },
          extra: { available: true, reason: null },
        },
      }),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the choice while a card refund waits, after Check again found no answer", async () => {
    const held = { code: "tender.refund_in_progress" };
    const { el, host } = await mount(
      fakeGiveBackApi({
        ...VIEW,
        ways: VIEW.ways.map((way) =>
          way.way === "cash" ? way : { ...way, pending: true, reason: held },
        ),
        choices: { ...VIEW.choices, extra: { available: false, reason: held } },
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-check-pending]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-pending-status]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on a dish's form with a line waiting, extras and a dish given free", async () => {
    const { el, host } = await mount(
      fakeGiveBackApi({
        ...VIEW,
        lines: VIEW.lines.map((line) =>
          line.id === "croquetas"
            ? { ...line, available: false, reason: { code: "invoice_correction.refund_pending" } }
            : line,
        ),
      }),
    );
    await choose(el, "dishes");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the money and reason marked missing", async () => {
    const { el, host } = await mount();
    await choose(el, "goodwill");
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on a form whose reasons could not be read", async () => {
    const api = fakeGiveBackApi();
    api.listAdjustmentReasons.mockRejectedValue(new TypeError("Failed to fetch"));
    const { el, host } = await mount(api);
    await choose(el, "goodwill");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-reasons-retry]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the summary and the PIN line shown", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockResolvedValue({
      parts: [{ kind: "correction", amount: "7.00", way: "card-1", lineIds: [] }],
      leftUnderWay: "3.00",
      needs: ["sale.rectify"],
      manual: false,
    });
    const { el, host } = await mount(api);
    await choose(el, "goodwill");
    const field = el
      .shadowRoot!.querySelector("wt-price-input[name=amount]")!
      .shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(field), "10");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-pin]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it("has no violations on the separate card terminal's step, before and after a missed confirmation", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockResolvedValue({
      parts: [{ kind: "refund", amount: "5.00", way: "card-1" }],
      leftUnderWay: "0.00",
      needs: [],
      manual: true,
    });
    const { el, host } = await mount(api);
    await choose(el, "goodwill");
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name=way][value="card-1"]')!.click();
    el.shadowRoot!.querySelector("wt-combobox[name=reason]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "complaint" },
        bubbles: true,
        composed: true,
      }),
    );
    const field = el
      .shadowRoot!.querySelector("wt-price-input[name=amount]")!
      .shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(field), "5");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-summary]")).not.toBeNull());
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-terminal]")).not.toBeNull());
    await expectNoA11yViolations(host);

    el.shadowRoot!.querySelector<HTMLElement>("[data-record]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-terminal-error]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the extra's form", async () => {
    const { el, host } = await mount();
    await choose(el, "extra");
    await expectNoA11yViolations(host);
  });
  /** The goodwill form for €5.00 with a reason, its preview saying the corrective invoice goes on
   * A4, and its line drawn. */
  async function correcting(api = fakeGiveBackApi()) {
    api.previewGiveBack.mockImplementation(async (_saleId, request) => ({
      ...previewFor(request),
      corrective: {
        default: { medium: "a4", printerId: "office", printerName: "Oficina" },
        printers: [
          { id: "office", name: "Oficina", kind: "a4" },
          { id: "bar", name: "Barra", kind: "receipt" },
        ],
        emailAvailable: true,
      },
    }));
    const mounted = await mount(api);
    const { el } = mounted;
    await choose(el, "goodwill");
    el.shadowRoot!.querySelector("wt-combobox[name=reason]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "complaint" },
        bubbles: true,
        composed: true,
      }),
    );
    const field = el
      .shadowRoot!.querySelector("wt-price-input[name=amount]")!
      .shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(field), "5");
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector("till-corrective-choice")
          ?.shadowRoot?.querySelector("[data-corrective-change]"),
      ).toBeTruthy(),
    );
    return { ...mounted, api };
  }
  const choiceOf = (el: TillGiveBackDialog) =>
    el.shadowRoot!.querySelector("till-corrective-choice")!;
  async function openSheet(el: TillGiveBackDialog) {
    choiceOf(el).shadowRoot!.querySelector<HTMLElement>("[data-corrective-change]")!.click();
    await vi.waitFor(() =>
      expect(choiceOf(el).shadowRoot!.querySelector("till-corrective-sheet")).not.toBeNull(),
    );
    const sheet = choiceOf(el).shadowRoot!.querySelector("till-corrective-sheet")!;
    await sheet.updateComplete;
    return sheet;
  }

  it("has no violations on the form showing the corrective invoice's line", async () => {
    const { host } = await correcting();
    await expectNoA11yViolations(host);
  });

  it("has no violations with the corrective invoice's line showing a refusal", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce({
      code: "invoice_delivery.printer_invalid",
      field: "correctiveDelivery.printerId",
      status: 409,
    });
    const { el, host } = await correcting(api);
    const sheet = await openSheet(el);
    sheet.shadowRoot!.querySelector("wt-combobox[name=delivery]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "print:bar" },
        bubbles: true,
        composed: true,
      }),
    );
    await sheet.updateComplete;
    sheet.shadowRoot!.querySelector<HTMLElement>("[data-corrective-done]")!.click();
    await vi.waitFor(() =>
      expect(choiceOf(el).shadowRoot!.querySelector("till-corrective-sheet")).toBeNull(),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await vi.waitFor(() =>
      expect(choiceOf(el).shadowRoot!.querySelector("[data-corrective-error]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the corrective invoice's sheet open on a printer", async () => {
    const { el, host } = await correcting();
    await openSheet(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the corrective invoice's sheet on email, with an address that is not one after Done", async () => {
    const { el, host } = await correcting();
    const sheet = await openSheet(el);
    sheet
      .shadowRoot!.querySelector("wt-combobox[name=delivery]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "email" }, bubbles: true, composed: true }),
      );
    await sheet.updateComplete;
    const email =
      sheet.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]")!;
    await email.updateComplete;
    await userEvent.fill(page.elementLocator(email.shadowRoot!.querySelector("input")!), "ana@");
    await sheet.updateComplete;
    sheet.shadowRoot!.querySelector<HTMLElement>("[data-corrective-done]")!.click();
    await vi.waitFor(() => expect(email.error).not.toBe(""));
    await expectNoA11yViolations(host);
  });

  const ask = {
    request: { purpose: "goodwill" as const, amount: "5.00", extra: "0.00", way: "card-1" },
    reasonId: "complaint",
    note: null,
    expected: [{ kind: "refund" as const, amount: "5.00", way: "card-1" }],
  };

  it("a press whose answer was lost, offering Send again", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(new GiveBackSession(SCOPE, api).submit("s1", ask)).rejects.toThrow();
    const { el } = await mount(api);
    expect(el.shadowRoot!.querySelector("[data-lost]")).not.toBeNull();
    await expectNoA11yViolations(el);
  });

  it("a rest waiting for the card company, offering Check again", async () => {
    const api = fakeGiveBackApi();
    api.giveBack.mockImplementationOnce(async (_saleId, body) => ({
      ...completedFor(body),
      parts: [{ kind: "refund", amount: "2.00", state: "pending", refundId: "refund-1" }],
      rest: { ...ask.request, amount: "3.00" },
    }));
    await new GiveBackSession(SCOPE, api).submit("s1", ask);
    const { el } = await mount(api);
    expect(el.shadowRoot!.querySelector("[data-check-again]")).not.toBeNull();
    await expectNoA11yViolations(el);
  });

  it("has no violations on a give-back still under way, with money back waiting and its steps", async () => {
    const { el, host } = await mount(
      fakeGiveBackApi({ ...VIEW, underWay: { ...UNDER_WAY, pending: "1.00" } }),
    );
    el.capabilities = ["take-cash"];
    const view = el.shadowRoot!.querySelector("till-give-back-under-way")!;
    await vi.waitFor(() =>
      expect(view.shadowRoot!.querySelector("[data-choice=cash]")).not.toBeNull(),
    );
    expect(view.shadowRoot!.querySelector("[data-choice=stop]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on the under-way view's ended outcome", async () => {
    const { el, host } = await mount(
      fakeGiveBackApi({ ...VIEW, underWay: { ...UNDER_WAY, state: "filed" } }),
    );
    const view = el.shadowRoot!.querySelector("till-give-back-under-way")!;
    await vi.waitFor(() => expect(view.shadowRoot!.querySelector("[data-done]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });
});
