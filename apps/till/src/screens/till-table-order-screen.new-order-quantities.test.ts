import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { TillBasket } from "../widgets/basket.js";
import type { SubmitDraftDetail } from "./till-table-order-screen.js";
import { jamon, menuOf, mount, resized, store } from "./till-table-order-screen.test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe("New order quantities keep display separate from submission", () => {
  for (const locale of ["en", "es"] as const)
    for (const width of [390, 1280])
      for (const locked of [false, true]) {
        it(`${locale} at ${width}px shows the weighed row ${locked ? "read-only" : "editable"}`, async () => {
          setLocale(locale);
          await page.viewport(width, 900);
          const product = { ...jamon, name: "Jamón 1.5, 2 small" };
          const { el, host } = await mount({ products: [product], menus: menuOf([product]) });
          host.style.width = "100%";
          await resized(el);
          const draft = store(el);
          draft.addProduct(product, "0.375", { note: "Cut 1.5, 2 small" });
          if (locked) draft.lockEdits();
          el.requestUpdate();
          await el.updateComplete;
          const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
          if (review?.checkVisibility()) {
            await userEvent.click(review);
            await el.updateComplete;
          }
          const basket = el.shadowRoot!.querySelector<TillBasket>(
            "[data-draft-sections] till-basket",
          )!;
          await basket.updateComplete;
          const lead = el.shadowRoot!.querySelector<HTMLElement>(".draft-line-name")!;
          const quantity = basket.shadowRoot!.querySelector<HTMLElement>(".qty")!;
          expect(lead.checkVisibility()).toBe(true);
          expect(quantity.checkVisibility()).toBe(true);
          expect(lead.textContent).toBe(
            locale === "es" ? "Jamón 1.5, 2 small ×0,375" : "Jamón 1.5, 2 small ×0.375",
          );
          expect(quantity.textContent).toBe(locale === "es" ? "0,375 kg" : "0.375 kg");
          expect(basket.shadowRoot!.textContent).toContain("Cut 1.5, 2 small");
          expect(draft.lines[0]!.quantity).toBe("0.375");
          expect(basket.shadowRoot!.querySelector(".stepper")).toBeNull();
          const submits: SubmitDraftDetail[] = [];
          el.addEventListener("submit-draft", (event) =>
            submits.push((event as CustomEvent<SubmitDraftDetail>).detail),
          );
          const send = el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!;
          if (locked) {
            expect(send.hasAttribute("disabled")).toBe(true);
            expect(el.shadowRoot!.querySelector("[data-draft-select]")).toBeNull();
            expect(submits).toEqual([]);
          } else {
            await userEvent.click(
              el.shadowRoot!.querySelector<HTMLElement>("[data-draft-select]")!,
            );
            await el.updateComplete;
            await userEvent.click(
              el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-selected"]')!,
            );
            expect(submits).toHaveLength(1);
            expect(submits[0]!.lines).toEqual([
              { menuItemId: "offer-jamon", quantity: "0.375", note: "Cut 1.5, 2 small" },
            ]);
            expect(submits[0]!.sent).toEqual([draft.lines[0]]);
            expect(draft.lines[0]!.quantity).toBe("0.375");
          }
        });
      }

  for (const locale of ["en", "es"] as const)
    for (const abbreviation of ["kg1.5, 2", ""]) {
      it(`${locale} keeps precision and unit punctuation ${JSON.stringify(abbreviation)}`, async () => {
        setLocale(locale);
        const product = {
          ...jamon,
          unit: {
            id: "fractional-unit",
            staffName: "Staff unit",
            staffAbbreviation: "su",
            name: { en: abbreviation, es: abbreviation },
            abbreviation: { en: abbreviation, es: abbreviation },
            precision: 3,
            hardwareUnit: null,
          },
        };
        const { el } = await mount({ products: [product], menus: menuOf([product]) });
        store(el).addProduct(product, "0.350");
        await el.updateComplete;
        const basket = el.shadowRoot!.querySelector<TillBasket>(
          "[data-draft-sections] till-basket",
        )!;
        await basket.updateComplete;
        expect(basket.shadowRoot!.querySelector(".qty")!.textContent).toBe(
          (locale === "es" ? "0,350" : "0.350") +
            (abbreviation === "" ? " su" : ` ${abbreviation}`),
        );
        expect(store(el).lines[0]!.quantity).toBe("0.350");
      });
    }
});
