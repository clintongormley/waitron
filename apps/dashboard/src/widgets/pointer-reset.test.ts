import { userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import "@waitron/ui/src/components/wt-button.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

/**
 * Guards the pointer reset in `test-helpers.ts`. The two tests below must stay in this order and stay
 * separate: the first one leaves the cursor dirty, the second one proves the next test starts clean.
 */

afterEach(cleanupWidgets);

// The primary variant is the one that paints `--wt-color-primary`, which is what the hover rule dims.
const BUTTON_PROPS = { variant: "primary", textContent: "Add" };

it("parks the cursor on a button, so the next test starts with a stale hover to clear", async () => {
  const { el } = await mountWidget<HTMLElement & { shadowRoot: ShadowRoot }>(
    "wt-button",
    BUTTON_PROPS,
    "light",
  );
  const inner = el.shadowRoot.querySelector("button")!;
  await userEvent.hover(inner);
  // The premise of the guard below: a real hover here really does set `:hover` on the inner button.
  expect(inner.matches(":hover")).toBe(true);
});

it("starts with no element hovered, so an a11y scan sees undimmed colours", async () => {
  const { el, host } = await mountWidget<HTMLElement & { shadowRoot: ShadowRoot }>(
    "wt-button",
    BUTTON_PROPS,
    "light",
  );
  // Blink re-evaluates which element is under the cursor after layout, not synchronously with the
  // mount. Without this yield a stale hover has not landed on the new button yet and this guard
  // passes with the reset deleted.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const inner = el.shadowRoot.querySelector("button")!;
  expect(inner.matches(":hover")).toBe(false);
  await expectNoA11yViolations(host);
});
