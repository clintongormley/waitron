import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { deviceZonesFixture } from "../test/device-zones.js";
import { offer as menuOffer } from "../test/allergy-app-fixture.js";
import { productUnit } from "./widgets/product-name.js";
import {
  stubApi,
  till,
  offers,
  flush,
  emit,
  openTable,
  resetBillPayDrafts,
  billOf,
} from "../test/bill-pay-app.js";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { HeldOrder, TabLine, TabLines, TillProduct, ZoneOffers } from "./api/client.js";
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);
const product = (id: string, name: string, unitPrice: string): TillProduct => ({
  id,
  menuItemId: `mi-${id}`,
  menuId: "cat-default",
  name,
  pricingUnit: "each",
  unitPrice,
  vatClass: "general",
  category: null,
  allergens: null,
});

const tabLine = (over: Partial<TabLine> & Pick<TabLine, "id" | "lineNo">): TabLine => ({
  changesAfterSending: null,
  stationId: null,
  movable: false,
  productId: null,
  parentLineNo: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "1.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

function heldOrder(revision: number, drinkPrice = "2.50", drinkQuantity = "1.000"): HeldOrder {
  return {
    zoneId: null,
    kitchenNote: {
      scope: { workingOrderId: "wo-9" },
      note: null,
      revision: 0,
      ownerRevision: revision,
    },
    id: "wo-9",
    orderNumber: 12,
    label: "Table 4",
    revision,
    lines: [
      {
        workingOrderLineId: "l-1",
        productId: "snack",
        quantity: "1.000",
        product: product("snack", "Snack", "6.00"),
      },
      {
        workingOrderLineId: "l-2",
        productId: "drink",
        quantity: drinkQuantity,
        product: product("drink", "Drink", drinkPrice),
      },
    ],
  } as HeldOrder;
}

function listing(revision: number, drinkPrice = "2.50", drinkQuantity = "1.000"): TabLines {
  return {
    revision,
    lines: [
      tabLine({
        id: "l-1",
        lineNo: 1,
        name: "Snack",
        productId: "snack",
        unitPriceGross: "6.00",
        sentAt: "2026-09-30T09:00:00.000Z",
        firedAt: "2026-09-30T09:00:00.000Z",
        state: "queued",
      }),
      tabLine({
        id: "l-2",
        lineNo: 2,
        name: "Drink",
        productId: "drink",
        quantity: drinkQuantity,
        unitPriceGross: drinkPrice,
        ...(drinkPrice === "2.50" ? {} : { listUnitPriceGross: "2.50" }),
      }),
    ],
  };
}

const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
async function placeCounter(overrides: Record<string, unknown> = {}) {
  const available = heldOrder(4).lines.map((line) => {
    const item = line.product!;
    return {
      ...menuOffer(item.menuItemId!, item.name),
      menuId: item.menuId!,
      productId: item.id,
      unitPrice: item.unitPrice,
      grossPrice: item.unitPrice,
      unit: productUnit(item),
    };
  });
  const menu: ZoneOffers = {
    ...offers,
    context: { ...offers.context, serviceMode: "ticket_then_pay" },
    menus: servedMenus(
      [{ id: "cat-default", name: "Menu", isDefault: true, versionId: "v1" }],
      available,
    ),
    offers: available,
  };
  const api = stubApi({
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    getTill: vi.fn().mockResolvedValue({
      ...till,
      orderFlow: "ticket_then_pay",
      fullInvoices: true,
      capabilities: ["print-receipt", "take-orders"],
    }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(menu),
    listZoneOffers: vi.fn().mockResolvedValue(menu),
    retrieveWorkingOrder: vi.fn().mockResolvedValue(heldOrder(4)),
    getTabLines: vi.fn().mockResolvedValue(listing(4)),
    getInvoiceDeliveryOptions: vi.fn().mockResolvedValue({
      invoicePrinter: null,
      emailAvailable: false,
      emailNeedsReceiptContact: false,
    }),
    ...overrides,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!, "logged-in", {
    personId: "p1",
    displayName: "Alex",
    permissions: [],
  });
  await flush(el);
  emit(counter(el), "retrieve-order", { id: "wo-9" });
  await flush(el);
  return el;
}
const recipient = {
  taxId: "P123",
  identifierType: "passport",
  identifierCountryCode: "FR",
  legalName: "Guest",
  address: "1 Main Street",
  countryCode: "ES",
};
async function choice(el: TillApp, identity = recipient) {
  emit(counter(el), "choose-invoice");
  await flush(el);
  const form = el.shadowRoot!.querySelector("till-invoice-recipient-dialog");
  expect(form).not.toBeNull();
  emit(form!, "invoice-recipient-confirm", {
    invoiceType: "F1",
    recipient: identity,
    delivery: { medium: "receipt" },
  });
  await flush(el);
}
it.each(["identifierType", "identifierCountryCode", "unchanged"])(
  "checks %s on a retry after a lost placement reply",
  async (field) => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network reply lost"))
      .mockResolvedValue({ id: "wo-9", status: "placed" });
    const setOrderInvoiceChoice = vi.fn().mockResolvedValue({ revision: 5 });
    const el = await placeCounter({ placeOrder, setOrderInvoiceChoice });
    await choice(el);
    emit(counter(el), "place-order");
    await flush(el);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(setOrderInvoiceChoice).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("place.unconfirmed"));
    const next =
      field === "unchanged"
        ? recipient
        : { ...recipient, [field]: field === "identifierType" ? "residence-country-id" : "GB" };
    if (field !== "unchanged") await choice(el, next);
    emit(counter(el), "place-order");
    await flush(el);
    expect(setOrderInvoiceChoice).toHaveBeenCalledTimes(field === "unchanged" ? 1 : 2);
    if (field !== "unchanged")
      expect(setOrderInvoiceChoice.mock.calls[1]![1].recipient).toEqual(next);
    expect(placeOrder.mock.calls).toEqual([
      ["wo-9", null],
      ["wo-9", null],
    ]);
    expect(counter(el).stage).toBe("collect");
  },
);
it.each(["identifierType", "identifierCountryCode"])(
  "marks and recovers the bill recipient's %s refusal",
  async (field) => {
    const setOrderInvoiceChoice = vi
      .fn()
      .mockRejectedValue({ code: "invoice.recipient_invalid", field });
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({ ...till, fullInvoices: true }),
      setOrderInvoiceChoice,
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    order
      .shadowRoot!.querySelector<HTMLElement>(
        "[data-choose-bill-invoice]:not([data-table-menu] *)",
      )!
      .click();
    await flush(el);
    const form = el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
    emit(form.shadowRoot!.querySelector("[name=identifierType]")!, "wt-change", {
      value: "passport",
    });
    await form.updateComplete;
    emit(form, "invoice-recipient-confirm", { invoiceType: "F1", recipient });
    await flush(el);
    const control = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `[name=${field}]`,
    )!;
    expect(control.error).toBe(codeMessage("invoice.recipient_invalid"));
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    emit(control, "wt-change", {
      value: field === "identifierType" ? "residence-country-id" : "GB",
    });
    await flush(el);
    expect(control.error).toBe("");
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  },
);
it("reopens a retrieved full-invoice order on its saved customer and A4 delivery, and keeps them", async () => {
  const setOrderInvoiceChoice = vi.fn().mockResolvedValue({ revision: 5 });
  const el = await placeCounter({
    retrieveWorkingOrder: vi.fn().mockResolvedValue({
      ...heldOrder(4),
      invoiceType: "F1",
      recipient: { ...recipient, address: "Calle Mayor 1, 28013 Madrid, Madrid" },
      invoiceDelivery: { medium: "a4", pagePrinterId: "pp-office" },
    }),
    getInvoiceDeliveryOptions: vi.fn().mockResolvedValue({
      invoicePrinter: { id: "pp-office", name: "Office HP" },
      emailAvailable: false,
      emailNeedsReceiptContact: false,
    }),
    setOrderInvoiceChoice,
    placeOrder: vi.fn().mockResolvedValue({ id: "wo-9", status: "placed" }),
  });
  emit(counter(el), "choose-invoice");
  await flush(el);
  const form = el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  await form.updateComplete;
  const value = (name: string) =>
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!.value;
  expect([value("taxId"), value("legalName"), value("countryCode")]).toEqual([
    "P123",
    "Guest",
    "ES",
  ]);
  expect(value("delivery")).toBe("a4");

  const legalName =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=legalName]")!;
  await userEvent.fill(
    page.elementLocator(legalName.shadowRoot!.querySelector("input")!),
    "Guest Ltd",
  );
  await form.updateComplete;
  const save = form.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!;
  save.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull();
  emit(counter(el), "place-order");
  await flush(el);

  expect(setOrderInvoiceChoice).toHaveBeenCalledTimes(1);
  expect(setOrderInvoiceChoice.mock.calls[0]![1]).toMatchObject({
    invoiceType: "F1",
    recipient: { taxId: "P123", legalName: "Guest Ltd" },
    delivery: { medium: "a4", pagePrinterId: "pp-office" },
  });
});
it("offers no way back to a simplified invoice in the Counter's own invoice window", async () => {
  const el = await placeCounter({
    setOrderInvoiceChoice: vi.fn().mockResolvedValue({ revision: 5 }),
  });
  await choice(el);
  emit(counter(el), "choose-invoice");
  await flush(el);

  const form = el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  expect(form).not.toBeNull();
  expect(form.shadowRoot!.querySelector("[data-invoice-simplified]")).toBeNull();
});
it("opens a full-invoice bill's invoice window with its saved recipient filled in", async () => {
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({ ...till, fullInvoices: true }),
    getPartyBills: vi.fn().mockResolvedValue([
      billOf({
        invoiceType: "F1",
        recipient: { ...recipient, address: "Calle Mayor 1, 28013 Madrid, Madrid" },
      } as Partial<ReturnType<typeof billOf>>),
    ]),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  order
    .shadowRoot!.querySelector<HTMLElement>("[data-choose-bill-invoice]:not([data-table-menu] *)")!
    .click();
  await flush(el);
  const form = el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  await form.updateComplete;
  const value = (name: string) =>
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!.value;
  expect(
    [
      "identifierType",
      "identifierCountryCode",
      "taxId",
      "legalName",
      "address",
      "postalCode",
      "locality",
      "province",
      "countryCode",
    ].map(value),
  ).toEqual([
    "passport",
    "FR",
    "P123",
    "Guest",
    "Calle Mayor 1",
    "28013",
    "Madrid",
    "Madrid",
    "ES",
  ]);
});
const typedFrench = {
  taxId: "12345678Z",
  legalName: "Port SARL",
  address: "2 Rue du Port, Bâtiment B, Paris",
  countryCode: "FR",
};
async function openBillInvoice(el: TillApp, order: Element) {
  order
    .shadowRoot!.querySelector<HTMLElement>("[data-choose-bill-invoice]:not([data-table-menu] *)")!
    .click();
  await flush(el);
  const form = el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  await form.updateComplete;
  return form;
}
function fieldsOf(form: HTMLElementTagNameMap["till-invoice-recipient-dialog"]) {
  return Object.fromEntries(
    ["taxId", "legalName", "address", "postalCode", "locality", "province", "countryCode"].map(
      (name) => [
        name,
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!.value,
      ],
    ),
  );
}
async function type(
  form: HTMLElementTagNameMap["till-invoice-recipient-dialog"],
  name: string,
  value: string,
) {
  const input = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=${name}]`,
  )!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
it("reopens a bill's invoice window with the address fields as they were typed on this till", async () => {
  const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
  const setOrderInvoiceChoice = vi.fn().mockImplementation(async () => {
    getPartyBills.mockResolvedValue([
      billOf({ revision: 1, invoiceType: "F1", recipient: typedFrench }),
    ]);
    return { revision: 1 };
  });
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({ ...till, fullInvoices: true }),
    getPartyBills,
    setOrderInvoiceChoice,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  let form = await openBillInvoice(el, order);
  emit(form.shadowRoot!.querySelector("[name=countryCode]")!, "wt-change", { value: "FR" });
  await type(form, "taxId", "12345678Z");
  await type(form, "legalName", "Port SARL");
  await type(form, "address", "2 Rue du Port, Bâtiment B");
  await type(form, "locality", "Paris");
  form.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
  await flush(el);
  expect(setOrderInvoiceChoice).toHaveBeenCalledWith("wo-4", {
    expectedEdit: { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null },
    revision: 0,
    invoiceType: "F1",
    recipient: typedFrench,
  });
  expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull();

  form = await openBillInvoice(el, order);
  expect(fieldsOf(form)).toEqual({
    taxId: "12345678Z",
    legalName: "Port SARL",
    address: "2 Rue du Port, Bâtiment B",
    postalCode: "",
    locality: "Paris",
    province: "",
    countryCode: "FR",
  });
});
it("shows a bill's saved recipient again after an edit is cancelled, sending nothing", async () => {
  const setOrderInvoiceChoice = vi.fn().mockResolvedValue({ revision: 1 });
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({ ...till, fullInvoices: true }),
    getPartyBills: vi.fn().mockResolvedValue([
      billOf({
        invoiceType: "F1",
        recipient: { ...recipient, address: "1 Main Street, Paris" },
      } as Partial<ReturnType<typeof billOf>>),
    ]),
    setOrderInvoiceChoice,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  const saved = {
    taxId: "P123",
    legalName: "Guest",
    address: "1 Main Street",
    postalCode: "",
    locality: "Paris",
    province: "",
    countryCode: "ES",
  };
  let form = await openBillInvoice(el, order);
  expect(fieldsOf(form)).toEqual(saved);
  await type(form, "legalName", "Someone Else");
  form.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull(),
  );

  form = await openBillInvoice(el, order);
  expect(fieldsOf(form)).toEqual(saved);
  expect(setOrderInvoiceChoice).not.toHaveBeenCalled();
});
