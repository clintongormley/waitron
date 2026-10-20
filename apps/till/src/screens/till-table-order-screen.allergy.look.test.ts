import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  allergyView,
  dialog,
  mountApp,
  openTable,
  resetAllergyFixture,
  till,
} from "../../test/allergy-app-fixture.js";

const locale = currentLocale();
let viewport: [number, number];
beforeEach(() => {
  viewport = [window.innerWidth, window.innerHeight];
  resetAllergyFixture();
});
afterEach(async () => {
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(...viewport);
});

for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const)
    for (const language of ["en", "es"] as const)
      it(`the live editor renders in ${language}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        const view = allergyView("allergies");
        view.snapshot.guests = [
          {
            id: "guest-a",
            position: 0,
            who: "The guest wearing a blue shirt",
            allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
            note: "Severe: keep the preparation separate",
          },
          {
            id: "guest-b",
            position: 1,
            who: "The guest beside the window",
            allergens: { eggs: {} },
            note: null,
          },
        ];
        view.snapshot.ticks = [{ guestId: "guest-a", workingLineId: "dish-a", draftLineId: null }];
        view.dishes = [
          {
            line: { kind: "working", id: "dish-a" },
            billId: "wo-4",
            name: "Pasta with mushrooms",
            quantity: "2.000",
            allergens: { gluten: { kinds: ["wheat"] } },
            extras: [{ name: "Egg sauce", quantity: "1.000", allergens: { eggs: {} } }],
            sentAt: "2026-10-19T13:24:00Z",
            offeredBefore: true,
          },
          {
            line: { kind: "working", id: "dish-b" },
            billId: "other-bill",
            name: "Roast vegetables",
            quantity: "1.000",
            allergens: {},
            extras: [],
            sentAt: null,
            offeredBefore: true,
          },
        ];
        const { el } = await mountApp(
          {
            readPartyAllergy: vi.fn().mockResolvedValue(view),
            getTill: vi.fn().mockResolvedValue({ ...till("till"), locale: language }),
          },
          undefined,
          theme,
        );
        const screen = await openTable(el);
        setLocale(language);
        screen.requestUpdate();
        await screen.updateComplete;
        await vi.waitFor(() => expect(screen.allergyView).toEqual(view));
        await userEvent.click(page.getByRole("button", { name: t("allergy.change"), exact: true }));
        await vi.waitFor(() => expect(dialog(el)?.mode).toBe("edit"));
        const form = dialog(el)!;
        await form.updateComplete;
        const native = form.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
        await native.updateComplete;
        expect(native.shadowRoot!.textContent).toContain(t("allergy.title"));
        expect(form.shadowRoot!.textContent).toContain("Roast vegetables");
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
        await page.screenshot({
          path: `../../__screenshots__/a669-live-editor/editor-${language}-${theme}-${width}.png`,
        });
        const save = form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!;
        save.scrollIntoView({ block: "nearest" });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const box = save.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
        await page.screenshot({
          path: `../../__screenshots__/a669-live-editor/footer-${language}-${theme}-${width}.png`,
        });
      });
