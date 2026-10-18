import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import type { RecalledDraftLine } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { fromDraftLine, toDraftLineInput } from "../state/draft-lines.js";
import type { TillBasket } from "../widgets/basket.js";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";

afterEach(() => cleanupWidgets());

describe("recalled extras on the table screen", () => {
  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const locked of [false, true])
        it.each([360, 390, 1280])(
          `keeps a retired extra's full name, warning and money inside New order (locked=${locked}, ${locale}, ${theme}, %s px)`,
          async (width) => {
            const priorLocale = currentLocale();
            const priorSize = { width: window.innerWidth, height: window.innerHeight };
            setLocale(locale);
            await page.viewport(width, 900);
            try {
              const wire: RecalledDraftLine = {
                id: "reference",
                sourceLineId: storedDish.id,
                source: {
                  line: storedDish,
                  extras: [
                    {
                      ...storedExtra,
                      name: "ParmigianoReggianoGranRiservaTrentaseiMesiSenzaLattosio",
                    },
                  ],
                  netAmount: "8.00",
                },
                quantity: "2.000",
                note: storedDish.note,
                courseId: null,
                makeAt: null,
                noMerge: true,
                unavailable: false,
                slot: 0,
                joinGroupId: null,
                afterGroupId: null,
              };
              const draft = new DraftStore();
              draft.loadFrom("recalled", [fromDraftLine(wire, new Map())]);
              draft.ownershipLocked = locked;
              const before = toDraftLineInput(draft.lines[0]!);
              const { el, host } = await mount({
                draftStore: draft,
                products: [],
                lines: [wire.source.line, ...wire.source.extras],
              });
              host.setAttribute("data-theme", theme);
              host.style.width = "100%";
              el.style.width = "100%";
              await resized(el);
              const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
              if (review?.checkVisibility()) {
                await userEvent.click(review);
                await el.updateComplete;
              }
              const basket = [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find(
                (each) => each.lineIndexes?.includes(0),
              )!;
              await basket.updateComplete;
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              const extra = [...basket.shadowRoot!.querySelectorAll<HTMLElement>(".option")].find(
                (row) =>
                  row.textContent?.includes(
                    "ParmigianoReggianoGranRiservaTrentaseiMesiSenzaLattosio",
                  ),
              )!;
              const name = extra.querySelector<HTMLElement>(".name")!;
              const money = extra.querySelector<HTMLElement>(".option-total")!;
              const warning = extra.querySelector<HTMLElement>(".not-offered")!;
              expect(extra.checkVisibility()).toBe(true);
              expect(name.textContent).toContain(
                "ParmigianoReggianoGranRiservaTrentaseiMesiSenzaLattosio",
              );
              expect(warning.checkVisibility()).toBe(true);
              expect(money.textContent).toContain(formatMoney("1.50", currentLocale()));
              await page.screenshot({
                path: `__screenshots__/a773-recalled-layout-${locale}-${theme}-${width}-${locked}.png`,
              });
              expect(window.innerWidth).toBe(width);
              const container = basket.getBoundingClientRect();
              const price = money.getBoundingClientRect();
              const label = name.getBoundingClientRect();
              expect(price.left).toBeGreaterThanOrEqual(container.left);
              expect(price.right).toBeLessThanOrEqual(Math.min(container.right, width));
              expect(label.right).toBeLessThanOrEqual(price.left);
              expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
              expect(warning.getBoundingClientRect().right).toBeLessThanOrEqual(price.left);
              expect(toDraftLineInput(draft.lines[0]!)).toEqual(before);
              expect(draft.total).toBe("8.00");
              expect(el.shadowRoot!.querySelector("[data-order-total]")!.textContent).toContain(
                formatMoney("8.00", currentLocale()),
              );
              await expectNoA11yViolations(host);
            } finally {
              cleanupWidgets();
              setLocale(priorLocale);
              await page.viewport(priorSize.width, priorSize.height);
            }
          },
        );
});
