import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { PartyAllergyRead } from "@waitron/module";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, measured } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { TillPartyAllergyDialog } from "./party-allergy-dialog.js";
async function capture(el: TillPartyAllergyDialog, name: string) {
  await measured();
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.updateComplete;
  const box = dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
  await page.screenshot({ path: `../../__screenshots__/a669-dialog/${name}.png` });
}
const original = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(original);
  await page.viewport(1280, 768);
});
async function click(el: TillPartyAllergyDialog, selector: string) {
  await userEvent.click(page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>(selector)!));
  await el.updateComplete;
}
for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const)
    for (const locale of ["en", "es"] as const) {
      it(`allergy question, guests, kinds, error and ticking accessible in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        setLocale(locale);
        const view: PartyAllergyRead = {
          partyId: "p",
          snapshot: {
            answer: null,
            revision: 0,
            guests: [],
            ticks: [],
            changedAt: null,
            changedBy: null,
          },
          dishes: [
            {
              line: { kind: "draft", id: "d" },
              billId: "b",
              name: "Dish",
              quantity: "2.000",
              allergens: { gluten: { kinds: ["rye"] } },
              extras: [{ name: "Sauce", quantity: "2", allergens: { eggs: {} } }],
              sentAt: null,
              offeredBefore: false,
            },
          ],
        };
        const { el, host } = await mountWidget<TillPartyAllergyDialog>(
          "till-party-allergy-dialog",
          { view, scopeKey: "a" },
          theme,
        );
        await expectNoA11yViolations(host);
        await capture(el, `question-${locale}-${theme}-${width}`);
        await click(el, "[data-allergies]");
        await expectNoA11yViolations(host);
        const field = el.shadowRoot!.querySelector("wt-input")!;
        await field.updateComplete;
        await userEvent.fill(
          page.elementLocator(field.shadowRoot!.querySelector("input")!),
          "Seat 4",
        );
        await click(el, '[data-code="gluten"]');
        await expectNoA11yViolations(host);
        await click(el, "[data-primary]");
        await expectNoA11yViolations(host);
        await capture(el, `guests-${locale}-${theme}-${width}`);
        await click(el, '[data-kind="wheat"]');
        await click(el, "[data-primary]");
        await click(el, '[data-tick="0:0"]');
        expect(el.shadowRoot!.querySelector("[data-primary]")!.textContent).toContain(
          t("allergy.anyway"),
        );
        await expectNoA11yViolations(host);
        await capture(el, `ticks-${locale}-${theme}-${width}`);
        el.fieldRefusal = { guestIndex: 0, field: "who", message: t("allergy.who_invalid") };
        await el.updateComplete;
        await expectNoA11yViolations(host);
        await capture(el, `refusal-${locale}-${theme}-${width}`);
      });
      it(`allergy editor, deletion confirmation and empty answer accessible in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        setLocale(locale);
        const view: PartyAllergyRead = {
          partyId: "p",
          snapshot: {
            answer: "allergies",
            revision: 1,
            guests: [
              { id: "g", position: 0, who: "Seat 4", allergens: { milk: {} }, note: "Severe" },
            ],
            ticks: [{ guestId: "g", draftLineId: null, workingLineId: "w" }],
            changedAt: null,
            changedBy: null,
          },
          dishes: [
            {
              line: { kind: "working", id: "w" },
              billId: "b",
              name: "Soup",
              quantity: "1",
              allergens: null,
              extras: [],
              sentAt: "2026-10-19T13:24:00Z",
              offeredBefore: true,
            },
          ],
        };
        const { el, host } = await mountWidget<TillPartyAllergyDialog>(
          "till-party-allergy-dialog",
          { view, mode: "edit", scopeKey: "a" },
          theme,
        );
        await expectNoA11yViolations(host);
        await capture(el, `editor-${locale}-${theme}-${width}`);
        await click(el, '[data-delete="0"]');
        await expectNoA11yViolations(host);
        await capture(el, `delete-${locale}-${theme}-${width}`);
        await click(el, "[data-confirm-cancel]");
        await click(el, "[data-none]");
        await expectNoA11yViolations(host);
        await capture(el, `none-${locale}-${theme}-${width}`);
        await click(el, "[data-confirm-cancel]");
        await click(el, '[data-delete="0"]');
        await click(el, "[data-confirm-delete]");
        expect(el.shadowRoot!.textContent).toContain(t("allergy.empty"));
        await expectNoA11yViolations(host);
        await capture(el, `empty-${locale}-${theme}-${width}`);
      });
    }
