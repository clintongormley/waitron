import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { GiveBackRequest, GiveBackView } from "../api/give-back-types.js";
import { CARD, CASH, VIEW, fakeGiveBackApi, previewFor } from "./give-back-dialog.test-helpers.js";
import "./give-back-dialog.js";
import type { GiveBackAsk, TillGiveBackDialog } from "./give-back-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

async function mount(api = fakeGiveBackApi()) {
  const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
    api,
    saleId: "sale-1",
    invoiceNumber: "A/1042",
    namesLocale: "en",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-loading]")).toBeNull());
  await el.updateComplete;
  return { el, api };
}
const withView = (over: Partial<GiveBackView>) => fakeGiveBackApi({ ...VIEW, ...over });

const root = (el: TillGiveBackDialog) => el.shadowRoot!;
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
        "Give back an amount you choose, for example for a complaint.",
      ],
      [
        "extra",
        "Extra paid on top of the bill",
        "Give back some or all of the €3.00 paid on top of the bill, and nothing else. The receipt shows it as Tip.",
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
      codeMessage(refused.code, "en", refused.params),
    );
    await choose(el, "goodwill");
    expect(root(el).querySelector("[data-purpose]")).toBeNull();
    await choose(el, "extra");
    expect(text(root(el).querySelector("[data-purpose]"))).toBe("Extra paid on top of the bill");
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
      ["Salad · €9.50", "Cancelled, money given back"],
    ]);
    expect(text(root(el).querySelector("[data-extra-of=paella]"))).toBe("Aioli · €1.50");
    expect(dish(el, "aioli")).toBeNull();
    expect(dish(el, "cake")).toBeNull();
    expect(text(root(el).querySelector("[data-free=cake]"))).toContain("Given free");
    expect([...root(el).querySelectorAll("wt-switch")].map((row) => row.description)).not.toContain(
      "Served",
    );
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
    expect(extra.label).toBe("Give back the extra paid on top too (€3.00)");
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
});

describe("How it goes back", () => {
  it("offers each payment up to what it holds, and shows a held one unavailable with its line", async () => {
    const held = { code: "tender.refund_in_progress" };
    const { el } = await mount(
      withView({ ways: [CASH, { ...CARD, pending: true, reason: held }] }),
    );
    await choose(el, "goodwill");
    expect(text(root(el).querySelector("[data-how] legend"))).toBe("How it goes back");
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
    expect(text(root(el).querySelector("[data-up-to]"))).toBe("Up to €47.00 can go back.");
  });
});

describe("the extra paid on top", () => {
  it("fills the extra in, offers only payments holding one, and previews it alone", async () => {
    const { el, api } = await mount();
    await choose(el, "extra");
    expect(amountField(el).label).toBe("Extra to give back");
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
      "€10.00 goes back in cash. The cash drawer opens: give it to the customer.",
    );
    expect(root(el).querySelector("[data-pin]")).toBeNull();
    expect(root(el).querySelector("[data-summary-rest]")).toBeNull();
    expect(text(submit(el))).toBe("Give back €10.00");
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
        "€7.00 goes back to card ···4242 through the card reader.",
      ),
    );
    expect(text(root(el).querySelector("[data-summary-rest]"))).toBe(
      "€3.00 cannot go back this way: it stays under way for the other payments.",
    );
    expect(text(root(el).querySelector("[data-pin]"))).toBe(
      "If you cannot give money back yourself, a supervisor or manager approves it with their PIN next.",
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
        "€10.00 goes back to card ···4242 on the separate card terminal.",
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

  it("hands on what was previewed when pressed", async () => {
    const { el } = await mount();
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
    await choose(el, "dishes");
    await tick(el, "paella");
    await reason(el, "complaint");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]).toEqual({
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
});

describe("in Spanish", () => {
  beforeEach(() => setLocale("es-ES"));

  it("words the choice, a dish and the extra from the approved screens", async () => {
    const { el } = await mount();
    expect(text(root(el).querySelector("[data-what-for]"))).toBe("¿Por qué se devuelve?");
    expect([...root(el).querySelectorAll("wt-choice-row")].map((row) => row.heading)).toEqual([
      "Un plato",
      "Cortesía o queja",
      "Lo pagado de más",
    ]);
    expect(text(choice(el, "extra"))).toBe(
      "Devuelve una parte o todos los 3,00 € pagados de más sobre la cuenta, y nada más. En el ticket figura como Propina.",
    );
    await choose(el, "dishes");
    expect(text(root(el).querySelector("[data-which]"))).toBe("¿Qué platos?");
    expect(dish(el, "paella")!.description).toBe("Cancelado, no servido");
    expect(dish(el, "salad")!.description).toBe("Cancelado, dinero devuelto");
    expect(text(root(el).querySelector("[data-free=cake]"))).toContain("Por invitación");
    expect(amountField(el).label).toBe("Dinero a devolver");
    expect(text(way(el, "cash")!.closest("label"))).toBe("Efectivo · hasta 30,00 €");
    way(el, "card-1")!.click();
    await el.updateComplete;
    expect(
      root(el)
        .querySelector<HTMLElementTagNameMap["wt-switch"]>("wt-switch[name=extra]")!
        .label.replace(/\s/g, " "),
    ).toBe("Devolver también lo pagado de más (3,00 €)");
    await tick(el, "croquetas");
    await vi.waitFor(() =>
      expect(text(root(el).querySelector("[data-summary-way]"))).toBe(
        "Se devuelven 8,00 € a la tarjeta ···4242 por el lector de tarjetas.",
      ),
    );
    expect(text(submit(el))).toBe("Devolver 8,00 €");
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
        "€2.00 goes back to card through the card reader.",
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
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
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
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]!.note).toBe("Spilt wine");
    expect(asks[0]!.reasonId).toBe("other");
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
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "6");
    submit(el).click();
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    pending.forEach((answer) => answer());
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]!.request.amount).toBe("6.00");
  });

  it("hands nothing on when the form changed meanwhile, and says so", async () => {
    const { api, pending } = slowApi();
    const { el } = await mount(api);
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "6");
    submit(el).click();
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    await type(el, "7");
    pending.forEach((answer) => answer());
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.changed_while_checking")));
    expect(asks).toEqual([]);
  });

  it("hands nothing on when the preview refuses", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue({ code: "invoice_correction.refund_pending" });
    const { el } = await mount(api);
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
    await choose(el, "goodwill");
    await reason(el, "complaint");
    await type(el, "6");
    submit(el).click();
    await vi.waitFor(() => expect(api.previewGiveBack).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    expect(asks).toEqual([]);
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
    expect(bottom(el)).toBe("");
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

describe("fix round 1", () => {
  it("treats a payment this device does not take as held, and picks the next", async () => {
    const { el } = await mount(withView({ ways: [{ ...CASH, allowedHere: false }, CARD] }));
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
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
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]!.request.way).toBe("card-1");
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
    const asks: GiveBackAsk[] = [];
    el.addEventListener("give-back-submit", (event) =>
      asks.push((event as CustomEvent<GiveBackAsk>).detail),
    );
    await choose(el, "dishes");
    await tick(el, "paella");
    await tick(el, "croquetas");
    await type(el, "25");
    await reason(el, "complaint");
    await vi.waitFor(() => expect(summary(el)).not.toBeNull());
    submit(el).click();
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0]!.expected).toEqual(parts);
  });

  it("says a preview that could not reach the box could not be checked", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mount(api);
    await choose(el, "goodwill");
    await type(el, "5");
    await vi.waitFor(() => expect(bottom(el)).toBe(t("give_back.preview_failed")));
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

  it("goes back with nothing staged at once", async () => {
    const { el } = await mount();
    await choose(el, "dishes");
    root(el).querySelector<HTMLElement>("[data-back]")!.click();
    await el.updateComplete;
    expect(choice(el, "dishes")).not.toBeNull();
  });
});
