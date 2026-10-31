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

const states: [string, PartyBill[], string | undefined, TableParty][] = [
  ["one bill", [partyBill("wo-1", 1, "38.50")], "wo-1", switcherParty],
  [
    "three bills, a paid row and an editor row",
    [
      partyBill("wo-1", 1, "67.00"),
      partyBill("wo-2", 2, "54.00", { billName: "Clint" }),
      partyBill("wo-3", 3, "0.00", { status: "settled", total: "12.00" }),
    ],
    "wo-2",
    withEditor,
  ],
  ["no bill shown", [], undefined, switcherParty],
];

describe.each(["light", "dark"] as const)("the bill switcher in the %s theme", (theme) => {
  describe.each(states)("%s", (_name, bills, orderId, party) => {
    it.each(["closed", "open"] as const)("is accessible %s", async (state) => {
      const { el } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products: [], lines: [], orderId, party, bills },
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
