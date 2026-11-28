import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import type { CorrectiveChoice, GiveBackPreview, GiveBackRequest } from "../api/give-back-types.js";
import { GiveBackSession } from "../state/give-back.js";
import { SCOPE, fakeGiveBackApi, previewFor, refundsOn } from "./give-back-dialog.test-helpers.js";
import "./give-back-dialog.js";
import type { TillGiveBackDialog } from "./give-back-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
  localStorage.clear();
});

const PRINTERS: CorrectiveChoice["printers"] = [
  { id: "office", name: "Office", kind: "a4" },
  { id: "bar", name: "Bar", kind: "receipt" },
];
const A4: CorrectiveChoice = {
  default: { medium: "a4", printerId: "office", printerName: "Office" },
  printers: PRINTERS,
  emailAvailable: true,
};
const EMAILED: CorrectiveChoice = {
  default: { medium: "email", recipient: "ana@example.com" },
  printers: PRINTERS,
  emailAvailable: true,
};

function answering(corrective: CorrectiveChoice | undefined) {
  const api = fakeGiveBackApi();
  api.previewGiveBack.mockImplementation(
    async (_saleId: string, request: GiveBackRequest): Promise<GiveBackPreview> => ({
      ...previewFor(request),
      ...(corrective === undefined ? {} : { corrective }),
    }),
  );
  return api;
}

const root = (el: TillGiveBackDialog) => el.shadowRoot!;
/** The corrective line's own shadow root, where the line, Change and the sheet are drawn. */
const choiceRoot = (el: TillGiveBackDialog) =>
  root(el).querySelector("till-corrective-choice")?.shadowRoot ?? null;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const line = (el: TillGiveBackDialog) =>
  text(choiceRoot(el)?.querySelector("[data-corrective-way]") ?? null);
const lineError = (el: TillGiveBackDialog) =>
  text(choiceRoot(el)?.querySelector("[data-corrective-error]") ?? null);
const sheet = (el: TillGiveBackDialog) =>
  choiceRoot(el)?.querySelector("till-corrective-sheet") ?? null;
const inSheet = <T extends Element = HTMLElement>(el: TillGiveBackDialog, selector: string) =>
  sheet(el)!.shadowRoot!.querySelector<T>(selector);
const bottom = (el: TillGiveBackDialog) => root(el).querySelector("wt-form-actions")!.error;
const asked = (api: ReturnType<typeof fakeGiveBackApi>) =>
  api.giveBack.mock.calls.map(([, body]) => body.request);

/** Opens the goodwill form for €5.00 with a reason, and waits for the preview's summary. */
async function mount(api = answering(A4)) {
  const { el } = await mountWidget<TillGiveBackDialog>("till-give-back-dialog", {
    api,
    session: new GiveBackSession(SCOPE, api),
    refunds: refundsOn(api),
    capabilities: ["take-cash", "integrated-card-payment"],
    saleId: "sale-1",
    invoiceNumber: "A/1042",
    namesLocale: "en",
    fullInvoice: true,
  });
  await vi.waitFor(() => expect(root(el).querySelector("[data-loading]")).toBeNull());
  root(el).querySelector<HTMLElement>("[data-choice=goodwill]")!.click();
  await el.updateComplete;
  const amount = root(el).querySelector("wt-price-input[name=amount]")!;
  await (amount as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  await userEvent.fill(page.elementLocator(amount.shadowRoot!.querySelector("input")!), "5");
  root(el)
    .querySelector("wt-combobox[name=reason]")!
    .dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "complaint" },
        bubbles: true,
        composed: true,
      }),
    );
  await vi.waitFor(() => expect(root(el).querySelector("[data-summary]")).not.toBeNull());
  await el.updateComplete;
  return { el, api };
}

async function openSheet(el: TillGiveBackDialog) {
  choiceRoot(el)!.querySelector<HTMLElement>("[data-corrective-change]")!.click();
  await vi.waitFor(() => expect(sheet(el)).not.toBeNull());
  await sheet(el)!.updateComplete;
}
async function chooseWay(el: TillGiveBackDialog, value: string) {
  inSheet(el, "wt-combobox[name=delivery]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await sheet(el)!.updateComplete;
}
async function typeEmail(el: TillGiveBackDialog, value: string) {
  const field = inSheet<HTMLElement & { updateComplete: Promise<unknown> }>(
    el,
    "wt-input[name=email]",
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await sheet(el)!.updateComplete;
}
const emailError = (el: TillGiveBackDialog) =>
  inSheet<HTMLElement & { error: string }>(el, "wt-input[name=email]")!.error;
const sheetBottom = (el: TillGiveBackDialog) =>
  inSheet<HTMLElement & { error: string }>(el, "wt-form-actions")!.error;
const done = (el: TillGiveBackDialog) =>
  inSheet<HTMLElement & { disabled: boolean }>(el, "[data-corrective-done]")!;
async function press(el: TillGiveBackDialog, api: ReturnType<typeof fakeGiveBackApi>) {
  root(el).querySelector<HTMLElement>("[data-submit]")!.click();
  await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalled());
}

describe("the corrective invoice's way on the form", () => {
  it("says it is printed on the A4 printer it goes to", async () => {
    const { el } = await mount();
    expect(line(el)).toBe("Corrective invoice: printed on A4 · Office");
  });

  it("says it is printed on the receipt printer it goes to, by name", async () => {
    const { el } = await mount(
      answering({ ...A4, default: { medium: "receipt", printerId: "bar", printerName: "Bar" } }),
    );
    expect(line(el)).toBe("Corrective invoice: printed on the receipt printer · Bar");
  });

  it("says only the receipt printer when the box does not name it", async () => {
    const { el } = await mount(
      answering({ ...A4, default: { medium: "receipt", printerId: "bar", printerName: "" } }),
    );
    expect(line(el)).toBe("Corrective invoice: printed on the receipt printer");
  });

  it("says it is emailed to the address it goes to", async () => {
    const { el } = await mount(answering(EMAILED));
    expect(line(el)).toBe("Corrective invoice: emailed to ana@example.com");
  });

  it("says it is emailed to the customer, with no Change, on a device that may not print", async () => {
    const { el } = await mount(
      answering({
        default: { medium: "email", recipient: null },
        printers: [],
        emailAvailable: false,
      }),
    );
    expect(line(el)).toBe("Corrective invoice: emailed to the customer");
    expect(choiceRoot(el)!.querySelector("[data-corrective-change]")).toBeNull();
  });

  it("says where to find it when it is not sent", async () => {
    const { el } = await mount(answering({ ...A4, default: null }));
    expect(line(el)).toBe("Corrective invoice: not sent; find it in Find a bill");
  });

  it("is not there when the give-back files no corrective full invoice", async () => {
    const { el } = await mount(answering(undefined));
    expect(root(el).querySelector("till-corrective-choice")).toBeNull();
  });

  it("in Spanish, says the way in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount(answering({ ...A4, default: null }));
    expect(line(el)).toBe(es["give_back.corrective_not_sent"]);
  });

  it("in Spanish, says it is printed on A4 or the receipt printer", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    expect(line(el)).toBe(es["give_back.corrective_printed_a4"].replace("{printer}", "Office"));
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe(
      es["give_back.corrective_printed_receipt_on"].replace("{printer}", "Bar"),
    );
  });
});

describe("Change", () => {
  it("sends nothing extra when the way is left as it is", async () => {
    const { el, api } = await mount();
    await press(el, api);
    expect(asked(api)[0]).not.toHaveProperty("correctiveDelivery");
    expect(
      api.previewGiveBack.mock.calls.every(([, request]) => !("correctiveDelivery" in request)),
    ).toBe(true);
  });

  it("prints on another printer chosen, and the press carries it", async () => {
    const { el, api } = await mount();
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: printed on the receipt printer · Bar");
    await press(el, api);
    expect(asked(api)[0]!.correctiveDelivery).toEqual({ medium: "print", printerId: "bar" });
    expect(
      api.previewGiveBack.mock.calls.every(([, request]) => !("correctiveDelivery" in request)),
    ).toBe(true);
  });

  it("emails another address typed, and the press carries it", async () => {
    const { el, api } = await mount(answering(EMAILED));
    await openSheet(el);
    expect(inSheet<HTMLElement & { value: string }>(el, "wt-input[name=email]")!.value).toBe(
      "ana@example.com",
    );
    await typeEmail(el, "luis@example.com");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: emailed to luis@example.com");
    await press(el, api);
    expect(asked(api)[0]!.correctiveDelivery).toEqual({
      medium: "email",
      recipient: "luis@example.com",
    });
  });

  it("names which of two receipt printers was chosen", async () => {
    const { el, api } = await mount(
      answering({
        default: { medium: "receipt", printerId: "bar", printerName: "Bar" },
        printers: [
          { id: "bar", name: "Bar", kind: "receipt" },
          { id: "terrace", name: "Terrace", kind: "receipt" },
        ],
        emailAvailable: false,
      }),
    );
    expect(line(el)).toBe("Corrective invoice: printed on the receipt printer · Bar");
    await openSheet(el);
    await chooseWay(el, "print:terrace");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: printed on the receipt printer · Terrace");
    await press(el, api);
    expect(asked(api)[0]!.correctiveDelivery).toEqual({ medium: "print", printerId: "terrace" });
  });

  it("choosing the way it already goes sends nothing extra", async () => {
    const { el, api } = await mount();
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await openSheet(el);
    await chooseWay(el, "print:office");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await press(el, api);
    expect(asked(api)[0]).not.toHaveProperty("correctiveDelivery");
  });

  it("says nothing about an address while it is typed, and Done works, until Done is pressed", async () => {
    const { el } = await mount();
    await openSheet(el);
    await chooseWay(el, "email");
    expect(done(el).disabled).toBe(false);
    await typeEmail(el, "ana@");
    expect(emailError(el)).toBe("");
    expect(sheetBottom(el)).toBe("");
    expect(done(el).disabled).toBe(false);
  });

  it("after Done with an address that is not one, marks it, says so once and holds Done until it is fixed", async () => {
    const { el, api } = await mount();
    await openSheet(el);
    await chooseWay(el, "email");
    await typeEmail(el, "ana@");
    done(el).click();
    await sheet(el)!.updateComplete;
    expect(sheet(el)).not.toBeNull();
    expect(emailError(el)).toBe("Enter an email address such as name@example.com.");
    expect(sheetBottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(done(el).disabled).toBe(true);
    await vi.waitFor(() =>
      expect(sheet(el)!.shadowRoot!.activeElement?.getAttribute("name")).toBe("email"),
    );
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(api.giveBack).not.toHaveBeenCalled();
    expect(sheet(el)).not.toBeNull();
    await typeEmail(el, "ana@example.com");
    expect(emailError(el)).toBe("");
    expect(sheetBottom(el)).toBe("");
    expect(done(el).disabled).toBe(false);
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: emailed to ana@example.com");
  });

  it("Done with no address marks the field and keeps the sheet open", async () => {
    const { el } = await mount();
    await openSheet(el);
    await chooseWay(el, "email");
    done(el).click();
    await sheet(el)!.updateComplete;
    expect(sheet(el)).not.toBeNull();
    expect(emailError(el)).toBe("Enter an email address such as name@example.com.");
    expect(sheetBottom(el)).toBe("Correct the highlighted fields to continue.");
  });

  it("Enter on an address that is not one presses Done, which marks it, and not Give back", async () => {
    const { el, api } = await mount();
    await openSheet(el);
    await chooseWay(el, "email");
    await typeEmail(el, "ana@");
    await userEvent.keyboard("{Enter}");
    await sheet(el)!.updateComplete;
    expect(emailError(el)).toBe("Enter an email address such as name@example.com.");
    expect(api.giveBack).not.toHaveBeenCalled();
    expect(sheet(el)).not.toBeNull();
  });

  it("Enter in the address field chooses it", async () => {
    const { el } = await mount(answering(EMAILED));
    await openSheet(el);
    await typeEmail(el, "luis@example.com");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: emailed to luis@example.com");
  });

  it("opens on the first printer offered when the invoice would not be sent", async () => {
    const { el } = await mount(answering({ ...A4, default: null }));
    await openSheet(el);
    expect(inSheet<HTMLElement & { value: string }>(el, "wt-combobox[name=delivery]")!.value).toBe(
      "print:office",
    );
  });

  it("opens on email, with no address, when no printer is offered", async () => {
    const { el } = await mount(answering({ default: null, printers: [], emailAvailable: true }));
    await openSheet(el);
    expect(inSheet<HTMLElement & { value: string }>(el, "wt-combobox[name=delivery]")!.value).toBe(
      "email",
    );
    expect(inSheet<HTMLElement & { value: string }>(el, "wt-input[name=email]")!.value).toBe("");
    expect(done(el).disabled).toBe(false);
  });

  it("offers email only when the box can send it", async () => {
    const { el } = await mount(answering({ ...A4, emailAvailable: false }));
    await openSheet(el);
    const options = inSheet<HTMLElement & { options: { value: string }[] }>(
      el,
      "wt-combobox[name=delivery]",
    )!.options;
    expect(options.map((option) => option.value)).toEqual(["print:office", "print:bar"]);
  });

  it("Cancel keeps the way it had", async () => {
    const { el, api } = await mount();
    await openSheet(el);
    await chooseWay(el, "print:bar");
    inSheet(el, "[data-corrective-cancel]")!.click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: printed on A4 · Office");
    await press(el, api);
    expect(asked(api)[0]).not.toHaveProperty("correctiveDelivery");
  });
});

describe("a refusal of the chosen way", () => {
  it("shows a printer no longer offered beside the line, and a new choice is sent", async () => {
    const api = answering(A4);
    api.giveBack.mockRejectedValueOnce({
      code: "invoice_delivery.printer_invalid",
      field: "correctiveDelivery.printerId",
      status: 409,
    });
    const { el } = await mount(api);
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await press(el, api);
    await vi.waitFor(() =>
      expect(lineError(el)).toBe("That printer is no longer available. Choose another."),
    );
    expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(
      root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-submit]")!.disabled,
    ).toBe(false);
    await openSheet(el);
    await chooseWay(el, "print:office");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(lineError(el)).toBe("");
    root(el).querySelector<HTMLElement>("[data-submit]")!.click();
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
    expect(asked(api)[1]).not.toHaveProperty("correctiveDelivery");
  });

  it("words email that cannot be sent now", async () => {
    const api = answering(EMAILED);
    api.giveBack.mockRejectedValueOnce({
      code: "invoice_delivery.email_unavailable",
      field: "correctiveDelivery.recipient",
      status: 409,
    });
    const { el } = await mount(api);
    await openSheet(el);
    await typeEmail(el, "luis@example.com");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await press(el, api);
    await vi.waitFor(() =>
      expect(lineError(el)).toBe("Email cannot be sent now. Choose a printer."),
    );
  });

  it("words an address the box refused, and Give back can be pressed again", async () => {
    const api = answering(EMAILED);
    api.giveBack.mockRejectedValueOnce({
      code: "management.request_invalid",
      field: "correctiveDelivery.recipient",
      status: 400,
    });
    const { el } = await mount(api);
    await openSheet(el);
    await typeEmail(el, "luis@example.com");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await press(el, api);
    await vi.waitFor(() =>
      expect(lineError(el)).toBe(
        "This way cannot be used for the corrective invoice. Choose another.",
      ),
    );
    const submit = root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-submit]")!;
    expect(submit.disabled).toBe(false);
    submit.click();
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
    expect(asked(api)[1]!.correctiveDelivery).toEqual({
      medium: "email",
      recipient: "luis@example.com",
    });
  });
});

describe("a refused address, then another way", () => {
  it("sends a new press carrying the way chosen after the refusal", async () => {
    const api = answering(EMAILED);
    api.giveBack.mockRejectedValueOnce({
      code: "management.request_invalid",
      field: "correctiveDelivery.recipient",
      status: 400,
    });
    const { el } = await mount(api);
    await openSheet(el);
    await typeEmail(el, "luis@example.com");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await press(el, api);
    await vi.waitFor(() =>
      expect(lineError(el)).toBe(
        "This way cannot be used for the corrective invoice. Choose another.",
      ),
    );
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    root(el).querySelector<HTMLElement>("[data-submit]")!.click();
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
    expect(asked(api)[1]!.correctiveDelivery).toEqual({ medium: "print", printerId: "bar" });
    const ids = api.giveBack.mock.calls.map(([, body]) => body.submissionIds.refund);
    expect(ids[1]).not.toBe(ids[0]);
    await vi.waitFor(() => expect(root(el).querySelector("[data-outcome]")).not.toBeNull());
  });
});

describe("a chosen printer a later preview no longer offers", () => {
  it("falls back to the way the invoice goes anyway, and the press sends no choice", async () => {
    const api = answering(A4);
    const { el } = await mount(api);
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    expect(line(el)).toBe("Corrective invoice: printed on the receipt printer · Bar");
    api.previewGiveBack.mockImplementation(async (_saleId, request) => ({
      ...previewFor(request),
      corrective: { ...A4, printers: [PRINTERS[0]!] },
    }));
    const amount = root(el).querySelector("wt-price-input[name=amount]")!;
    await userEvent.fill(page.elementLocator(amount.shadowRoot!.querySelector("input")!), "4");
    await vi.waitFor(() =>
      expect(api.previewGiveBack).toHaveBeenLastCalledWith(
        "sale-1",
        expect.objectContaining({ amount: "4.00" }),
      ),
    );
    await vi.waitFor(() => expect(line(el)).toBe("Corrective invoice: printed on A4 · Office"));
    await press(el, api);
    expect(asked(api)[0]).not.toHaveProperty("correctiveDelivery");
  });
});

describe("a press whose answer was lost", () => {
  it("sends the same way again", async () => {
    const api = answering(A4);
    api.giveBack.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mount(api);
    await openSheet(el);
    await chooseWay(el, "print:bar");
    done(el).click();
    await vi.waitFor(() => expect(sheet(el)).toBeNull());
    await press(el, api);
    await vi.waitFor(() => expect(root(el).querySelector("[data-send-again]")).not.toBeNull());
    root(el).querySelector<HTMLElement>("[data-send-again]")!.click();
    await vi.waitFor(() => expect(api.giveBack).toHaveBeenCalledTimes(2));
    expect(asked(api)[1]!.correctiveDelivery).toEqual({ medium: "print", printerId: "bar" });
  });
});
