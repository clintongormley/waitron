import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton, WtDialog, WtFormActions, WtInput } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi, OrderDeliveryAttempt } from "../api/client.js";
import "./invoice-email-dialog.js";
import type { InvoiceEmailDialog } from "./invoice-email-dialog.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function stubApi() {
  return {
    requestOrderEmailDelivery: vi.fn(async (): Promise<Partial<OrderDeliveryAttempt>> => ({
      id: "delivery-1",
      medium: "email",
    })),
  };
}
type Api = ReturnType<typeof stubApi>;

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(api: Api = stubApi()): Promise<InvoiceEmailDialog> {
  const { el } = await mountWidget<InvoiceEmailDialog>("dashboard-invoice-email-dialog", {
    api: api as unknown as DashboardApi,
  });
  return el;
}

async function open(el: InvoiceEmailDialog, orderId = "bill-1"): Promise<void> {
  el.show(orderId);
  await el.updateComplete;
  await expect.poll(() => dialog(el).open).toBe(true);
}

const dialog = (el: InvoiceEmailDialog) => el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
const input = (el: InvoiceEmailDialog) =>
  dialog(el).querySelector<WtInput>("wt-input[name=email]")!;
const send = (el: InvoiceEmailDialog) =>
  dialog(el).querySelector<WtButton>("wt-button[data-test=send-email]")!;
const actions = (el: InvoiceEmailDialog) =>
  dialog(el).querySelector<WtFormActions>("wt-form-actions")!;

async function type(el: InvoiceEmailDialog, value: string): Promise<void> {
  input(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function press(el: InvoiceEmailDialog): Promise<void> {
  send(el).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

it.each([
  ["en-GB", false, "Send by email", "Customer email", "Send"],
  ["en-GB", true, "Send a copy by email", "Customer email", "Send"],
  ["es-ES", false, "Enviar por correo electrónico", "Correo electrónico del cliente", "Enviar"],
  [
    "es-ES",
    true,
    "Enviar una copia por correo electrónico",
    "Correo electrónico del cliente",
    "Enviar",
  ],
] as const)(
  "asks for the customer's address in %s (a copy: %s), headed as the till's",
  async (locale, copy, heading, label, action) => {
    setLocale(locale);
    const el = await mount();
    el.show("bill-1", copy);
    await el.updateComplete;
    await expect.poll(() => dialog(el).open).toBe(true);
    expect(dialog(el).heading).toBe(heading);
    expect(input(el).label).toBe(label);
    expect(send(el).textContent!.trim()).toBe(action);
  },
);

it("turns off the browser's address suggestions on the email field", async () => {
  const el = await mount();
  await open(el);
  await input(el).updateComplete;
  const native = input(el).shadowRoot!.querySelector("input")!;
  expect(native.getAttribute("autocomplete")).toBe("off");
});

it("opens with an empty, required email field and keeps Send quiet until something is typed", async () => {
  const el = await mount();
  await open(el);
  const field = input(el);
  expect(field.value).toBe("");
  expect(field.required).toBe(true);
  expect(field.type).toBe("email");
  expect(send(el).variant).toBe("secondary");
  expect(send(el).disabled).toBe(true);
  await type(el, "ana@example.com");
  expect(send(el).variant).toBe("primary");
  expect(send(el).disabled).toBe(false);
  await type(el, "  ");
  expect(send(el).variant).toBe("secondary");
  expect(send(el).disabled).toBe(true);
});

it("opens with the cursor in the address field, so the person can type at once", async () => {
  const el = await mount();
  await open(el);
  await input(el).updateComplete;
  const inner = input(el).shadowRoot!.querySelector("input")!;
  const focused = () => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  };
  await expect.poll(focused).toBe(inner);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(focused()).toBe(inner);
});

it("does not send an empty address even when Send is clicked", async () => {
  const api = stubApi();
  const el = await mount(api);
  await open(el);
  await press(el);
  expect(api.requestOrderEmailDelivery).not.toHaveBeenCalled();
  expect(dialog(el).open).toBe(true);
  expect(input(el).error).toBe("");
  expect(actions(el).error).toBe("");
});

it("marks an address the server would refuse under the field and at the bottom, and holds Send until it is fixed", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    const el = await mount(api);
    await open(el);
    await type(el, "ana@example");
    await press(el);
    expect(api.requestOrderEmailDelivery).not.toHaveBeenCalled();
    expect(input(el).error).toBe(t("receipts.invalid_email"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(send(el).disabled).toBe(true);
    expect(send(el).variant).toBe("primary");
    await vi.waitFor(() => expect(input(el).matches(":focus-within")).toBe(true));
    await type(el, "ana@example.com");
    expect(input(el).error).toBe("");
    expect(actions(el).error).toBe("");
    expect(send(el).disabled).toBe(false);
    cleanupWidgets();
  }
  setLocale("es-ES");
  expect(t("receipts.invalid_email")).toBe(
    "Introduce un correo electrónico como nombre@ejemplo.com.",
  );
});

it("sends the trimmed address for the bill, under a new request key each press", async () => {
  const api = stubApi();
  api.requestOrderEmailDelivery.mockRejectedValueOnce({ code: "connection.failed" });
  const el = await mount(api);
  await open(el, "bill-7");
  await type(el, "  ana@example.com ");
  await press(el);
  await press(el);
  await vi.waitFor(() => expect(api.requestOrderEmailDelivery).toHaveBeenCalledTimes(2));
  const [first, second] = api.requestOrderEmailDelivery.mock.calls as unknown as [
    string,
    string,
    string,
  ][];
  expect(first!.slice(0, 2)).toEqual(["bill-7", "ana@example.com"]);
  expect(first![2]).toMatch(UUID);
  expect(second![2]).toMatch(UUID);
  expect(second![2]).not.toBe(first![2]);
});

it("closes once the server takes the email, tells the order detail, and keeps its own close inside", async () => {
  const api = stubApi();
  const el = await mount(api);
  const told: CustomEvent<{ id: string }>[] = [];
  const closes: Event[] = [];
  const parent = el.parentElement!;
  const listenTold = (event: Event) => told.push(event as CustomEvent<{ id: string }>);
  const listenClose = (event: Event) => closes.push(event);
  parent.addEventListener("invoice-email-requested", listenTold);
  parent.addEventListener("wt-close", listenClose);
  onTestFinished(() => {
    parent.removeEventListener("invoice-email-requested", listenTold);
    parent.removeEventListener("wt-close", listenClose);
  });
  await open(el, "bill-3");
  await type(el, "ana@example.com");
  const closed = dialogClosed(dialog(el));
  await press(el);
  await closed;
  expect(dialog(el).open).toBe(false);
  expect(told).toHaveLength(1);
  expect(told[0]!.detail).toEqual({ id: "bill-3" });
  expect(told[0]!.bubbles && told[0]!.composed).toBe(true);
  expect(closes).toHaveLength(0);
});

it("opens empty again after a send, with no address kept from before", async () => {
  const el = await mount();
  await open(el);
  await type(el, "ana@example.com");
  const closed = dialogClosed(dialog(el));
  await press(el);
  await closed;
  await open(el);
  expect(input(el).value).toBe("");
  expect(send(el).disabled).toBe(true);
});

it("puts a refused address under the field with the bottom message, and leaves Send enabled", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    api.requestOrderEmailDelivery.mockRejectedValue({
      code: "management.request_invalid",
      params: { field: "recipient" },
    });
    const el = await mount(api);
    await open(el);
    await type(el, "ana@example.com");
    await press(el);
    await vi.waitFor(() => expect(input(el).error).toBe(t("receipts.invalid_email")));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(send(el).disabled).toBe(false);
    expect(dialog(el).open).toBe(true);
    await type(el, "ana@example.org");
    expect(input(el).error).toBe("");
    expect(actions(el).error).toBe("");
    cleanupWidgets();
  }
});

it.each([
  ["invoice_delivery.email_unavailable"],
  ["invoice_delivery.active"],
  ["connection.failed"],
  ["management.request_invalid"],
])("puts a %s refusal at the bottom, marks no field and leaves Send enabled", async (code) => {
  const api = stubApi();
  api.requestOrderEmailDelivery.mockRejectedValue({ code, params: { field: "requestKey" } });
  const el = await mount(api);
  await open(el);
  await type(el, "ana@example.com");
  await press(el);
  await vi.waitFor(() => expect(actions(el).error).toBe(codeMessage(code)));
  expect(input(el).error).toBe("");
  expect(send(el).disabled).toBe(false);
  expect(dialog(el).open).toBe(true);
});

it("sends one request while one is out, and holds the field and Cancel", async () => {
  let answer!: (value: Partial<OrderDeliveryAttempt>) => void;
  const api = stubApi();
  api.requestOrderEmailDelivery.mockImplementation(
    () => new Promise((resolve) => (answer = resolve)),
  );
  const el = await mount(api);
  await open(el);
  await type(el, "ana@example.com");
  await press(el);
  expect(send(el).loading).toBe(true);
  expect(input(el).disabled).toBe(true);
  expect(dialog(el).querySelector<WtButton>("[data-test=cancel-email]")!.disabled).toBe(true);
  expect(dialog(el).dismissible).toBe(false);
  await press(el);
  expect(api.requestOrderEmailDelivery).toHaveBeenCalledTimes(1);
  const closed = dialogClosed(dialog(el));
  answer({ id: "delivery-1" });
  await closed;
  expect(dialog(el).open).toBe(false);
});

it("drops the answer of a request sent before the dialog was dismissed and opened again", async () => {
  let refuse!: (error: unknown) => void;
  const api = stubApi();
  api.requestOrderEmailDelivery.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (refuse = reject)),
  );
  const el = await mount(api);
  await open(el, "bill-1");
  await type(el, "ana@example.com");
  await press(el);
  el.dismiss();
  await el.updateComplete;
  await open(el, "bill-2");
  refuse({ code: "invoice_delivery.active" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(actions(el).error).toBe("");
  expect(send(el).loading).toBe(false);
  expect(input(el).disabled).toBe(false);
});

it("keeps the typed address when asked to open again while it is open", async () => {
  const el = await mount();
  await open(el, "bill-1");
  await type(el, "ana@example.com");
  el.show("bill-2");
  await el.updateComplete;
  expect(input(el).value).toBe("ana@example.com");
  expect(send(el).disabled).toBe(false);
});

it("ignores typing while the address is being sent", async () => {
  const api = stubApi();
  api.requestOrderEmailDelivery.mockImplementation(() => new Promise(() => undefined));
  const el = await mount(api);
  await open(el);
  await type(el, "ana@example.com");
  await press(el);
  await type(el, "otra@example.com");
  expect(input(el).value).toBe("ana@example.com");
});

it("neither closes nor tells the order detail when a send from before a dismissal succeeds", async () => {
  let answer!: (value: Partial<OrderDeliveryAttempt>) => void;
  const api = stubApi();
  api.requestOrderEmailDelivery.mockImplementationOnce(
    () => new Promise((resolve) => (answer = resolve)),
  );
  const el = await mount(api);
  const told: Event[] = [];
  const parent = el.parentElement!;
  const listen = (event: Event) => told.push(event);
  parent.addEventListener("invoice-email-requested", listen);
  onTestFinished(() => parent.removeEventListener("invoice-email-requested", listen));
  await open(el, "bill-1");
  await type(el, "ana@example.com");
  await press(el);
  el.dismiss();
  await el.updateComplete;
  await open(el, "bill-2");
  await type(el, "otra@example.com");
  answer({ id: "delivery-1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(told).toHaveLength(0);
  expect(dialog(el).open).toBe(true);
  expect(input(el).value).toBe("otra@example.com");
});

it.each([1280, 390])(
  "at %ipx shows a long address whole, and keeps its width when a message appears",
  async (width) => {
    await page.viewport(width, 900);
    onTestFinished(() => page.viewport(1280, 900));
    const el = await mount();
    await open(el);
    const native = () => dialog(el).shadowRoot!.querySelector("dialog")!;
    await type(el, "ana.garcia@restaurantesgarcia.es");
    await input(el).updateComplete;
    const field = input(el).shadowRoot!.querySelector("input")!;
    expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth);
    const body = native().querySelector<HTMLElement>(".body")!;
    // A body wider than its box scrolls sideways and takes the dialog's first focus.
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    const before = native().getBoundingClientRect();
    expect(before.right).toBeLessThanOrEqual(width);
    await type(el, "ana@ejemplo");
    await press(el);
    expect(input(el).error).not.toBe("");
    await input(el).updateComplete;
    expect(native().getBoundingClientRect().width).toBe(before.width);
  },
);

it("keeps its width when the longest refusal shows at the bottom, in Spanish at 1280px", async () => {
  await page.viewport(1280, 900);
  onTestFinished(() => page.viewport(1280, 900));
  setLocale("es-ES");
  const api = stubApi();
  api.requestOrderEmailDelivery.mockRejectedValue({ code: "invoice_delivery.email_unavailable" });
  const el = await mount(api);
  await open(el);
  const native = () => dialog(el).shadowRoot!.querySelector("dialog")!;
  await type(el, "ana@example.com");
  const before = native().getBoundingClientRect().width;
  await press(el);
  await vi.waitFor(() =>
    expect(actions(el).error).toBe(codeMessage("invoice_delivery.email_unavailable")),
  );
  await actions(el).updateComplete;
  expect(native().getBoundingClientRect().width).toBe(before);
});

it("puts a failure that carries no code at the bottom", async () => {
  const api = stubApi();
  api.requestOrderEmailDelivery.mockRejectedValue(undefined);
  const el = await mount(api);
  await open(el);
  await type(el, "ana@example.com");
  await press(el);
  await vi.waitFor(() => expect(actions(el).error).toBe(codeMessage(codeOf(undefined))));
  expect(input(el).error).toBe("");
});
