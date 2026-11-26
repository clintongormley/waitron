import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { bill, daily, seaBass, special } from "../../test/set-menu-widgets.js";
import type { TabLine } from "../api/kitchen-api.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";
import type { AdjustDetail } from "./till-table-order-screen.js";
import { mount, showView } from "./till-table-order-screen.test-helpers.js";

afterEach(cleanupWidgets);

it("shows the bill's set menus above the draft with no count or Cancel, keeping the set menu's included price", async () => {
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
  expect(pane.querySelector("till-set-menu-counts")).toBeNull();
  const help = pane.querySelector(".help-anchor > wt-help-tooltip")!;
  expect(help.getAttribute("aria-label")).toContain("Set menus");
  const summary = pane.querySelector("till-set-menu-summary")!;
  await summary.updateComplete;
  expect(summary.shadowRoot!.textContent).toContain("3 set menus");
  await userEvent.click(summary.shadowRoot!.querySelector("summary")!);
  const buttons = Array.from(summary.shadowRoot!.querySelectorAll("wt-button"), (button) =>
    button.textContent!.trim(),
  );
  expect(buttons).not.toContain("Cancel");
  expect(buttons).not.toContain("Move");
  const basket = [...pane.querySelectorAll("till-basket")].find((item) =>
    item.lineIndexes?.includes(0),
  )!;
  await basket.updateComplete;
  expect(basket.shadowRoot!.textContent).toMatch(/Sea bass\s*menu/);
  expect(changeSetMenu).not.toHaveBeenCalled();
});

const dailyLine = (id: string, lineNo: number): TabLine => ({
  changesAfterSending: "held-or-waiting",
  stationId: null,
  movable: false,
  id,
  groupId: null,
  lineNo,
  productId: null,
  name: "Daily menu",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "14.00",
  servedAt: null,
  courseId: null,
  sentAt: "2026-11-19T10:00:00.000Z",
  firedAt: null,
  state: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
});

async function setMenuSummary(status: "open" | "placed") {
  const { el } = await mount({
    party: switcherParty,
    bills: [partyBill("wo-4", 1, "47.00", { setMenus: bill, status })],
    lines: [dailyLine("daily-1", 1), dailyLine("daily-2", 2)],
    setMenuCopies: [daily, special].map((copy) => ({ copy, versionId: "lunch" })),
    changeSetMenu: vi.fn(async () => undefined),
  });
  await showView(el, "order", { ifShown: true });
  const summary = el
    .shadowRoot!.querySelector("[data-draft-pane]")!
    .querySelector("till-set-menu-summary")!;
  await summary.updateComplete;
  const seen: AdjustDetail[] = [];
  el.addEventListener("adjust", (event) => seen.push((event as CustomEvent<AdjustDetail>).detail));
  return { summary, seen };
}

it("comps one set menu through the same window a dish's Comp opens", async () => {
  const { summary, seen } = await setMenuSummary("open");
  await userEvent.click(summary.shadowRoot!.querySelector("summary")!);
  const comps = summary.shadowRoot!.querySelectorAll<HTMLElement>("[data-comp-menu]");
  await userEvent.click(comps[1]!);
  expect(seen.map(({ kind, target }) => [kind, target.lineId, target.name, target.total])).toEqual([
    ["comp", "daily-2", "Daily menu 2", "14.00"],
  ]);
});

it("offers no set-menu Comp when the bill can no longer be adjusted", async () => {
  const { summary } = await setMenuSummary("placed");
  await userEvent.click(summary.shadowRoot!.querySelector("summary")!);
  expect(summary.shadowRoot!.querySelector("article")).not.toBeNull();
  expect(summary.shadowRoot!.querySelector("[data-comp-menu]")).toBeNull();
});
