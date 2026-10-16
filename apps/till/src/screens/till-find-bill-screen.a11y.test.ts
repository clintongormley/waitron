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
  sessionStorage.removeItem("waitron.find-bill.bills");
  sessionStorage.removeItem("waitron.find-bill.transactions");
});
describe.each(["light", "dark"] as const)("Find a bill %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "Bills, Transactions, empty, error and phone filters in %s",
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
                      state === "empty"
                        ? []
                        : [
                            billRow({
                              label: "A very long group name that must not widen the phone page",
                            }),
                          ],
                      state === "empty" ? 0 : 125,
                    )
                  : { ...listPage([transactionRow()]), dates: resolvedDates },
              ),
      );
      const { el, host } = await mountWidget<TillFindBillScreen>(
        "till-find-bill-screen",
        { api, active: true },
        theme,
      );
      const grid = () =>
        el.shadowRoot!.querySelector<WtDataTable<unknown>>('wt-data-table[data-tab="bills"]')!;
      await vi.waitFor(() => expect(grid()?.rows).toHaveLength(1));
      expect(grid().shadowRoot!.textContent).toContain("25");
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
      await userEvent.click(
        el
          .shadowRoot!.querySelector("wt-tabs")!
          .shadowRoot!.querySelector<HTMLElement>('[data-key="transactions"]')!,
      );
      const transactions = el.shadowRoot!.querySelector<WtDataTable<unknown>>(
        'wt-data-table[data-tab="transactions"]',
      )!;
      await vi.waitFor(() => expect(transactions.rows).toHaveLength(1));
      expect(transactions.shadowRoot!.textContent).toContain("0091");
      await expectNoA11yViolations(host);
      await userEvent.click(
        transactions.shadowRoot!.querySelector<HTMLElement>(
          `[aria-label="${language === "en-GB" ? "Filters" : "Filtros"}"]`,
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
      await userEvent.click(
        el
          .shadowRoot!.querySelector("wt-tabs")!
          .shadowRoot!.querySelector<HTMLElement>('[data-key="bills"]')!,
      );
      await vi.waitFor(() => expect(grid().loading).toBe(false));
      state = "empty";
      grid().chooseFilter("state", ["held"]);
      await vi.waitFor(() =>
        expect(grid().emptyMessage && grid().rows.length === 0 && !grid().loading).toBe(true),
      );
      expect(grid().shadowRoot!.querySelector('input[type="search"]')).not.toBeNull();
      await expectNoA11yViolations(host);
      state = "error";
      grid().chooseFilter("state", ["part-paid"]);
      await vi.waitFor(() => expect(grid().errorMessage).not.toBe(""));
      await expectNoA11yViolations(host);
    },
  );
});
