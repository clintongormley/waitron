import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { AdjustmentChoice, TillAdjustmentDialog } from "./adjustment-dialog.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});
describe.each(["en", "es"] as const)("combined Comp %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])(
      "has usable reason, extra, quantity and confirmation controls at %i",
      async (width) => {
        await page.viewport(width, 1100);
        expect(window.innerWidth).toBe(width);
        setLocale(locale);
        const { el, host } = await mountWidget<TillAdjustmentDialog>(
          "till-adjustment-dialog",
          {
            combined: true,
            kind: "comp",
            target: {
              lineId: "dish",
              name: "Burger",
              quantity: "3",
              total: "36.00",
              unitTotal: "12.00",
              extras: [
                {
                  lineId: "cheese",
                  name: "Cheese",
                  quantity: "3",
                  total: "6.00",
                  unitTotal: null,
                  extra: true,
                },
              ],
            },
            reasons: [
              {
                id: "complaint",
                name: locale === "en" ? "Complaint" : "Queja",
                actions: ["comp", "discount_percent", "discount_amount"],
                maxPercentBp: 1000,
                maxAmount: "20.00",
                noteRequired: true,
                applyRole: "supervisor",
                approverRole: "manager",
              },
            ],
          },
          theme,
        );
        const root = el.shadowRoot!;
        const click = async (selector: string) => {
          await userEvent.click(root.querySelector<HTMLElement>(selector)!);
          await el.updateComplete;
        };
        await click('input[name="reason"]');
        const stepper = root.querySelector("wt-number-stepper")!;
        await stepper.updateComplete;
        await userEvent.click(
          stepper.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="-1"]')!,
        );
        await el.updateComplete;
        expect(stepper.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("2");
        await click('input[name="discountKind"][value="percent"]');
        const fill = async (name: string, value: string) => {
          const field = root.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
            `[name="${name}"]`,
          )!;
          await field.updateComplete;
          await userEvent.fill(
            page.elementLocator(field.shadowRoot!.querySelector<HTMLInputElement>("input")!),
            value,
          );
          await el.updateComplete;
        };
        await fill("percent", "10");
        await click("[data-adjust-continue]");
        expect(
          (root.querySelector('[name="note"]') as HTMLElement & { error: string }).error,
        ).not.toBe("");
        await expectNoA11yViolations(host);
        await fill("note", locale === "en" ? "Late dish" : "Plato tardío");
        for (const selector of [
          '[name="adjustQuantity"]',
          '[name="percent"]',
          '[name="note"]',
          "[data-adjust-continue]",
        ]) {
          const box = root.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
        }
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-comp-${locale}-${theme}-${width}-form.png`,
        });
        let choice: AdjustmentChoice | undefined;
        el.addEventListener(
          "adjust-preview",
          (e) => (choice = (e as CustomEvent<AdjustmentChoice>).detail),
        );
        await click('input[name="adjustTarget"][value="cheese"]');
        expect(root.querySelector("wt-number-stepper")).toBeNull();
        await fill("percent", "10");
        await click("[data-adjust-continue]");
        expect(choice).toMatchObject({
          lineId: "cheese",
          action: "discount_percent",
          percentBp: 1000,
        });
        el.choice = choice!;
        el.preview = {
          reduction: "0.60",
          nominalValue: "0.60",
          needsApproval: "manager",
          overBillDiscountLimit: false,
          lines: [],
        };
        await el.updateComplete;
        expect(root.querySelector("[data-adjust-scope]")!.textContent).toContain("Cheese");
        expect(root.querySelector("[data-needs-approval]")).not.toBeNull();
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-comp-${locale}-${theme}-${width}-preview.png`,
        });
      },
    );
  });
});
