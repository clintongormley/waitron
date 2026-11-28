import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui/src/components/wt-icon.js";
import { DROPDOWN_ICONS } from "@waitron/ui/src/components/wt-combobox.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import {
  billOptions,
  billRow,
  findBillApi,
  json,
  listPage,
  resolvedDates,
  transactionRow,
} from "../../test/find-bill-fixtures.js";
import type { TillFindBillScreen } from "./till-find-bill-screen.js";
import "./till-find-bill-screen.js";
registerIcons(DROPDOWN_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("Find a bill %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "unpaid bills, counter orders, sales, the Days sheet, empty and error in %s",
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
      const shown = () => el.shadowRoot!.querySelectorAll("button[data-transaction]");
      const days = () => el.shadowRoot!.querySelector("wt-row-actions[data-days]")!;
      const choose = async (preset: string) => {
        await userEvent.click(days().shadowRoot!.querySelector<HTMLElement>('[part="trigger"]')!);
        await vi.waitFor(() =>
          expect(days().shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(
            true,
          ),
        );
        await expectNoA11yViolations(host);
        await userEvent.click(days().querySelector<HTMLElement>(`[data-preset="${preset}"]`)!);
      };
      await vi.waitFor(() => expect(shown()).toHaveLength(1));
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector('[data-owed] [data-bill="bill-owed"]')).not.toBeNull(),
      );
      expect(
        el.shadowRoot!.querySelector('[data-counter-orders] [data-bill="bill-1"]'),
      ).not.toBeNull();
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      expect(shown()[0]!.textContent).toContain(transactionRow().customerName!);
      await expectNoA11yViolations(host);
      await choose("custom");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector('wt-input[name="from"]')).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
      await choose("today");
      await vi.waitFor(() => expect(shown()).toHaveLength(1));
      state = "empty";
      await choose("yesterday");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-list-empty]")).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
      state = "error";
      await choose("this-month");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-list-error]")).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
    },
  );
  it.each(["en-GB", "es-ES"])(
    "a search matching sales by their amount, with the amount highlighted, in %s",
    async (language) => {
      setLocale(language);
      await page.viewport(390, 844);
      const { api } = findBillApi(async (url) =>
        url.pathname.endsWith("options")
          ? json(billOptions)
          : url.pathname === "/api/bills"
            ? json(listPage([]))
            : json({
                ...listPage(
                  url.searchParams.get("q") === "80.52"
                    ? [
                        transactionRow({
                          transactionId: "amount",
                          amountMatch: "amount",
                          amount: "80.52",
                        }),
                        transactionRow({
                          transactionId: "amount-2",
                          amountMatch: "amount",
                          amount: "80.52",
                          type: "sale",
                          methods: [{ method: "cash", last4: null }],
                          tableName: "Terrace 4",
                        }),
                      ]
                    : [transactionRow()],
                  url.searchParams.get("q") === "80.52" ? 2 : 1,
                ),
                dates: resolvedDates,
              }),
      );
      const { el, host } = await mountWidget<TillFindBillScreen>(
        "till-find-bill-screen",
        { api, active: true },
        theme,
      );
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelectorAll("button[data-transaction]")).toHaveLength(1),
      );
      const field = el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="search"]')!;
      await userEvent.fill(field.shadowRoot!.querySelector("input")!, "80.52");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelectorAll("button[data-transaction] .hl")).toHaveLength(2),
      );
      expect(el.shadowRoot!.querySelector("[data-order-label]")!.textContent).toBe(
        t("find_page.amount_match"),
      );
      await expectNoA11yViolations(host);
    },
  );
});
