import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  allergyView,
  flush,
  menu,
  mountApp,
  openTable,
  resetAllergyFixture,
} from "../test/allergy-app-fixture.js";
import { setMenuCopyOf } from "@waitron/shared";
import {
  emit,
  flush as flushCounter,
  lock,
  offers,
  resetBillPayDrafts,
  stubApi as counterApi,
} from "../test/bill-pay-app.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import type { TillApp } from "./till-app.js";
import { daily, bill, special } from "../test/set-menu-widgets.js";
import { setMenuProduct } from "./widgets/product-pick.js";
import { showView } from "./screens/till-table-order-screen.test-helpers.js";
import { cleanupWidgets, mountWidget, partyBillOf } from "./widgets/test-helpers.js";

beforeEach(resetAllergyFixture);
afterEach(cleanupWidgets);

it("applies a saved count and uses its party revision for the next tap", async () => {
  const zone = menu("lunch");
  zone.setMenus = [{ ...daily, versionIds: ["lunch"], orderable: true, newestOnSale: true }];
  const empty = { copies: [], setMenus: [], dishes: [], recorded: {} };
  let state = empty as typeof bill;
  const setSetMenuCount = vi.fn(async (_billId: string, _menuId: string, count: number) => {
    state = { ...bill, dishes: [], setMenus: bill.setMenus.slice(0, count) };
    return { setMenus: state, partyRevision: 3 + count };
  });
  const { el } = await mountApp({
    listZoneOffers: vi.fn(async () => zone),
    getPartyBills: vi.fn(async () => [
      {
        ...partyBillOf("v1", "wo-4", 1),
        setMenus: state,
        setMenuCopies: state.setMenus.length === 0 ? [] : [daily],
      },
    ]),
    setSetMenuCount,
  });
  const screen = await openTable(el);
  await showView(screen, "order", { ifShown: true, scripted: true });
  const counts = screen.shadowRoot!.querySelector("till-set-menu-counts")!;
  expect(counts).not.toBeNull();
  await counts.updateComplete;
  const stepper = counts.shadowRoot!.querySelector("wt-number-stepper")!;
  const plus = stepper.shadowRoot!.querySelector('[data-step="1"]')!;

  expect(stepper.value).toBe("0");
  await userEvent.click(plus);
  await vi.waitFor(() => {
    expect(stepper.value).toBe("1");
    expect(stepper.disabled).toBe(false);
  });
  await userEvent.click(plus);
  await vi.waitFor(() => expect(stepper.value).toBe("2"));
  expect(setSetMenuCount.mock.calls.map((call) => call.slice(0, 4))).toEqual([
    ["wo-4", daily.menuId, 1, 3],
    ["wo-4", daily.menuId, 2, 4],
  ]);
});

it("opens the same choices for the exact drafted dish Send refuses", async () => {
  const sirloin = daily.offers[1]!;
  const variant = {
    ...sirloin,
    id: "rare",
    name: "Rare",
    menuPrice: null,
    pricingUnit: "each" as const,
  };
  const offer = { ...sirloin, variants: [variant], variantCountsAs: { rare: "main" } };
  const withVariant = { ...daily, offers: [offer] };
  const zone = menu("lunch");
  zone.menus[0]!.structure.members.push({
    kind: "set_menu",
    menuId: daily.menuId,
    name: daily.name,
  });
  zone.setMenus = [withVariant, special].map((copy) => ({
    ...copy,
    versionIds: ["lunch"],
    orderable: true,
    newestOnSale: true,
  }));
  const submitDraft = vi.fn(async (_party, _draft, request) => {
    const ids = request.groups.flatMap((group: { lineIds: string[] }) => group.lineIds);
    expect(ids).toHaveLength(2);
    throw {
      code: "set_menu.no_place",
      status: 409,
      dishName: "Sirloin",
      draftLineId: ids[1],
    };
  });
  const { el } = await mountApp({
    listZoneOffers: vi.fn(async () => zone),
    getPartyBills: vi.fn(async () => [
      {
        ...partyBillOf("v1", "wo-4", 1),
        setMenus: bill,
        setMenuCopies: [withVariant, special],
      },
    ]),
    previewPartyAllergy: vi.fn(async (_partyId, target) => allergyView("none", target)),
    submitDraft,
  });
  const screen = await openTable(el);
  const product = setMenuProduct({
    offer,
    setMenuId: daily.menuId,
    versionId: "lunch",
  });
  const selected = { ...product, variantId: "rare", variantName: "Rare" };
  for (const note of ["First", "Second"])
    screen.draftStore!.addProduct(selected, "1", { note, setMenu: { id: daily.menuId } });
  const openPlace = vi.spyOn(screen, "openSetMenuPlace");
  await showView(screen, "order", { ifShown: true, scripted: true });
  await flush(el);
  const send = screen.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!;
  expect(send).not.toBeNull();
  await userEvent.click(send);
  await vi.waitFor(() => expect(submitDraft).toHaveBeenCalled());
  const browser = screen.shadowRoot!.querySelector("till-menu-browser")!;
  await vi.waitFor(() => {
    const modal =
      browser.shadowRoot!.querySelector<import("@waitron/ui").WtDialog>("[data-set-menu-place]");
    expect(modal?.heading).toContain("No place for Sirloin");
    expect(modal?.shadowRoot!.querySelector("dialog")?.open).toBe(true);
  });
  await userEvent.click(page.elementLocator(browser).getByRole("button", { name: "Cancel" }));
  expect(openPlace).toHaveBeenCalledExactlyOnceWith(screen.draftStore!.lines[1]);
  expect(screen.draftStore!.lines.map((line) => line.product.name)).toEqual(["Sirloin", "Sirloin"]);
});

it("saves the counter's first set-menu count and keeps a drafted dish until Park", async () => {
  resetBillPayDrafts();
  const saved = {
    copies: [setMenuCopyOf(daily, "v1")],
    recorded: { [daily.menuId]: "v1" },
    setMenus: [bill.setMenus[0]!],
    dishes: [],
  };
  const parkOrder = vi.fn(async ({ id }: { id: string }) => ({
    id,
    orderNumber: 10,
    revision: 7,
    setMenus: saved,
  }));
  const zone = {
    ...offers,
    context: { ...offers.context, dining: { policy: "till_choice", startsAs: "eat_in" } },
    setMenus: [{ ...daily, versionIds: ["v1"], orderable: true, newestOnSale: true }],
  };
  const updateWorkingOrder = vi.fn(async () => ({ revision: 8 }));
  const retrieveWorkingOrder = vi.fn(async (id: string) => ({
    id,
    orderNumber: 10,
    revision: 8,
    zoneId: offers.context.zoneId,
    label: null,
    expectedEdit: null,
    invoiceType: "F2",
    dining: "takeaway",
    diningChoice: "locked",
    kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
    lines: [],
    setMenus: saved,
    setMenuCopies: [daily],
  }));
  const switchDining = vi.fn().mockRejectedValue({ code: "set_menu.not_seated" });
  const api = counterApi({
    switchDining,
    listDefaultZoneOffers: vi.fn(async () => zone),
    listZoneOffers: vi.fn(async () => zone),
    parkOrder,
    updateWorkingOrder,
    retrieveWorkingOrder,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flushCounter(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flushCounter(el);
  const counter = el.shadowRoot!.querySelector("till-counter-screen")!;
  counter.store.addProduct(
    {
      id: "cola",
      menuItemId: "cola-offer",
      menuId: "cat-default",
      name: "Cola",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
      category: null,
      allergens: null,
    },
    "1",
  );
  await userEvent.click(page.elementLocator(counter).getByText("Take away", { exact: true }));
  await vi.waitFor(() => expect(counter.store.dining).toBe("takeaway"));
  const counts = counter.shadowRoot!.querySelector("till-set-menu-counts");
  expect(counts).not.toBeNull();
  await userEvent.click(
    page.elementLocator(counts!).getByRole("button", { name: "Increase Daily menu" }),
  );
  await vi.waitFor(() => {
    expect(counter.store.revision).toBe(7);
    expect(counter.store.persisted).toBe(true);
    expect(parkOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: counter.store.id,
        zoneId: offers.context.zoneId,
        dining: "takeaway",
        lines: [],
        firstSetMenuId: daily.menuId,
      }),
    );
  });
  expect(counter.store.dirty).toBe(true);
  expect(counter.store.lines.map((line) => line.product.name)).toEqual(["Cola"]);
  expect(updateWorkingOrder).not.toHaveBeenCalled();
  const dining = counter.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-segmented-control"]>(
    "wt-segmented-control.dining",
  )!;
  expect(dining).not.toBeNull();
  await userEvent.click(page.elementLocator(dining).getByText("Eat here", { exact: true }));
  await vi.waitFor(() => {
    expect(switchDining).toHaveBeenCalledExactlyOnceWith(counter.store.id, "eat_in", 7, null);
    expect(el.shadowRoot!.textContent).toContain("Set menus are available at a seated table");
    expect(dining.value).toBe("takeaway");
  });

  const id = counter.store.id;
  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  await userEvent.click(
    page.elementLocator(tender).getByRole("button", { name: "Park", exact: true }),
  );
  await vi.waitFor(() => expect(tender.shadowRoot!.querySelector(".park")).not.toBeNull());
  await userEvent.click(tender.shadowRoot!.querySelector(".park")!);
  await vi.waitFor(() => expect(counter.store.id).not.toBe(id));
  expect(parkOrder).toHaveBeenCalledTimes(1);
  expect(updateWorkingOrder).toHaveBeenCalledExactlyOnceWith(
    id,
    expect.objectContaining({
      revision: 7,
      dining: "takeaway",
      lines: [expect.objectContaining({ menuItemId: "cola-offer", quantity: "1" })],
    }),
  );
});

it("parks a set-menu-only takeaway and orders from its original folder after republishing", async () => {
  resetBillPayDrafts();
  const state = {
    copies: [setMenuCopyOf(daily, "v1")],
    recorded: { [daily.menuId]: "v1" },
    setMenus: [bill.setMenus[0]!],
    dishes: [],
  };
  const republished = { ...daily, key: "new-copy", terms: { ...daily.terms, price: "15.00" } };
  const zone = {
    ...offers,
    context: { ...offers.context, dining: { policy: "till_choice", startsAs: "eat_in" } },
    setMenus: [{ ...republished, versionIds: ["v2"], orderable: true, newestOnSale: true }],
  };
  const retrieveWorkingOrder = vi.fn(async (id: string) => ({
    id,
    orderNumber: 10,
    revision: 9,
    zoneId: offers.context.zoneId,
    label: null,
    expectedEdit: null,
    invoiceType: "F2",
    dining: "takeaway",
    diningChoice: "locked",
    kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
    lines: [],
    setMenus: state,
    setMenuCopies: [daily],
  }));
  const updateWorkingOrder = vi
    .fn()
    .mockRejectedValue({ code: "set_menu.no_place", dishName: "Sirloin" });
  const otherZone = "other-counter";
  const api = counterApi({
    getDeviceZones: vi.fn(async () => deviceZonesFixture([zone.context.zoneId, otherZone])),
    listDefaultZoneOffers: vi.fn(async () => zone),
    listZoneOffers: vi.fn(async (id: string) => ({
      ...zone,
      context: { ...zone.context, zoneId: id },
    })),
    retrieveWorkingOrder,
    updateWorkingOrder,
    getTabLines: vi.fn(async () => ({ lines: [], revision: 9 })),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flushCounter(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flushCounter(el);
  const counter = el.shadowRoot!.querySelector("till-counter-screen")!;
  expect(counter.shadowRoot!.querySelector("till-set-menu-counts")).toBeNull();

  async function reopen() {
    emit(counter, "retrieve-order", { id: "counter-takeaway" });
    await vi.waitFor(() => expect(counter.store.id).toBe("counter-takeaway"));
    await flushCounter(el);
  }

  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  async function park() {
    await userEvent.click(
      page.elementLocator(tender).getByRole("button", { name: "Park", exact: true }),
    );
    await vi.waitFor(() => expect(tender.shadowRoot!.querySelector(".park")).not.toBeNull());
    await userEvent.click(tender.shadowRoot!.querySelector(".park")!);
  }

  await reopen();
  const total = counter.shadowRoot!.querySelector("till-total")!;
  expect(total.shadowRoot!.textContent).toContain("€14.00");
  emit(counter, "counter-zone-selected", { zoneId: otherZone });
  await flushCounter(el);
  expect(counter.selectedServiceZoneId).toBe(zone.context.zoneId);
  expect(el.shadowRoot!.textContent).toContain("Clear the basket before changing service area");
  await park();
  await vi.waitFor(() => expect(counter.store.id).not.toBe("counter-takeaway"));
  expect(updateWorkingOrder).not.toHaveBeenCalled();

  await reopen();
  const browser = counter.shadowRoot!.querySelector("till-menu-browser")!;
  await userEvent.click(page.elementLocator(browser).getByRole("button", { name: "Set menus" }));
  await userEvent.click(page.elementLocator(browser).getByRole("button", { name: /Daily menu/ }));
  const folder = browser.shadowRoot!.querySelector("till-set-menu-folder")!;
  expect(folder.copy?.terms.price).toBe("14.00");
  await userEvent.click(page.elementLocator(folder).getByRole("button", { name: /Sirloin/ }));
  expect(total.shadowRoot!.textContent).toContain("€19.00");
  await park();

  await vi.waitFor(() => {
    expect(updateWorkingOrder).toHaveBeenCalledExactlyOnceWith(
      "counter-takeaway",
      expect.objectContaining({
        revision: 9,
        lines: [
          expect.objectContaining({
            menuItemId: "sirloin",
            menuVersionId: "v1",
            setMenuId: daily.menuId,
            quantity: "1",
          }),
        ],
      }),
    );
    expect(el.shadowRoot!.textContent).toContain("Sirloin");
  });
  expect(counter.store.lines.map((line) => line.product.name)).toEqual(["Sirloin"]);
});

it("renders a reopened set-menu dish from the recorded offer and saved price", async () => {
  resetBillPayDrafts();
  const offer = daily.offers.find(({ id }) => id === "sirloin")!;
  const source = setMenuProduct({ offer, setMenuId: daily.menuId, versionId: "v1" });
  const id = "reopened-takeaway";
  const api = counterApi({
    getTabLines: vi.fn(async () => ({ lines: [], revision: 6 })),
    retrieveWorkingOrder: vi.fn(async () => ({
      id,
      orderNumber: 10,
      revision: 6,
      zoneId: offers.context.zoneId,
      label: null,
      expectedEdit: null,
      invoiceType: "F2",
      dining: "takeaway",
      diningChoice: "locked",
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      setMenus: {
        copies: [setMenuCopyOf(daily, "v1")],
        recorded: { [daily.menuId]: "v1" },
        setMenus: [bill.setMenus[0]!],
        dishes: [bill.dishes[0]!],
      },
      setMenuCopies: [daily],
      lines: [
        {
          workingOrderLineId: bill.dishes[0]!.lineId,
          menuItemId: offer.id,
          menuVersionId: "v1",
          setMenuId: daily.menuId,
          quantity: "1.000",
          product: {
            ...source,
            unit: { id: "each", name: { en: "each" }, precision: 0, hardwareUnit: null },
          },
        },
      ],
    })),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flushCounter(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flushCounter(el);
  const counter = el.shadowRoot!.querySelector("till-counter-screen")!;
  emit(counter, "retrieve-order", { id });
  await vi.waitFor(() => expect(counter.store.id).toBe(id));
  await expect
    .element(page.elementLocator(counter).getByText("Sirloin", { exact: true }))
    .toBeVisible();
  expect(counter.shadowRoot!.querySelector("till-total")!.shadowRoot!.textContent).toContain(
    "€19.00",
  );
});
