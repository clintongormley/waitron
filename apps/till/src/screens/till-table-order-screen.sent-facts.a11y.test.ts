import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import {
  croquetas,
  current,
  currentGroup,
  flan,
  heldAt,
  now,
  orderGroup,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Sent dish facts in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each([360, 390, 1280])(
      "keeps recorded sender and quantities readable at %i",
      async (width) => {
        await page.viewport(width, 1000);
        expect(window.innerWidth).toBe(width);
        setLocale(locale);
        const sentAt = "2026-09-28T19:45:00.000Z";
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            orderId: "wo-4",
            draftStore: null,
            groups: [orderGroup("g1", 1, "fired"), orderGroup("g3", 3, "held")],
            currentOrders: current({
              groups: [
                currentGroup("g1", 1, "fired", [croquetas], { sentAt }),
                currentGroup("g3", 3, "held", [{ ...flan, note: "no sugar" }]),
              ],
              ungrouped: [],
              reminder: null,
            }),
            now,
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
        await panel.updateComplete;
        await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>("[data-sent-toggle]")!);
        await panel.updateComplete;
        for (const kind of ["fired", "held"] as const) {
          const clock = new Intl.DateTimeFormat(currentLocale(), {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(kind === "fired" ? sentAt : heldAt));
          if (kind === "held") {
            await userEvent.click(
              panel.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!,
            );
            await panel.updateComplete;
          }
          const id = kind === "fired" ? "l-croq" : "l-flan";
          await userEvent.click(
            panel.shadowRoot!.querySelector<HTMLElement>(`[data-sent-info="${id}"]`)!,
          );
          await el.updateComplete;
          const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
          await dialog.updateComplete;
          const origin = dialog.querySelector<HTMLElement>("[data-sent-line-origin]")!;
          const words = origin.textContent!.replace(/\s+/g, " ").trim();
          expect(words).toBe(
            kind === "fired"
              ? locale === "en"
                ? `Sent ${clock} by Luis`
                : `Enviado a las ${clock} por Luis`
              : locale === "en"
                ? `Held ${clock} by Ana`
                : `En espera desde las ${clock}, por Ana`,
          );
          expect(origin.checkVisibility()).toBe(true);
          expect(origin.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
          expect(origin.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          const served = dialog.querySelector("[data-sent-line-served]");
          if (kind === "fired") {
            expect(served!.textContent!.trim()).toBe(
              t("table.row_served_of").replace("{served}", "2").replace("{quantity}", "4"),
            );
          } else {
            expect(served).toBeNull();
            expect(dialog.textContent).toContain("no sugar");
            expect(dialog.querySelector("[data-sent-line-serve]")).toBeNull();
          }
          const close = dialog.querySelector<HTMLElement>("[data-sent-line-close]")!;
          expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
          const native = dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
          expect(native.open).toBe(true);
          expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
          await page.screenshot({
            element: native,
            path: `__screenshots__/a773-sent-facts-${locale}-${theme}-${width}-${kind}.png`,
          });
          const closed = new Promise<void>((resolve) =>
            dialog.addEventListener("wt-close", () => resolve(), { once: true }),
          );
          await userEvent.click(close);
          await closed;
          await el.updateComplete;
        }
      },
    );
  });
});
