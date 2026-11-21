import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { WtTextarea } from "@waitron/ui";
import type { TillProduct } from "../api/client.js";
import { watchKeyboardInsets, type VisibleArea } from "../state/keyboard-inset.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./modifier-picker.js";

class FakeViewport extends EventTarget implements VisibleArea {
  height = 640;
  offsetTop = 0;
  scale = 1;
}

const product: TillProduct = {
  id: "dish",
  name: "Staff soup",
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};

let stop: (() => void) | undefined;
afterEach(async () => {
  stop?.();
  stop = undefined;
  cleanupWidgets();
  await page.viewport(1280, 900);
});

// The Pixel tablet's landscape readings with the visible area panned down, 2026-11-21.
it("the line-note field being typed in stays in view when the keyboard shrinks the window", async () => {
  await page.viewport(1280, 640);
  const { el, host } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
    quantity: "2",
    initialSelections: { note: "No salt" },
    lineDetails: true,
    withNote: true,
  });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const field = el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  const textarea = field.shadowRoot!.querySelector("textarea")!;
  textarea.focus();

  const viewport = new FakeViewport();
  stop = watchKeyboardInsets({ visualViewport: viewport, innerHeight: 640 }, host);
  viewport.height = 192;
  viewport.offsetTop = 87;
  viewport.dispatchEvent(new Event("resize"));

  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
  await expect
    .poll(() => {
      const outer = body.getBoundingClientRect();
      const inner = textarea.getBoundingClientRect();
      return Math.max(0, outer.top - inner.top, inner.bottom - outer.bottom);
    })
    .toBeLessThanOrEqual(0.5);
  const rect = textarea.getBoundingClientRect();
  let hit: Element | null = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    if (!inner || inner === hit) break;
    hit = inner;
  }
  expect(hit).toBe(textarea);
  expect(field.shadowRoot!.activeElement).toBe(textarea);
});
