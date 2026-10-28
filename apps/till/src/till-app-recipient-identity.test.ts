import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
} from "../test/bill-pay-app.js";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type {
  HeldOrder,
  TabLine,
  TabLines,
  TillProduct,
  ZoneOfferCatalogue,
} from "./api/client.js";
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);
const product = (id: string, name: string, unitPrice: string): TillProduct => ({
  id,
  menuItemId: `mi-${id}`,
  catalogueId: "cat-default",
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
      menuId: item.catalogueId!,
      productId: item.id,
      unitPrice: item.unitPrice,
      grossPrice: item.unitPrice,
      unit: productUnit(item),
    };
  });
  const catalogue: ZoneOfferCatalogue = {
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
    listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
    listZoneOffers: vi.fn().mockResolvedValue(catalogue),
    retrieveWorkingOrder: vi.fn().mockResolvedValue(heldOrder(4)),
    getTabLines: vi.fn().mockResolvedValue(listing(4)),
    getInvoiceDeliveryOptions: vi
      .fn()
      .mockResolvedValue({ invoicePrinter: null, emailAvailable: false }),
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
    expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("sale.unconfirmed"));
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
    order.shadowRoot!.querySelector<HTMLElement>("[data-choose-bill-invoice]")!.click();
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
