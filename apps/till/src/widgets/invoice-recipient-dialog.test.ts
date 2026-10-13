import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./invoice-recipient-dialog.js";
import type {
  InvoiceRecipientDetail,
  TillInvoiceRecipientDialog,
} from "./invoice-recipient-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mountDialog() {
  const { el } = await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {});
  return el;
}

async function fill(el: TillInvoiceRecipientDialog, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElement>(`wt-input[name=${name}]`)!;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

describe("till-invoice-recipient-dialog", () => {
  it("shows Spain in the selected language", async () => {
    const el = await mountDialog();
    const country = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "wt-input[name=countryCode]",
    )!;
    expect(country.value).toBe("Spain");
  });

  it.each(["en", "es-ES"])(
    "puts a server field refusal under its field with a generic bottom message in %s",
    async (locale) => {
      setLocale(locale);
      const el = await mountDialog();
      await fill(el, "taxId", "12345678Z");
      await fill(el, "legalName", "Ana García");
      await fill(el, "address", "Calle Mayor 1");
      await fill(el, "postalCode", "28013");
      await fill(el, "locality", "Madrid");
      await fill(el, "province", "Madrid");
      el.refusal = "Check the customer name";
      el.refusalField = "legalName";
      await el.updateComplete;

      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=legalName]")!
          .error,
      ).toBe("Check the customer name");
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-invoice-save]")!
          .disabled,
      ).toBe(false);

      el.refusalField = "";
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
        "Check the customer name",
      );
    },
  );

  it("retains an unscoped server refusal alongside local field errors", async () => {
    const el = await mountDialog();
    el.refusal = "The server could not be reached";
    el.refusalField = "";
    await el.updateComplete;
    await fill(el, "legalName", "Ana García");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      `${t("form.fix_fields")} The server could not be reached`,
    );
  });

  it("identifies a missing province before sending a full invoice recipient", async () => {
    const el = await mountDialog();
    const saved: InvoiceRecipientDetail[] = [];
    el.addEventListener("invoice-recipient-confirm", (event) =>
      saved.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
    );

    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await fill(el, "address", "Calle Mayor 1");
    await fill(el, "postalCode", "28013");
    await fill(el, "locality", "Madrid");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await el.updateComplete;

    expect(saved).toEqual([]);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=province]")!
        .error,
    ).not.toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));

    await fill(el, "province", "Madrid");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(saved[0]?.recipient.address).toBe("Calle Mayor 1, 28013 Madrid, Madrid, España");
  });

  it("marks an invalid Spanish tax ID and missing customer details, then saves corrected details", async () => {
    const el = await mountDialog();
    const saved: InvoiceRecipientDetail[] = [];
    el.addEventListener("invoice-recipient-confirm", (event) =>
      saved.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
    );

    await fill(el, "taxId", "12345678A");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await el.updateComplete;

    expect(saved).toEqual([]);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=taxId]")!.error,
    ).not.toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=legalName]")!
        .error,
    ).not.toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=address]")!
        .error,
    ).not.toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-invoice-save]")!
        .disabled,
    ).toBe(true);

    await fill(el, "taxId", " 12345678z ");
    await fill(el, "legalName", "  Ana García ");
    await fill(el, "address", "  Calle Mayor 1 ");
    await fill(el, "postalCode", " 28013 ");
    await fill(el, "locality", " Madrid ");
    await fill(el, "province", " Madrid ");

    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(saved).toEqual([
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Ana García",
          address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    ]);
  });
});

const officePrinter = { id: "pp-office", name: "Office HP" };

async function mountWithPrinter(props: Partial<TillInvoiceRecipientDialog> = {}) {
  const { el } = await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {
    deliveryOptions: { invoicePrinter: officePrinter, emailAvailable: false },
    ...props,
  });
  return el;
}

function deliveryField(el: TillInvoiceRecipientDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=delivery]",
  );
}

async function chooseDelivery(el: TillInvoiceRecipientDialog, value: string) {
  const field = deliveryField(el)!;
  field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await field.updateComplete;
  const index = field.options.findIndex((option) => option.value === value);
  field.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")[index]!.click();
  await el.updateComplete;
}

async function fillValid(el: TillInvoiceRecipientDialog) {
  for (const [name, value] of [
    ["taxId", "12345678Z"],
    ["legalName", "Ana García"],
    ["address", "Calle Mayor 1"],
    ["postalCode", "28013"],
    ["locality", "Madrid"],
    ["province", "Madrid"],
  ] as const)
    await fill(el, name, value);
}

function confirmations(el: TillInvoiceRecipientDialog) {
  const sent: InvoiceRecipientDetail[] = [];
  el.addEventListener("invoice-recipient-confirm", (event) =>
    sent.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
  );
  return sent;
}

const anaGarcia = {
  taxId: "12345678Z",
  legalName: "Ana García",
  address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
  countryCode: "ES",
} as const;

describe("till-invoice-recipient-dialog delivery choice", () => {
  it("offers no delivery choice and sends none when the location has no invoice printer", async () => {
    const el = await mountDialog();
    const sent = confirmations(el);
    expect(deliveryField(el)).toBeNull();
    await fillValid(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(sent).toEqual([{ invoiceType: "F1", recipient: anaGarcia }]);
  });

  it.each([
    ["en", "Printed receipt", "A4 on Office HP", "Delivery"],
    ["es-ES", "Ticket impreso", "A4 en Office HP", "Entrega"],
  ])(
    "offers the printed receipt first and A4 on the invoice printer in %s",
    async (locale, receipt, a4, label) => {
      setLocale(locale);
      const el = await mountWithPrinter();
      const field = deliveryField(el)!;
      expect(field.label).toBe(label);
      expect(field.options.map((option) => [option.value, option.label])).toEqual([
        ["receipt", receipt],
        ["a4", a4],
      ]);
      expect(field.value).toBe("receipt");
    },
  );

  it("sends the printed receipt by default, and A4 on the invoice printer once chosen", async () => {
    const el = await mountWithPrinter();
    const sent = confirmations(el);
    await fillValid(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await chooseDelivery(el, "a4");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(sent).toEqual([
      { invoiceType: "F1", recipient: anaGarcia, delivery: { medium: "receipt" } },
      {
        invoiceType: "F1",
        recipient: anaGarcia,
        delivery: { medium: "a4", pagePrinterId: "pp-office" },
      },
    ]);
  });

  it("reopens on a saved A4 choice for the current invoice printer, with Save quiet", async () => {
    const el = await mountWithPrinter({
      savedDelivery: { medium: "a4", pagePrinterId: "pp-office" },
    });
    expect(deliveryField(el)!.value).toBe("a4");
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
    await save.updateComplete;
    expect(save.disabled).toBe(true);
  });

  it("opens a saved A4 for another printer on the current invoice printer, with Save active", async () => {
    const el = await mountWithPrinter({
      savedDelivery: { medium: "a4", pagePrinterId: "pp-retired" },
    });
    const sent = confirmations(el);
    expect(deliveryField(el)!.options.map((option) => option.value)).toEqual(["receipt", "a4"]);
    expect(deliveryField(el)!.value).toBe("a4");
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["primary", false]);
    await fillValid(el);
    save.click();
    expect(sent[0]!.delivery).toEqual({ medium: "a4", pagePrinterId: "pp-office" });
  });

  it("opens a saved A4 on the printed receipt when the read found no invoice printer, with Save active", async () => {
    const { el } = await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {
      deliveryOptions: { invoicePrinter: null, emailAvailable: false },
      savedDelivery: { medium: "a4", pagePrinterId: "pp-retired" },
    });
    const sent = confirmations(el);
    expect(deliveryField(el)!.options.map((option) => [option.value, option.label])).toEqual([
      ["receipt", "Printed receipt"],
    ]);
    expect(deliveryField(el)!.value).toBe("receipt");
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["primary", false]);
    await fillValid(el);
    save.click();
    expect(sent[0]!.delivery).toEqual({ medium: "receipt" });
  });

  it("keeps the A4 choice after a refused request, shows the refusal at the bottom and sends it again", async () => {
    const el = await mountWithPrinter();
    const sent = confirmations(el);
    await fillValid(el);
    await chooseDelivery(el, "a4");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    el.refusal = codeMessage("invoice_delivery.printer_invalid");
    el.refusalField = "";
    await el.updateComplete;

    expect(deliveryField(el)!.value).toBe("a4");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      codeMessage("invoice_delivery.printer_invalid"),
    );
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
    await save.updateComplete;
    expect(save.disabled).toBe(false);
    save.click();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.delivery).toEqual({ medium: "a4", pagePrinterId: "pp-office" });
  });
});

describe("till-invoice-recipient-dialog keeps a saved delivery it does not offer", () => {
  const optionValues = (el: TillInvoiceRecipientDialog) =>
    deliveryField(el)!.options.map((option) => [option.value, option.label]);

  it("shows no field and sends a saved printed receipt back unchanged", async () => {
    const { el } = await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {
      savedDelivery: { medium: "receipt" },
    });
    const sent = confirmations(el);
    await fillValid(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(deliveryField(el)).toBeNull();
    expect(sent).toEqual([
      { invoiceType: "F1", recipient: anaGarcia, delivery: { medium: "receipt" } },
    ]);
  });

  it.each([
    ["en", "Saved choice: A4"],
    ["es-ES", "Opción guardada: A4"],
  ])(
    "keeps a saved A4 when no invoice printer could be read, and sends it back unchanged (%s)",
    async (locale, label) => {
      setLocale(locale);
      const { el } = await mountWidget<TillInvoiceRecipientDialog>(
        "till-invoice-recipient-dialog",
        { deliveryOptions: null, savedDelivery: { medium: "a4", pagePrinterId: "pp-office" } },
      );
      const sent = confirmations(el);
      expect(optionValues(el)).toEqual([
        ["receipt", t("invoice.delivery_receipt")],
        ["saved", label],
      ]);
      expect(deliveryField(el)!.value).toBe("saved");
      await fillValid(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
      expect(sent[0]!.delivery).toEqual({ medium: "a4", pagePrinterId: "pp-office" });
    },
  );

  it("keeps a saved email beside the offered choices until the delivery field changes", async () => {
    const el = await mountWithPrinter({
      savedDelivery: { medium: "email", recipient: "ana@example.com" },
    });
    const sent = confirmations(el);
    expect(optionValues(el)).toEqual([
      ["receipt", "Printed receipt"],
      ["a4", "A4 on Office HP"],
      ["saved", "Saved choice: email"],
    ]);
    expect(deliveryField(el)!.value).toBe("saved");
    await fillValid(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await chooseDelivery(el, "receipt");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(sent.map((detail) => detail.delivery)).toEqual([
      { medium: "email", recipient: "ana@example.com" },
      { medium: "receipt" },
    ]);
  });

  it("follows a re-read invoice printer, and falls back to what was saved (else the printed receipt) when the chosen one goes", async () => {
    const el = await mountWithPrinter();
    const sent = confirmations(el);
    await fillValid(el);
    await chooseDelivery(el, "a4");
    el.deliveryOptions = {
      invoicePrinter: { id: "pp-new", name: "New HP" },
      emailAvailable: false,
    };
    await el.updateComplete;
    expect(deliveryField(el)!.value).toBe("a4");
    expect(optionValues(el)).toEqual([
      ["receipt", "Printed receipt"],
      ["a4", "A4 on New HP"],
    ]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    el.deliveryOptions = { invoicePrinter: null, emailAvailable: false };
    await el.updateComplete;
    expect(optionValues(el)).toEqual([["receipt", "Printed receipt"]]);
    expect(deliveryField(el)!.value).toBe("receipt");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(sent.map((detail) => detail.delivery)).toEqual([
      { medium: "a4", pagePrinterId: "pp-new" },
      { medium: "receipt" },
    ]);
  });
});

describe("till-invoice-recipient-dialog after an unknown read", () => {
  it("replaces a kept saved A4 with the current printer once a read succeeds", async () => {
    const { el } = await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {
      deliveryOptions: null,
      savedDelivery: { medium: "a4", pagePrinterId: "pp-retired" },
    });
    expect(deliveryField(el)!.value).toBe("saved");
    el.deliveryOptions = { invoicePrinter: officePrinter, emailAvailable: false };
    await el.updateComplete;
    expect(deliveryField(el)!.options.map((option) => option.value)).toEqual(["receipt", "a4"]);
    expect(deliveryField(el)!.value).toBe("a4");
  });

  it("keeps a saved email as saved when the read failed or found email unavailable", async () => {
    for (const deliveryOptions of [null, { invoicePrinter: null, emailAvailable: false }]) {
      const { el } = await mountWidget<TillInvoiceRecipientDialog>(
        "till-invoice-recipient-dialog",
        { deliveryOptions, savedDelivery: { medium: "email", recipient: "ana@example.com" } },
      );
      expect(deliveryField(el)!.value).toBe("saved");
      cleanupWidgets();
    }
  });
});

const withEmail = { invoicePrinter: officePrinter, emailAvailable: true };

function emailField(el: TillInvoiceRecipientDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]");
}

function save(el: TillInvoiceRecipientDialog) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
}

describe("till-invoice-recipient-dialog email delivery", () => {
  it.each([
    ["en", "Email", "Customer email"],
    ["es-ES", "Correo electrónico", "Correo electrónico del cliente"],
  ])(
    "offers Email when invoice email is available, and asks for the address once it is chosen (%s)",
    async (locale, option, label) => {
      setLocale(locale);
      const el = await mountWithPrinter({ deliveryOptions: withEmail });
      expect(deliveryField(el)!.options.map((entry) => [entry.value, entry.label])).toEqual([
        ["receipt", t("invoice.delivery_receipt")],
        ["a4", t("invoice.delivery_a4_on").replace("{printer}", "Office HP")],
        ["email", option],
      ]);
      expect(emailField(el)).toBeNull();
      await chooseDelivery(el, "email");
      const field = emailField(el)!;
      expect([field.label, field.required, field.type, field.value]).toEqual([
        label,
        true,
        "email",
        "",
      ]);
    },
  );

  it("lets the browser offer no earlier customer's details in any customer field", async () => {
    const el = await mountWithPrinter({ deliveryOptions: withEmail });
    await chooseDelivery(el, "email");
    const names = ["taxId", "legalName", "address", "postalCode", "locality", "province", "email"];
    const autocomplete: Record<string, string | null> = {};
    for (const name of names) {
      const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `wt-input[name=${name}]`,
      )!;
      await field.updateComplete;
      autocomplete[name] = field.shadowRoot!.querySelector("input")!.getAttribute("autocomplete");
    }
    expect(autocomplete).toEqual(Object.fromEntries(names.map((name) => [name, "off"])));
  });

  it("offers Email without an invoice printer, and nothing but paper when email is unavailable", async () => {
    const el = await mountWithPrinter({
      deliveryOptions: { invoicePrinter: null, emailAvailable: true },
    });
    expect(deliveryField(el)!.options.map((entry) => entry.value)).toEqual(["receipt", "email"]);
    cleanupWidgets();
    const none = await mountWithPrinter({
      deliveryOptions: { invoicePrinter: null, emailAvailable: false },
    });
    expect(deliveryField(none)).toBeNull();
  });

  it("sends the address, without the spaces typed around it, with an Email choice", async () => {
    const el = await mountWithPrinter({ deliveryOptions: withEmail });
    const sent = confirmations(el);
    await fillValid(el);
    await chooseDelivery(el, "email");
    await fill(el, "email", "  ana@example.com ");
    save(el);
    expect(sent).toEqual([
      {
        invoiceType: "F1",
        recipient: anaGarcia,
        delivery: { medium: "email", recipient: "ana@example.com" },
      },
    ]);
  });

  it.each([
    ["en", ""],
    ["en", "ana@example"],
    ["es-ES", "ana example.com"],
  ])(
    "marks a missing or malformed address beside the field and once at the bottom (%s, %j)",
    async (locale, address) => {
      setLocale(locale);
      const el = await mountWithPrinter({ deliveryOptions: withEmail });
      const sent = confirmations(el);
      await fillValid(el);
      await chooseDelivery(el, "email");
      if (address !== "") await fill(el, "email", address);
      save(el);
      await el.updateComplete;
      expect(sent).toEqual([]);
      expect(emailField(el)!.error).toBe(t("invoice.email_invalid"));
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
      await fill(el, "email", "ana@example.com");
      expect(emailField(el)!.error).toBe("");
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
      save(el);
      expect(sent[0]!.delivery).toEqual({ medium: "email", recipient: "ana@example.com" });
    },
  );

  it("ignores an unfinished address once another delivery is chosen", async () => {
    const el = await mountWithPrinter({ deliveryOptions: withEmail });
    const sent = confirmations(el);
    await fillValid(el);
    await chooseDelivery(el, "email");
    await fill(el, "email", "ana@");
    await chooseDelivery(el, "a4");
    expect(emailField(el)).toBeNull();
    save(el);
    expect(sent.map((detail) => detail.delivery)).toEqual([
      { medium: "a4", pagePrinterId: "pp-office" },
    ]);
  });

  it("opens a saved email on Email with its address, and sends it back unchanged", async () => {
    const el = await mountWithPrinter({
      deliveryOptions: withEmail,
      savedDelivery: { medium: "email", recipient: "ana@example.com" },
    });
    const sent = confirmations(el);
    expect(deliveryField(el)!.options.map((entry) => entry.value)).toEqual([
      "receipt",
      "a4",
      "email",
    ]);
    expect(deliveryField(el)!.value).toBe("email");
    expect(emailField(el)!.value).toBe("ana@example.com");
    await fillValid(el);
    save(el);
    expect(sent[0]!.delivery).toEqual({ medium: "email", recipient: "ana@example.com" });
  });

  it("puts a refused address under the email field, and an unavailable email at the bottom", async () => {
    const el = await mountWithPrinter({ deliveryOptions: withEmail });
    const sent = confirmations(el);
    const edits: string[] = [];
    el.addEventListener("invoice-recipient-edit", (event) =>
      edits.push((event as CustomEvent<{ field: string }>).detail.field),
    );
    await fillValid(el);
    await chooseDelivery(el, "email");
    await fill(el, "email", "ana@example.com");
    save(el);
    el.refusal = t("invoice.email_invalid");
    el.refusalField = "email";
    await el.updateComplete;
    expect(emailField(el)!.error).toBe(t("invoice.email_invalid"));
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    await fill(el, "email", "ana@example.org");
    expect(edits).toEqual(["email"]);

    el.refusal = codeMessage("invoice_delivery.email_unavailable");
    el.refusalField = "";
    await el.updateComplete;
    expect(emailField(el)!.error).toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      codeMessage("invoice_delivery.email_unavailable"),
    );
    expect(deliveryField(el)!.value).toBe("email");
    save(el);
    expect(sent.map((detail) => detail.delivery)).toEqual([
      { medium: "email", recipient: "ana@example.com" },
      { medium: "email", recipient: "ana@example.org" },
    ]);
  });

  it("falls back to the printed receipt when a re-read says email is no longer available", async () => {
    const el = await mountWithPrinter({ deliveryOptions: withEmail });
    const sent = confirmations(el);
    await fillValid(el);
    await chooseDelivery(el, "email");
    await fill(el, "email", "ana@example.com");
    el.deliveryOptions = { invoicePrinter: officePrinter, emailAvailable: false };
    await el.updateComplete;
    expect(deliveryField(el)!.value).toBe("receipt");
    expect(emailField(el)).toBeNull();
    save(el);
    expect(sent[0]!.delivery).toEqual({ medium: "receipt" });
  });
});
