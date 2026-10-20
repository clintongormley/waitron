import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtTextarea } from "@waitron/ui";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";
import type { ModifierConfirmDetail, TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./modifier-picker.js";

const product: TillProduct = {
  id: "dish",
  name: "Staff soup",
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};
afterEach(cleanupWidgets);

it.each(["en-GB", "es-ES"])(
  "A738 an empty line note opens explicitly without making Save dirty (%s)",
  async (locale) => {
    const prior = currentLocale();
    setLocale(locale);
    try {
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product,
        quantity: "2",
        initialSelections: {},
        lineDetails: true,
        withNote: true,
      });
      expect(el.shadowRoot!.querySelector("wt-textarea")).toBeNull();
      const add = el.shadowRoot!.querySelector<WtButton>(".add-note");
      expect(add).not.toBeNull();
      expect(add!.textContent).toContain(t("line.note.add"));
      await userEvent.click(add!);
      await el.updateComplete;
      const field = el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
      expect(field).not.toBeNull();
      await field.updateComplete;
      expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("textarea"));
      expect(el.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(true);
      const sent: ModifierConfirmDetail[] = [];
      el.addEventListener("wt-modifier-confirm", (event) =>
        sent.push((event as CustomEvent<ModifierConfirmDetail>).detail),
      );
      el.shadowRoot!.querySelector<WtButton>(".confirm")!.click();
      expect(sent).toEqual([]);
      await userEvent.fill(field.shadowRoot!.querySelector("textarea")!, " No salt ");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(false);
      await userEvent.click(el.shadowRoot!.querySelector<WtButton>(".confirm")!);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ quantity: "2", note: "No salt" });
    } finally {
      setLocale(prior);
    }
  },
);

it("A738 a recorded note opens immediately and add-dish note entry stays available", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
    initialSelections: { note: "No salt" },
    lineDetails: true,
    withNote: true,
  });
  expect(el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.value).toBe("No salt");
  expect(el.shadowRoot!.querySelector(".add-note")).toBeNull();
  const note = el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await userEvent.fill(note.shadowRoot!.querySelector("textarea")!, "");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-textarea")).toBe(note);
  expect(el.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(false);
  const { el: addDish } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
  });
  expect(addDish.shadowRoot!.querySelector("wt-textarea")).not.toBeNull();
});

it("A738 sent empty-note inspection offers neither Add a note nor an editor", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
    initialSelections: {},
    lineDetails: true,
    withNote: true,
    readOnly: true,
  });
  expect(el.shadowRoot!.querySelector(".add-note")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-textarea")).toBeNull();
  expect(el.shadowRoot!.querySelector(".confirm")).toBeNull();
});

for (const theme of ["light", "dark"] as const)
  for (const locale of ["en-GB", "es-ES"])
    it.each([390, 1280])(
      `A738 empty-note action and editor fit ${theme} ${locale} %s`,
      async (width) => {
        const prior = currentLocale(),
          oldWidth = window.innerWidth,
          oldHeight = window.innerHeight;
        setLocale(locale);
        await page.viewport(width, 844);
        try {
          const { el, host } = await mountWidget<TillModifierPicker>(
            "till-modifier-picker",
            {
              product,
              initialSelections: {},
              lineDetails: true,
              withNote: true,
            },
            theme,
          );
          const modal = el.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const dialog = modal.shadowRoot!.querySelector("dialog")!;
          for (const state of ["collapsed", "expanded"]) {
            if (state === "expanded") {
              await userEvent.click(el.shadowRoot!.querySelector<WtButton>(".add-note")!);
              await el.updateComplete;
            }
            await expectNoA11yViolations(host);
            expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
            expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const add = el.shadowRoot!.querySelector<WtButton>(".add-note");
            if (add) {
              await add.updateComplete;
              const box = add.shadowRoot!.querySelector("button")!.getBoundingClientRect();
              const minimum = parseFloat(getComputedStyle(add).getPropertyValue("--wt-tap-min"));
              expect(box.height).toBeGreaterThanOrEqual(minimum);
              expect(box.width).toBeGreaterThanOrEqual(minimum);
            }
            await page.screenshot({
              element: dialog,
              path: `__screenshots__/a738-note/${locale}-${theme}-${width}-${state}.png`,
            });
          }
          await userEvent.keyboard("{Escape}");
          await expect.poll(() => dialog.open).toBe(false);
        } finally {
          cleanupWidgets();
          setLocale(prior);
          await page.viewport(oldWidth, oldHeight);
        }
      },
    );
