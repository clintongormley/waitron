import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { bill, daily, seaBass, special } from "../../test/set-menu-widgets.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";
import { mount, showView } from "./till-table-order-screen.test-helpers.js";

afterEach(cleanupWidgets);

it("shows bill counts above the draft, keeps the set menu's included price and saves a count tap", async () => {
  const draft = new WorkingOrderStore();
  draft.appendLines([seaBass]);
  const changeSetMenu = vi.fn(async () => undefined);
  const { el } = await mount({
    party: switcherParty,
    bills: [partyBill("wo-4", 1, "47.00", { setMenus: bill })],
    draftStore: draft,
    setMenuCopies: [daily, special].map((copy) => ({ copy, versionId: "lunch" })),
    changeSetMenu,
  });
  await showView(el, "order", { ifShown: true });
  const pane = el.shadowRoot!.querySelector("[data-draft-pane]")!;
  const counts = pane.querySelector("till-set-menu-counts")!;
  await counts.updateComplete;
  const stepper = counts.shadowRoot!.querySelector("wt-number-stepper")!;
  expect([stepper.label, stepper.value]).toEqual([daily.name, "2"]);
  const summary = pane.querySelector("till-set-menu-summary")!;
  await summary.updateComplete;
  expect(summary.shadowRoot!.textContent).toContain("3 set menus");
  const basket = [...pane.querySelectorAll("till-basket")].find((item) =>
    item.lineIndexes?.includes(0),
  )!;
  await basket.updateComplete;
  expect(basket.shadowRoot!.textContent).toMatch(/Sea bass\s*menu/);

  await userEvent.click(stepper.shadowRoot!.querySelector('[data-step="1"]')!);
  expect(changeSetMenu).toHaveBeenCalledExactlyOnceWith({ menuId: daily.menuId, count: 3 });
});
