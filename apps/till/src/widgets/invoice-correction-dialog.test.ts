import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { AdjustmentReason } from "../api/client.js";
import type { RefundableTender } from "../api/tender-refund-types.js";
import type {
  InvoiceCorrectionLines,
  InvoiceCorrectionOpened,
  InvoiceCorrectionPreview,
  InvoiceCorrectionRequest,
  InvoiceCorrectionView,
} from "../api/invoice-correction-types.js";
import { InvoiceCorrectionSession } from "../state/invoice-correction.js";
import "./invoice-correction-dialog.js";
import type {
  InvoiceCorrectionCardLeg,
  TillInvoiceCorrectionDialog,
} from "./invoice-correction-dialog.js";

const reason = (id: string, name: string, noteRequired = false) =>
  ({
    id,
    name,
    kind: "void",
    actions: ["cancel"],
    noteRequired,
    maxPercentBp: null,
    maxAmount: null,
  }) as AdjustmentReason;
const REASONS = [reason("overcharged", "Overcharged"), reason("other", "Other", true)];
const LINES: InvoiceCorrectionLines = {
  lines: [
    {
      id: "rice",
      descriptions: { en: "Rice" },
      rate: "10.00",
      gross: "11.00",
      left: "11.00",
    },
    {
      id: "steak",
      descriptions: { en: "Steak" },
      rate: "21.00",
      gross: "12.10",
      left: "6.05",
    },
  ],
  moneyRefundable: "23.10",
};
const TENDERS: RefundableTender[] = [
  {
    tenderId: "cash-1",
    method: "cash",
    last4: null,
    appliedRemaining: "13.10",
    tipRemaining: "0.00",
    pendingRefundId: null,
    manual: false,
  },
  {
    tenderId: "card-1",
    method: "card",
    last4: "0042",
    appliedRemaining: "10.00",
    tipRemaining: "0.00",
    pendingRefundId: null,
    manual: false,
  },
];
const SPLIT = [{ rate: "21.00", base: "5.00", tax: "1.05" }];
const answer = (gross: string): InvoiceCorrectionPreview => ({
  gross,
  vatBreakdown: SPLIT,
  moneyRefundable: "23.10",
});

/** An API answering every read at once, and each preview with the split for its amount. */
function fakeApi() {
  return {
    readInvoiceCorrectionLines: vi.fn(async (): Promise<InvoiceCorrectionLines> => LINES),
    getRefundableTenders: vi.fn(async () => TENDERS),
    listAdjustmentReasons: vi.fn(async () => REASONS),
    previewInvoiceCorrection: vi.fn(async (_saleId: string, request: { gross: string }) =>
      answer(request.gross),
    ),
    getInvoiceCorrection: vi.fn(),
    fileInvoiceCorrection: vi.fn(),
    closeInvoiceCorrection: vi.fn(),
    listApprovers: vi.fn(),
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

async function mount(api = fakeApi()) {
  const { el } = await mountWidget<TillInvoiceCorrectionDialog>("till-invoice-correction-dialog", {
    api,
    saleId: "sale-1",
    invoiceNumber: "T/0012",
    namesLocale: "en",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-loading]")).toBeNull());
  await el.updateComplete;
  return { el, api };
}
const root = (el: TillInvoiceCorrectionDialog) => el.shadowRoot!;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const dish = (el: TillInvoiceCorrectionDialog, id: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(`wt-switch[data-line="${id}"]`)!;
const grossField = (el: TillInvoiceCorrectionDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-price-input"]>("wt-price-input[name=gross]")!;
const confirm = (el: TillInvoiceCorrectionDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!;
async function type(el: TillInvoiceCorrectionDialog, value: string) {
  const field = grossField(el);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function pick(el: TillInvoiceCorrectionDialog, id: string) {
  dish(el, id).shadowRoot!.querySelector("input")!.click();
  await el.updateComplete;
}
async function choose(el: TillInvoiceCorrectionDialog, id: string) {
  root(el)
    .querySelector("wt-combobox[name=reason]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: id }, bubbles: true, composed: true }),
    );
  await el.updateComplete;
}

it("shows each dish with what is left of it, the money still refundable and the payments", async () => {
  const { el, api } = await mount();

  expect(api.readInvoiceCorrectionLines).toHaveBeenCalledWith("sale-1", expect.anything());
  expect([dish(el, "rice").label, dish(el, "steak").label]).toEqual([
    "Rice · €11.00 · €11.00 left to correct",
    "Steak · €12.10 · €6.05 left to correct",
  ]);
  expect(text(root(el).querySelector("[data-refundable]"))).toBe(
    t("invoice_correction.refundable").replace("{amount}", "€23.10"),
  );
  expect([...root(el).querySelectorAll("[data-payment]")].map(text)).toEqual([
    "Cash · €13.10",
    "Card · 0042 · €10.00",
  ]);
  expect(grossField(el).label).toBe("Money back, VAT included");
  expect(grossField(el).required).toBe(true);
});

it("previews the typed amount and shows the server's split, keeping only the latest answer", async () => {
  let resolveLate!: (answer: InvoiceCorrectionPreview) => void;
  const api = fakeApi();
  api.previewInvoiceCorrection.mockImplementationOnce(
    () => new Promise((resolve) => (resolveLate = resolve)),
  );
  const { el } = await mount(api);

  await type(el, "5");
  await type(el, "6.05");
  resolveLate({ ...answer("5.00"), vatBreakdown: [{ rate: "21.00", base: "4.13", tax: "0.87" }] });
  await vi.waitFor(() =>
    expect(text(root(el).querySelector("[data-split]"))).toBe(
      t("invoice_correction.split")
        .replace("{rate}", "21")
        .replace("{base}", "€5.00")
        .replace("{tax}", "€1.05"),
    ),
  );
  expect(api.previewInvoiceCorrection.mock.calls.map((call) => call[1])).toEqual([
    { gross: "5.00" },
    { gross: "6.05" },
  ]);
  expect(text(confirm(el))).toBe(t("invoice_correction.confirm").replace("{amount}", "€6.05"));
});

it("previews the picked dishes and stops offering dishes at another VAT rate", async () => {
  const { el, api } = await mount();

  await pick(el, "steak");
  expect(dish(el, "rice").disabled).toBe(true);
  expect(dish(el, "steak").disabled).toBe(false);
  await type(el, "6.05");
  await vi.waitFor(() =>
    expect(api.previewInvoiceCorrection).toHaveBeenLastCalledWith("sale-1", {
      gross: "6.05",
      lineIds: ["steak"],
    }),
  );
  await pick(el, "steak");
  expect(dish(el, "rice").disabled).toBe(false);
});

it("explains on opening an invoice the preview would refuse, offering only Cancel", async () => {
  const refused = { code: "sale.correction_not_admitted", reason: "voided" };
  const api = fakeApi();
  api.readInvoiceCorrectionLines.mockRejectedValue(refused);
  const { el } = await mount(api);

  expect(root(el).querySelector("wt-form-actions")!.error).toBe(
    codeMessage("sale.correction_not_admitted", "en", { reason: "voided" }),
  );
  expect(grossField(el)).toBeNull();
  expect(confirm(el)).toBeNull();
});

it("puts an amount the preview refuses under the money field, leaving the action enabled", async () => {
  const api = fakeApi();
  api.previewInvoiceCorrection.mockRejectedValue({ code: "sale.correction_amount_invalid" });
  const { el } = await mount(api);

  await type(el, "30");
  await vi.waitFor(() =>
    expect(grossField(el).error).toBe(codeMessage("sale.correction_amount_invalid")),
  );
  expect(confirm(el).disabled).toBe(false);
});

it("marks the missing money and reason, then sends the previewed split once they are fixed", async () => {
  const { el, api } = await mountSending();
  const asks = () => api.openInvoiceCorrection.mock.calls.map((call) => call[1]);

  confirm(el).click();
  await el.updateComplete;
  expect(grossField(el).error).toBe(t("invoice_correction.gross_invalid"));
  expect(root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!.error).toBe(
    t("adjust.reason_required"),
  );
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(confirm(el).disabled).toBe(true);
  expect(asks()).toEqual([]);

  await type(el, "6.05");
  await choose(el, "other");
  await vi.waitFor(() => expect(root(el).querySelector("[data-split]")).not.toBeNull());
  expect(confirm(el).disabled).toBe(true);
  const note = root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!;
  await userEvent.fill(
    page.elementLocator(note.shadowRoot!.querySelector("input")!),
    " Wrong price ",
  );
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(false);
  confirm(el).click();
  await vi.waitFor(() => expect(asks()).toHaveLength(1));
  expect(asks()).toEqual([
    {
      gross: "6.05",
      reasonId: "other",
      note: "Wrong price",
      expectedSplit: SPLIT,
      submissionId: expect.any(String),
    },
  ]);
});

it("asks for the preview again when pressed after one failed, and sends once it answers", async () => {
  const api = sendingApi();
  api.previewInvoiceCorrection.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const { el } = await mountSending(api);
  const asks = () => api.openInvoiceCorrection.mock.calls.map((call) => call[1]);
  await type(el, "6.05");
  await choose(el, "overcharged");
  await vi.waitFor(() =>
    expect(root(el).querySelector("wt-form-actions")!.error).toBe(
      t("invoice_correction.read_failed"),
    ),
  );

  confirm(el).click();
  await vi.waitFor(() => expect(asks()).toHaveLength(1));
  expect(api.previewInvoiceCorrection).toHaveBeenCalledTimes(2);
  expect(asks()[0]).toEqual({
    gross: "6.05",
    reasonId: "overcharged",
    note: null,
    expectedSplit: SPLIT,
    submissionId: expect.any(String),
  });
});

it("offers Retry when the invoice could not be read on opening, and shows the window once read", async () => {
  const api = fakeApi();
  api.readInvoiceCorrectionLines.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const { el } = await mount(api);
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(
    t("invoice_correction.read_failed"),
  );
  expect(grossField(el)).toBeNull();

  root(el).querySelector<HTMLElement>("[data-reload]")!.click();
  await vi.waitFor(() => expect(grossField(el)).not.toBeNull());
  expect(api.readInvoiceCorrectionLines).toHaveBeenCalledTimes(2);
});

it("shows a refusal of the dishes chosen under the dishes", async () => {
  const api = fakeApi();
  api.previewInvoiceCorrection.mockRejectedValue({
    code: "sale.correction_scope_invalid",
    reason: "required",
  });
  const { el } = await mount(api);

  await type(el, "5");
  await vi.waitFor(() =>
    expect(text(root(el).querySelector("[data-lines-error]"))).toBe(
      codeMessage("sale.correction_scope_invalid"),
    ),
  );
  expect(root(el).querySelector("wt-form-actions")!.error).toBe("");
});

it("shows a refusal about the invoice above the buttons, giving way to the fields' message", async () => {
  const api = fakeApi();
  api.previewInvoiceCorrection.mockRejectedValue({ code: "invoice_correction.chain_unsound" });
  const { el } = await mount(api);
  const actions = () => root(el).querySelector("wt-form-actions")!;

  await type(el, "5");
  await vi.waitFor(() =>
    expect(actions().error).toBe(codeMessage("invoice_correction.chain_unsound")),
  );
  confirm(el).click();
  await el.updateComplete;
  expect(actions().error).toBe(t("form.fix_fields"));
});

it("writes the split's VAT rate with the language's decimal mark", async () => {
  setLocale("es");
  const api = fakeApi();
  api.previewInvoiceCorrection.mockResolvedValue({
    ...answer("1.06"),
    vatBreakdown: [{ rate: "5.50", base: "1.00", tax: "0.06" }],
  });
  const { el } = await mount(api);

  await type(el, "1,06");
  await vi.waitFor(() =>
    expect(text(root(el).querySelector("[data-split]"))).toContain(
      t("invoice_correction.split").split("{base}")[0]!.replace("{rate}", "5,5"),
    ),
  );
});

const MANAGER = { personId: "manager", pin: "0123" };
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
const refused = (code: string, params: Record<string, unknown> = {}) => ({
  ...params,
  code,
  status: 409,
});

/** `fakeApi` that also opens, gives cash, reads, files and closes corrections, answering `OPEN`. */
function sendingApi() {
  return {
    ...fakeApi(),
    openInvoiceCorrection: vi.fn<
      (saleId: string, request: InvoiceCorrectionRequest) => Promise<InvoiceCorrectionOpened>
    >(async () => ({ correction: OPEN, replayed: false })),
    giveInvoiceCorrectionCash: vi.fn(async (_id: string, request: { amount: string }) => ({
      correction: { ...OPEN, state: "filed" as const, moneyBack: request.amount, left: "0.00" },
      refunds: [],
      replayed: false,
    })),
    getInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => OPEN),
    fileInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => ({
      ...OPEN,
      state: "filed",
    })),
    closeInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => ({
      ...OPEN,
      state: "discarded",
    })),
    listApprovers: vi.fn(async () => [{ personId: "manager", displayName: "Marta" }]),
  };
}

const SCOPE = { deviceId: "device-1", personId: "staff-1" };
const EVERY_METHOD = ["take-cash", "integrated-card-payment", "hand-keyed-card-payment"];
async function mountSending(api = sendingApi(), correctionId = "", capabilities = EVERY_METHOD) {
  const { el } = await mountWidget<TillInvoiceCorrectionDialog>("till-invoice-correction-dialog", {
    api,
    session: new InvoiceCorrectionSession(SCOPE, api),
    capabilities,
    saleId: "sale-1",
    correctionId,
    invoiceNumber: "T/0012",
    namesLocale: "en",
  });
  await vi.waitFor(() => expect(root(el).querySelector("[data-loading]")).toBeNull());
  await el.updateComplete;
  return { el, api };
}
async function confirmCorrection(el: TillInvoiceCorrectionDialog) {
  await type(el, "6.05");
  await choose(el, "overcharged");
  await vi.waitFor(() => expect(root(el).querySelector("[data-split]")).not.toBeNull());
  confirm(el).click();
}
const pinDialog = async (el: TillInvoiceCorrectionDialog) => {
  await vi.waitFor(() =>
    expect(root(el).querySelector("till-supervisor-override-dialog")).not.toBeNull(),
  );
  return root(el).querySelector("till-supervisor-override-dialog")!;
};
const signIn = (pin: Element, detail = MANAGER) =>
  pin.dispatchEvent(new CustomEvent("override-confirm", { detail }));
const outcome = (el: TillInvoiceCorrectionDialog) => text(root(el).querySelector("[data-outcome]"));
const marked = (el: TillInvoiceCorrectionDialog) =>
  [
    ...root(el).querySelectorAll<HTMLElement>(
      "[data-back], [data-left], [data-choice=cash], [data-choice=card]",
    ),
  ].map((node) => node.dataset.choice ?? Object.keys(node.dataset)[0]);

describe("sending a correction", () => {
  afterEach(() => localStorage.clear());

  it("on an all-cash bill sends Open, then the whole amount in cash with the same PIN, and says it was filed", async () => {
    const api = sendingApi();
    api.getRefundableTenders.mockResolvedValue([TENDERS[0]!]);
    api.openInvoiceCorrection.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.rectify" }),
    );
    const { el } = await mountSending(api);

    await confirmCorrection(el);
    const pin = await pinDialog(el);
    expect(api.listApprovers).toHaveBeenCalledWith("sale.rectify");
    signIn(pin);

    await vi.waitFor(() =>
      expect(outcome(el)).toBe(
        `${t("invoice_correction.filed").replace("{amount}", "€6.05")} ${t(
          "invoice_correction.cash_given",
        ).replace("{amount}", "€6.05")}`,
      ),
    );
    expect(api.openInvoiceCorrection.mock.calls.map((call) => call[1])).toEqual([
      expect.not.objectContaining({ override: expect.anything() }),
      expect.objectContaining({ gross: "6.05", reasonId: "overcharged", override: MANAGER }),
    ]);
    expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledExactlyOnceWith("correction-1", {
      submissionId: expect.any(String),
      amount: "6.05",
      override: MANAGER,
    });
    expect(root(el).querySelector("till-supervisor-override-dialog")).toBeNull();
  });

  it("shows the PIN's own refusal in the sign-in", async () => {
    const api = sendingApi();
    api.openInvoiceCorrection
      .mockRejectedValueOnce(refused("authorization.not_permitted", { permission: "sale.rectify" }))
      .mockRejectedValueOnce({ code: "pin.invalid", status: 401 });
    const { el } = await mountSending(api);

    await confirmCorrection(el);
    const pin = await pinDialog(el);
    signIn(pin);
    await vi.waitFor(() => expect(pin.error).toBe("pin.invalid"));
    expect(api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();
  });

  it("on a bill paid by cash and card shows the money back, then cash, then each card", async () => {
    const { el, api } = await mountSending();
    const cards: unknown[] = [];
    el.addEventListener("invoice-correction-card", (event) =>
      cards.push((event as CustomEvent).detail),
    );

    await confirmCorrection(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-choice=cash]")).not.toBeNull());
    expect(marked(el)).toEqual(["back", "left", "cash", "card"]);
    expect(text(root(el).querySelector("[data-back]"))).toBe(
      t("invoice_correction.back").replace("{back}", "€0.00").replace("{gross}", "€6.05"),
    );
    expect(text(root(el).querySelector("[data-choice=cash]"))).toBe(
      t("invoice_correction.give_cash").replace("{amount}", "€6.05"),
    );
    expect(api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();

    root(el).querySelector<HTMLElement>("[data-choice=card]")!.click();
    expect(cards).toEqual([
      {
        correctionId: "correction-1",
        tenderId: "card-1",
        target: "6.05",
        startReasonId: "overcharged",
      },
    ]);
    root(el).querySelector<HTMLElement>("[data-choice=cash]")!.click();
    await vi.waitFor(() => expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledOnce());
    expect(api.giveInvoiceCorrectionCash.mock.calls[0]![1]).toEqual({
      submissionId: expect.any(String),
      amount: "6.05",
    });
  });

  it("resumes the open correction a retry is refused with, never opening another or giving cash", async () => {
    const api = sendingApi();
    api.getRefundableTenders.mockResolvedValue([TENDERS[0]!]);
    api.openInvoiceCorrection.mockRejectedValue(
      refused("invoice_correction.already_open", { correctionId: "correction-9" }),
    );
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, id: "correction-9", moneyBack: "2.00" });
    const { el } = await mountSending(api);

    await confirmCorrection(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-back]")).not.toBeNull());
    expect(api.getInvoiceCorrection).toHaveBeenCalledWith("correction-9", {});
    expect(api.openInvoiceCorrection).toHaveBeenCalledOnce();
    expect(api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();
  });

  it("resumes the open correction the invoice's lines are refused with on opening", async () => {
    const api = sendingApi();
    api.readInvoiceCorrectionLines.mockRejectedValue(
      refused("invoice_correction.already_open", { correctionId: "correction-9" }),
    );
    const { el } = await mountSending(api);

    await vi.waitFor(() => expect(root(el).querySelector("[data-back]")).not.toBeNull());
    expect(api.getInvoiceCorrection).toHaveBeenCalledWith("correction-9", {});
    expect(grossField(el)).toBeNull();
  });
});

describe("an open correction", () => {
  afterEach(() => localStorage.clear());

  it("shows the money already back before more cash, and files it with the split shown", async () => {
    const api = sendingApi();
    const split = [{ rate: "21.00", base: "1.65", tax: "0.35" }];
    api.getInvoiceCorrection.mockResolvedValue({
      ...OPEN,
      moneyBack: "2.00",
      left: "4.05",
      fileNow: { gross: "2.00", vatBreakdown: split },
    });
    api.fileInvoiceCorrection.mockResolvedValue({ ...OPEN, state: "filed", moneyBack: "2.00" });
    const { el } = await mountSending(api, "correction-1");

    expect(api.readInvoiceCorrectionLines).not.toHaveBeenCalled();
    expect(marked(el)).toEqual(["back", "left", "cash", "card"]);
    expect(text(root(el).querySelector("[data-left]"))).toBe(
      t("invoice_correction.left_back").replace("{amount}", "€4.05"),
    );
    expect(root(el).querySelector("[data-choice=discard]")).toBeNull();
    expect(text(root(el).querySelector("[data-choice=file]"))).toBe(
      t("invoice_correction.finish_now"),
    );
    expect(text(root(el).querySelector("[data-hint=file]"))).toBe(
      t("invoice_correction.finish_now_hint").replace("{amount}", "€2.00"),
    );

    root(el).querySelector<HTMLElement>("[data-choice=file]")!.click();
    await vi.waitFor(() =>
      expect(outcome(el)).toBe(t("invoice_correction.filed").replace("{amount}", "€2.00")),
    );
    expect(api.fileInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {
      expectedSplit: split,
    });
  });

  it("records a correction whose money is all back", async () => {
    const api = sendingApi();
    api.getInvoiceCorrection.mockResolvedValue({
      ...OPEN,
      moneyBack: "6.05",
      left: "0.00",
      fileNow: { gross: "6.05", vatBreakdown: SPLIT },
    });
    const { el } = await mountSending(api, "correction-1");

    expect(text(root(el).querySelector("[data-choice=file]"))).toBe(t("invoice_correction.record"));
    expect(root(el).querySelector("[data-choice=cash]")).toBeNull();
    expect(root(el).querySelector("[data-choice=card]")).toBeNull();
  });

  it("discards a correction with nothing back", async () => {
    const { el, api } = await mountSending(undefined, "correction-1");

    expect(root(el).querySelector("[data-choice=file]")).toBeNull();
    expect(text(root(el).querySelector("[data-hint=discard]"))).toBe(
      t("invoice_correction.discard_hint"),
    );
    root(el).querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await vi.waitFor(() => expect(outcome(el)).toBe(t("invoice_correction.discarded")));
    expect(api.closeInvoiceCorrection).toHaveBeenCalledExactlyOnceWith("correction-1", {});
  });

  it("closes keeping the refunds only when filing is refused for good", async () => {
    const api = sendingApi();
    const notAdmitted = { refusal: "sale.correction_not_admitted", closable: true };
    api.getInvoiceCorrection
      .mockResolvedValueOnce({
        ...OPEN,
        moneyBack: "2.00",
        fileNow: { refusal: "invoice_correction.chain_unsound", closable: false },
      })
      .mockResolvedValue({ ...OPEN, moneyBack: "2.00", fileNow: notAdmitted });
    api.closeInvoiceCorrection.mockResolvedValue({ ...OPEN, state: "closed", moneyBack: "2.00" });
    const { el } = await mountSending(api, "correction-1");

    expect(text(root(el).querySelector("[data-file-refusal]"))).toBe(
      codeMessage("invoice_correction.chain_unsound"),
    );
    expect(root(el).querySelector("[data-choice=close-keeping]")).toBeNull();
    expect(root(el).querySelector("[data-choice=file]")).toBeNull();

    el.legsRevision = 1;
    await vi.waitFor(() =>
      expect(root(el).querySelector("[data-choice=close-keeping]")).not.toBeNull(),
    );
    expect(api.getInvoiceCorrection).toHaveBeenCalledTimes(2);
    root(el).querySelector<HTMLElement>("[data-choice=close-keeping]")!.click();
    await vi.waitFor(() =>
      expect(outcome(el)).toBe(t("invoice_correction.closed").replace("{amount}", "€2.00")),
    );
  });
});

describe("never sending what staff did not confirm (review fix round 1)", () => {
  afterEach(() => localStorage.clear());
  const lost = () => new TypeError("Failed to fetch");
  const resend = (el: TillInvoiceCorrectionDialog) =>
    root(el).querySelector<HTMLElement>("[data-resend]")!;

  it("after an Open's answer is lost, offers only that same request again, never a new amount", async () => {
    const api = sendingApi();
    api.openInvoiceCorrection.mockRejectedValueOnce(lost());
    const { el } = await mountSending(api);

    await confirmCorrection(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-saved]")).not.toBeNull());
    expect(text(root(el).querySelector("[data-saved]"))).toBe(
      t("invoice_correction.saved").replaceAll("{amount}", "€6.05"),
    );
    expect(grossField(el)).toBeNull();
    expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("invoice_correction.unknown"));

    resend(el).click();
    await vi.waitFor(() => expect(root(el).querySelector("[data-back]")).not.toBeNull());
    const [first, second] = api.openInvoiceCorrection.mock.calls.map((call) => call[1]);
    expect(second).toEqual(first);
    expect(api.openInvoiceCorrection.mock.calls.map((call) => call[1].gross)).toEqual([
      "6.05",
      "6.05",
    ]);
  });

  it("offers a saved Open from an earlier visit, and forgets it once the correction it may have opened is found", async () => {
    const session = new InvoiceCorrectionSession(SCOPE, {
      openInvoiceCorrection: () => Promise.reject(lost()),
      giveInvoiceCorrectionCash: () => Promise.reject(lost()),
    });
    await session
      .open("sale-1", { gross: "2.00", reasonId: "overcharged", note: null, expectedSplit: SPLIT })
      .catch(() => {});
    const first = await mountSending();
    expect(text(root(first.el).querySelector("[data-saved]"))).toBe(
      t("invoice_correction.saved").replaceAll("{amount}", "€2.00"),
    );
    cleanupWidgets();

    const api = sendingApi();
    api.readInvoiceCorrectionLines.mockRejectedValue(
      refused("invoice_correction.already_open", { correctionId: "correction-1" }),
    );
    const { el } = await mountSending(api);
    await vi.waitFor(() => expect(root(el).querySelector("[data-back]")).not.toBeNull());
    expect(session.savedOpen("sale-1")).toBeNull();
    cleanupWidgets();

    const later = await mountSending();
    expect(root(later.el).querySelector("[data-saved]")).toBeNull();
    expect(grossField(later.el)).not.toBeNull();
  });

  it("gives no cash once the window is taken away while Open is on its way", async () => {
    const api = sendingApi();
    api.getRefundableTenders.mockResolvedValue([TENDERS[0]!]);
    let answer!: (value: { correction: InvoiceCorrectionView; replayed: boolean }) => void;
    api.openInvoiceCorrection.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const { el } = await mountSending(api);

    await confirmCorrection(el);
    await vi.waitFor(() => expect(api.openInvoiceCorrection).toHaveBeenCalledOnce());
    el.remove();
    answer({ correction: OPEN, replayed: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();
  });

  it("after a cash answer is lost, gives that same amount again even when less is left", async () => {
    const api = sendingApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(lost());
    const { el } = await mountSending(api, "correction-1");

    root(el).querySelector<HTMLElement>("[data-choice=cash]")!.click();
    await vi.waitFor(() =>
      expect(root(el).querySelector("wt-form-actions")!.error).toBe(
        t("invoice_correction.unknown"),
      ),
    );
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, moneyBack: "2.00", left: "4.05" });
    el.legsRevision = 1;
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-left]"))).toBe(
        t("invoice_correction.left_back").replace("{amount}", "€4.05"),
      ),
    );
    expect(text(root(el).querySelector("[data-choice=cash]"))).toBe(
      t("invoice_correction.give_cash").replace("{amount}", "€6.05"),
    );
    root(el).querySelector<HTMLElement>("[data-choice=cash]")!.click();
    await vi.waitFor(() => expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledTimes(2));
    const [first, second] = api.giveInvoiceCorrectionCash.mock.calls.map((call) => call[1]);
    expect(second).toEqual(first);
    expect(second!.amount).toBe("6.05");
  });

  it("asks for the PIN of someone who may refund when the cash is refused for permission", async () => {
    const api = sendingApi();
    api.giveInvoiceCorrectionCash.mockRejectedValueOnce(
      refused("authorization.not_permitted", { permission: "sale.refund" }),
    );
    const { el } = await mountSending(api, "correction-1");

    root(el).querySelector<HTMLElement>("[data-choice=cash]")!.click();
    await pinDialog(el);
    expect(api.listApprovers).toHaveBeenCalledExactlyOnceWith("sale.refund");
  });

  it("reads the correction again when its split changed, saying so", async () => {
    const api = sendingApi();
    api.getInvoiceCorrection.mockResolvedValue({
      ...OPEN,
      moneyBack: "2.00",
      left: "4.05",
      fileNow: { gross: "2.00", vatBreakdown: SPLIT },
    });
    api.fileInvoiceCorrection.mockRejectedValueOnce(refused("invoice_correction.split_changed"));
    const { el } = await mountSending(api, "correction-1");

    root(el).querySelector<HTMLElement>("[data-choice=file]")!.click();
    await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(root(el).querySelector("wt-form-actions")!.error).toBe(
        codeMessage("invoice_correction.split_changed"),
      ),
    );
  });

  it("says a lost filing answer needs checking, not that the same request goes again", async () => {
    const api = sendingApi();
    api.getInvoiceCorrection.mockResolvedValue({
      ...OPEN,
      moneyBack: "2.00",
      left: "4.05",
      fileNow: { gross: "2.00", vatBreakdown: SPLIT },
    });
    api.fileInvoiceCorrection.mockRejectedValueOnce(lost());
    const { el } = await mountSending(api, "correction-1");

    root(el).querySelector<HTMLElement>("[data-choice=file]")!.click();
    await vi.waitFor(() =>
      expect(root(el).querySelector("wt-form-actions")!.error).toBe(
        t("invoice_correction.unknown_end"),
      ),
    );
    expect(root(el).querySelector("[data-choice=check]")).not.toBeNull();
  });

  it("reads the correction again after a step that was under way when a card refund ended", async () => {
    const api = sendingApi();
    let answer!: (value: unknown) => void;
    api.giveInvoiceCorrectionCash.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    const { el } = await mountSending(api, "correction-1");

    root(el).querySelector<HTMLElement>("[data-choice=cash]")!.click();
    await vi.waitFor(() => expect(api.giveInvoiceCorrectionCash).toHaveBeenCalledOnce());
    el.legsRevision = 1;
    await el.updateComplete;
    answer({
      correction: { ...OPEN, moneyBack: "1.00", left: "5.05" },
      refunds: [],
      replayed: false,
    });
    await vi.waitFor(() => expect(api.getInvoiceCorrection).toHaveBeenCalledTimes(2));
  });

  it("offers only the payments this device may refund, naming the card and the reason it was opened with", async () => {
    const api = sendingApi();
    api.openInvoiceCorrection.mockResolvedValue({
      correction: { ...OPEN, reason: "Charged the steak twice" },
      replayed: false,
    });
    const { el } = await mountSending(api, "", ["take-cash"]);
    const cards: unknown[] = [];
    el.addEventListener("invoice-correction-card", (event) =>
      cards.push((event as CustomEvent).detail),
    );

    await confirmCorrection(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-choice=cash]")).not.toBeNull());
    expect(root(el).querySelector("[data-choice=card]")).toBeNull();

    el.capabilities = ["integrated-card-payment"];
    await el.updateComplete;
    expect(root(el).querySelector("[data-choice=cash]")).toBeNull();
    root(el).querySelector<HTMLElement>("[data-choice=card]")!.click();
    expect(cards).toEqual([
      {
        correctionId: "correction-1",
        tenderId: "card-1",
        target: "6.05",
        startReasonId: "overcharged",
      },
    ]);
  });
});

describe("review fix round 2", () => {
  afterEach(() => localStorage.clear());
  const lost = () => new TypeError("Failed to fetch");

  it.each([
    ["only in cash", [TENDERS[0]!], "invoice_correction.saved_cash"],
    ["in cash and by card", TENDERS, "invoice_correction.saved"],
  ] as const)("says what Send again does to a bill paid %s", async (_paid, tenders, key) => {
    const api = sendingApi();
    api.getRefundableTenders.mockResolvedValue([...tenders]);
    api.openInvoiceCorrection.mockRejectedValueOnce(lost());
    const { el } = await mountSending(api);

    await confirmCorrection(el);
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-saved]"))).toBe(
        t(key).replaceAll("{amount}", "€6.05"),
      ),
    );
  });

  it("does not preselect its own reason on a correction another device opened", async () => {
    const api = sendingApi();
    api.openInvoiceCorrection.mockRejectedValue(
      refused("invoice_correction.already_open", { correctionId: "correction-9" }),
    );
    api.getInvoiceCorrection.mockResolvedValue({ ...OPEN, id: "correction-9", reason: "Other" });
    const { el } = await mountSending(api);
    const cards: InvoiceCorrectionCardLeg[] = [];
    el.addEventListener("invoice-correction-card", (event) =>
      cards.push((event as CustomEvent<InvoiceCorrectionCardLeg>).detail),
    );

    await confirmCorrection(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-choice=card]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-choice=card]")!.click();
    expect(cards.map((card) => card.startReasonId)).toEqual(["other"]);
  });

  it("on an all-cash bill a device that may not refund cash stops after Open, showing the correction", async () => {
    const api = sendingApi();
    api.getRefundableTenders.mockResolvedValue([TENDERS[0]!]);
    const { el } = await mountSending(api, "", ["integrated-card-payment"]);

    await confirmCorrection(el);
    await vi.waitFor(() => expect(root(el).querySelector("[data-back]")).not.toBeNull());
    expect(api.openInvoiceCorrection).toHaveBeenCalledOnce();
    expect(api.giveInvoiceCorrectionCash).not.toHaveBeenCalled();
  });

  it("after a PIN, a lost filing answer still says to check, not that the same request goes again", async () => {
    const api = sendingApi();
    api.getInvoiceCorrection.mockResolvedValue({
      ...OPEN,
      moneyBack: "2.00",
      left: "4.05",
      fileNow: { gross: "2.00", vatBreakdown: SPLIT },
    });
    api.fileInvoiceCorrection
      .mockRejectedValueOnce(refused("authorization.not_permitted", { permission: "sale.rectify" }))
      .mockRejectedValueOnce(lost());
    const { el } = await mountSending(api, "correction-1");

    root(el).querySelector<HTMLElement>("[data-choice=file]")!.click();
    signIn(await pinDialog(el));
    await vi.waitFor(() =>
      expect(root(el).querySelector("wt-form-actions")!.error).toBe(
        t("invoice_correction.unknown_end"),
      ),
    );
  });
});

it.each(["en", "es"])("links its help to the guide's Correct an invoice in %s", async (locale) => {
  setLocale(locale);
  const { el } = await mount();
  const tip = root(el).querySelector<HTMLElementTagNameMap["wt-help-tooltip"]>("wt-help-tooltip")!;
  expect(tip.getAttribute("mode")).toBe("help-mode");
  expect(tip.getAttribute("guide-href")).toBe(`/help/${locale}/table-service#correct-invoice`);
});
