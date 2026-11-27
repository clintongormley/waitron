import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui/src/components/wt-icon.js";
import { DROPDOWN_ICONS } from "@waitron/ui/src/components/wt-combobox.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  billOptions,
  billRow,
  findBillApi,
  json,
  listPage,
  resolvedDates,
  transactionRow,
} from "../../test/find-bill-fixtures.js";
import type { WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import type { TillFindBillScreen } from "./till-find-bill-screen.js";
import "./till-find-bill-screen.js";
registerIcons(DROPDOWN_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
  sessionStorage.removeItem("waitron.find-bill.transactions");
});
describe.each(["light", "dark"] as const)("Find a bill %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "unpaid bills, counter orders, sales, empty, error and phone filters in %s",
    async (language) => {
      setLocale(language);
      await page.viewport(390, 844);
      expect(window.innerWidth).toBe(390);
      let state = "rows";
      const { api } = findBillApi(async (url) =>
        url.pathname.endsWith("options")
          ? json(billOptions)
          : state === "error"
            ? json({ error: { code: "server.internal" } }, 500)
            : json(
                url.pathname === "/api/bills"
                  ? listPage(
                      [
                        billRow({
                          label: "A very long group name that must not widen the phone page",
                        }),
                        billRow({
                          workingOrderId: "bill-owed",
                          partyId: "party-1",
                          departedAt: "2026-10-15T21:30:00Z",
                        }),
                      ],
                      2,
                    )
                  : {
                      ...listPage(
                        state === "empty" ? [] : [transactionRow()],
                        state === "empty" ? 0 : 125,
                      ),
                      dates: resolvedDates,
                    },
              ),
      );
      const { el, host } = await mountWidget<TillFindBillScreen>(
        "till-find-bill-screen",
        { api, active: true },
        theme,
      );
      const grid = () => el.shadowRoot!.querySelector<WtDataTable<unknown>>("wt-data-table")!;
      await vi.waitFor(() => expect(grid()?.rows).toHaveLength(1));
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector('[data-owed] [data-bill="bill-owed"]')).not.toBeNull(),
      );
      expect(
        el.shadowRoot!.querySelector('[data-counter-orders] [data-bill="bill-1"]'),
      ).not.toBeNull();
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      await expectNoA11yViolations(host);
      await userEvent.click(
        grid().shadowRoot!.querySelector<HTMLElement>(
          `[aria-label="${language === "en-GB" ? "Customise columns" : "Personalizar columnas"}"]`,
        )!,
      );
      await vi.waitFor(() =>
        expect(
          grid().shadowRoot!.querySelector("wt-dialog")?.shadowRoot?.querySelector("dialog")?.open,
        ).toBe(true),
      );
      await expectNoA11yViolations(host);
      await userEvent.keyboard("{Escape}");
      const transactions = grid();
      expect(transactions.shadowRoot!.textContent).toContain("0091");
      await userEvent.click(
        transactions.shadowRoot!.querySelector<HTMLElement>(
          `[aria-label="${language === "en-GB" ? "Filters 1" : "Filtros 1"}"]`,
        )!,
      );
      await expectNoA11yViolations(host);
      transactions.querySelector('[name="dates"]')!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "custom" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;
      await vi.waitFor(() =>
        expect(transactions.querySelector('wt-input[name="from"]')).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
      const from = transactions
        .querySelector('wt-input[name="from"]')!
        .shadowRoot!.querySelector("input")!;
      from.focus();
      await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
      expect(document.activeElement).toBe(el);
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() =>
        expect(transactions.shadowRoot!.querySelector('[aria-expanded="true"]')).toBeNull(),
      );
      transactions.querySelector('[name="dates"]')!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "today" },
          bubbles: true,
          composed: true,
        }),
      );
      await vi.waitFor(() => expect(grid().rows).toHaveLength(1));
      state = "empty";
      grid().chooseFilter("method", ["cash"]);
      await vi.waitFor(() =>
        expect(grid().emptyMessage && grid().rows.length === 0 && !grid().loading).toBe(true),
      );
      expect(grid().shadowRoot!.querySelector('input[type="search"]')).not.toBeNull();
      await expectNoA11yViolations(host);
      state = "error";
      grid().chooseFilter("method", ["card"]);
      await vi.waitFor(() => expect(grid().errorMessage).not.toBe(""));
      await expectNoA11yViolations(host);
    },
  );
});
