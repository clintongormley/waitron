import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { mount } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { sentPanelFor } from "./till-table-order-screen.sent.test-helpers.js";
import { tapTableMenu } from "./till-table-order-screen.bill-switcher.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it.each(["loaded", "fallback", "unread"] as const)(
  "keeps the %s Current orders read in Sent without a second list in the table menu",
  async (read) => {
    const { el } = await mount({
      lines: read === "fallback" ? [storedDish] : [],
      groups: [{ ...orderGroup("held", 1, "held"), lineIds: [storedDish.id] }],
      currentOrders:
        read === "loaded"
          ? current({
              groups: [
                currentGroup("held", 1, "held", [
                  row("dish", "Recorded flan", "1.000", { released: false }),
                ]),
              ],
              ungrouped: [row("coffee", "Recorded coffee", "1.000")],
              reminder: null,
            })
          : null,
      currentOrdersUnread: read === "unread",
    });
    const panel = await sentPanelFor(el);
    if (read === "loaded") {
      for (const selector of ["[data-sent-toggle]", "[data-held-toggle]"]) {
        const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
        if (toggle.getAttribute("aria-expanded") === "false") {
          await userEvent.click(toggle);
          await panel.updateComplete;
        }
      }
      expect(panel.shadowRoot!.querySelector('[data-held-line="dish"]')!.textContent).toContain(
        "Recorded flan",
      );
      expect(panel.shadowRoot!.querySelector('[data-fired-line="coffee"]')!.textContent).toContain(
        "Recorded coffee",
      );
    } else if (read === "fallback") {
      expect(
        el
          .shadowRoot!.querySelector('[data-sent-fallback-line="stored-dish"]')!
          .textContent!.replace(/\s+/g, " "),
      ).toContain("Recorded dish ×2");
    }
    await tapTableMenu(el);
    const menu = el.shadowRoot!.querySelector("[data-table-menu]")!;
    expect(
      menu.querySelector(
        "[data-groups], [data-group-line], [data-ungrouped], [data-current-orders-unread]",
      ),
    ).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-sent-orders]")).not.toBeNull();
    if (read === "unread") {
      expect(el.shadowRoot!.querySelector("[data-sent-unread]")!.textContent!.trim()).toBe(
        t("table.current_orders_unread"),
      );
    }
  },
);
