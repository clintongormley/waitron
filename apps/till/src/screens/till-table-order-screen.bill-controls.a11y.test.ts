import { afterEach, describe, expect, it } from "vitest";
import type { WtRowActions } from "@waitron/ui/src/components/wt-row-actions.js";
import { setLocale } from "../i18n/t.js";
import type { PartyBill, TableParty } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const withEditor: TableParty = {
  ...switcherParty,
  unsentDrafts: [
    {
      billId: "wo-2",
      billNumber: 2,
      ownerId: "p-ana",
      ownerName: "Ana",
      lineCount: 3,
      savedAt: "2026-10-31T10:00:00.000Z",
    },
  ],
};

const states: [string, PartyBill[], string | undefined, TableParty, boolean][] = [
  ["one bill", [partyBill("wo-1", 1, "38.50")], "wo-1", switcherParty, false],
  ["one bill, + New bill out", [partyBill("wo-1", 1, "38.50")], "wo-1", switcherParty, true],
  [
    "three bills, a paid row and an editor row",
    [
      partyBill("wo-1", 1, "67.00"),
      partyBill("wo-2", 2, "54.00", { billName: "Clint" }),
      partyBill("wo-3", 3, "0.00", { status: "settled", total: "12.00" }),
    ],
    "wo-2",
    withEditor,
    false,
  ],
  ["no bill shown", [], undefined, switcherParty, false],
];

describe.each(["light", "dark"] as const)("the bill switcher in the %s theme", (theme) => {
  describe.each(states)("%s", (_name, bills, orderId, party, newBillBusy) => {
    it.each(["closed", "open"] as const)("is accessible %s", async (state) => {
      const { el } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products: [], lines: [], orderId, party, bills, newBillBusy },
        theme,
      );
      const switcher = el.shadowRoot!.querySelector<WtRowActions>("[data-bill-switcher]")!;
      if (state === "open") {
        switcher.show();
        await switcher.updateComplete;
        expect(
          switcher.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open"),
        ).toBe(true);
      }
      await expectNoA11yViolations(switcher);
    });
  });
});

const menuStates: [string, PartyBill[], string | undefined, TableParty | null][] = [
  [
    "an open owing bill at two tables, with Full invoice",
    [partyBill("wo-1", 1, "10.00"), partyBill("wo-2", 2, "54.00", { billName: "Clint" })],
    "wo-2",
    { ...switcherParty, tableIds: ["t4", "t5"] },
  ],
  [
    "a paid bill with a receipt",
    [partyBill("wo-1", 1, "0.00", { status: "settled", receiptAvailable: true })],
    "wo-1",
    switcherParty,
  ],
  ["no bill shown", [], undefined, switcherParty],
  ["no party", [], "wo-9", null],
];

describe.each(["light", "dark"] as const)("A803 single menu: the ⋮ in the %s theme", (theme) => {
  describe.each(menuStates)("%s", (_name, bills, orderId, party) => {
    it.each(["closed", "open"] as const)("is accessible %s", async (state) => {
      const line = {
        changesAfterSending: null,
        id: "line-1",
        name: "Beer",
        lineNo: 1,
        productId: "beer",
        quantity: "1.000",
        unitPrecision: 0,
        unitPriceGross: "3.00",
        stationId: null,
        movable: false,
        groupId: null,
        servedAt: null,
        courseId: null,
        sentAt: null,
        firedAt: null,
        state: null,
        note: null,
        listId: null,
        menuItemId: null,
        parentProductId: null,
      };
      const { el } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products: [], lines: [line], orderId, party, bills, fullInvoices: true },
        theme,
      );
      const menu = el.shadowRoot!.querySelector<WtRowActions>("[data-table-menu]")!;
      if (state === "open") {
        menu.show();
        await menu.updateComplete;
        expect(
          menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open"),
        ).toBe(true);
        expect(menu.querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
      }
      await expectNoA11yViolations(menu);
    });
  });
});
