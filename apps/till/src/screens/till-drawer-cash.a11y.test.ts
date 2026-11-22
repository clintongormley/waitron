import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "../till-app.js";

afterEach(cleanupWidgets);

it.each(["light", "dark"] as const)(
  "exposes the cash-entry form and its field errors in %s",
  async (theme) => {
    const { el, host } = await mountWidget<HTMLElementTagNameMap["till-drawer-cash"]>(
      "till-drawer-cash",
      { api: { openDrawer: vi.fn(), saveDrawerEntry: vi.fn() }, printerId: "bar" },
      theme,
    );
    await expectNoA11yViolations(host);
    const root = el.shadowRoot!;
    const direction = root.querySelector("wt-segmented-control")!;
    expect(direction.label).toBeTruthy();
    await userEvent.click(direction.shadowRoot!.querySelector("button")!);
    await userEvent.click(root.querySelector<HTMLElement>('wt-button[data-cash-action="save"]')!);
    await expect.poll(() => root.querySelector("wt-form-actions")?.error).not.toBe("");
    await expectNoA11yViolations(host);
  },
);
