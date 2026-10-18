import { afterEach, describe, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { TouchGesture } from "@waitron/ui/src/vitest-pointer-gestures.js";
import type { WtRowActions } from "@waitron/ui";
import { DraftStore } from "../state/draft-sync.js";
import type { TillBasket } from "../widgets/basket.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { beer, flan, resized } from "./till-table-order-screen.test-helpers.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";
import "../till-app.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    touchGesture: (gesture: TouchGesture) => Promise<void>;
    parkTouch: () => Promise<void>;
    holdDraftLine: (selector: string) => Promise<void>;
  }
}

afterEach(async () => {
  await commands.parkTouch();
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

async function open(theme: "light" | "dark") {
  const draft = new DraftStore();
  draft.loadFrom("draft", [
    { product: beer, quantity: "2", place: { kind: "fire" } },
    { product: flan, quantity: "1", place: { kind: "new", slot: 1 } },
    {
      product: { ...flan, id: "pie", name: "Pie" },
      quantity: "1",
      place: { kind: "new", slot: 2 },
    },
  ]);
  const { el, host } = await mountWidget<TillTableOrderScreen>(
    "till-table-order-screen",
    {
      draftStore: draft,
      products: [beer, flan],
      orderId: "wo-4",
    },
    theme,
  );
  await resized(el);
  const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review?.checkVisibility()) await userEvent.click(review);
  await el.updateComplete;
  for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket"))
    await basket.updateComplete;
  return { el, host, draft };
}

describe.each(["en", "es"] as const)("unsent gestures %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])(
      "moves a real touch and keeps a keyboard alternative at %i",
      async (width) => {
        await page.viewport(width, 1800);
        setLocale(locale);
        const { el, host, draft } = await open(theme);
        expect(window.innerWidth).toBe(width);
        const before = [...draft.lines];
        let activity = 0;
        host.addEventListener("pointerdown", () => activity++);
        await commands.touchGesture({
          at: '[data-draft-select="0"]',
          holdMs: 550,
          moveTo: '[data-draft-group="new:1"] h3',
        });
        await el.updateComplete;
        expect(draft.lines[0]!.place).toEqual({ kind: "new", slot: 1 });
        expect(draft.lines.every((line, index) => line === before[index])).toBe(true);
        expect(activity).toBe(1);
        expect(
          [...el.shadowRoot!.querySelectorAll("[data-draft-select]")].map((control) =>
            control.getAttribute("aria-pressed"),
          ),
        ).toEqual(["false", "false", "false"]);
        for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")) {
          await basket.updateComplete;
          expect(basket.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
        }
        const more = el.shadowRoot!.querySelector<WtRowActions>('[data-draft-group-more="new:1"]')!;
        expect(more).not.toBeNull();
        await more.updateComplete;
        const trigger = more.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
        const icon = trigger.querySelector("wt-icon")!;
        await icon.updateComplete;
        expect(icon.shadowRoot!.querySelector("svg path")!.getAttribute("d")).not.toBe("");
        trigger.focus();
        await userEvent.keyboard("{Enter}");
        const action = more.querySelector<HTMLElement>("[data-draft-later]")!;
        expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
        for (const control of [
          trigger,
          action,
          el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="0"]')!,
        ]) {
          const rect = control.getBoundingClientRect();
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
        }
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-unsent-drag-${locale}-${theme}-${width}.png`,
        });
        action.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
        await userEvent.keyboard("{Enter}");
        expect(draft.lines[0]!.place).toEqual({ kind: "new", slot: 2 });
        expect(draft.lines[1]!.place).toEqual({ kind: "new", slot: 2 });
        expect(draft.lines[2]!.place).toEqual({ kind: "new", slot: 1 });
      },
    );
  });
});

it("a real held mouse press opens details without the release click selecting the row", async () => {
  const { el, draft } = await open("light");
  const lead = el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="0"]')!;
  await commands.holdDraftLine('[data-draft-select="0"]');
  const basket = [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find((basket) =>
    basket.lineIndexes?.includes(0),
  )!;
  await basket.updateComplete;
  const picker = basket.shadowRoot!.querySelector<HTMLElement>("till-modifier-picker");
  expect(picker).not.toBeNull();
  expect(lead.getAttribute("aria-pressed")).toBe("false");
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
});
