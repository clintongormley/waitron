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
import { daily, bill, special } from "../test/set-menu-widgets.js";
import { setMenuProduct } from "./widgets/product-pick.js";
import { showView } from "./screens/till-table-order-screen.test-helpers.js";
import { cleanupWidgets, partyBillOf } from "./widgets/test-helpers.js";

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

it("opens the same choices when Send refuses a drafted set-menu dish", async () => {
  const zone = menu("lunch");
  zone.menus[0]!.structure.members.push({
    kind: "set_menu",
    menuId: daily.menuId,
    name: daily.name,
  });
  zone.setMenus = [daily, special].map((copy) => ({
    ...copy,
    versionIds: ["lunch"],
    orderable: true,
    newestOnSale: true,
  }));
  const submitDraft = vi.fn().mockRejectedValue({
    code: "set_menu.no_place",
    status: 409,
    dishName: "Sirloin",
  });
  const { el } = await mountApp({
    listZoneOffers: vi.fn(async () => zone),
    getPartyBills: vi.fn(async () => [
      {
        ...partyBillOf("v1", "wo-4", 1),
        setMenus: bill,
        setMenuCopies: [daily, special],
      },
    ]),
    previewPartyAllergy: vi.fn(async (_partyId, target) => allergyView("none", target)),
    submitDraft,
  });
  const screen = await openTable(el);
  const product = setMenuProduct({
    offer: daily.offers[1]!,
    setMenuId: daily.menuId,
    versionId: "lunch",
  });
  screen.draftStore!.addProduct(product, "1", { setMenu: { id: daily.menuId } });
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
  expect(screen.draftStore!.lines.map((line) => line.product.name)).toEqual(["Sirloin"]);
});
