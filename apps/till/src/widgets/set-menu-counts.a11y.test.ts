import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { bill, seaBass } from "../../test/set-menu-widgets.js";
import { TillSetMenuCounts } from "./set-menu-counts.js";

afterEach(cleanupWidgets);

it.each(["light", "dark"] as const)(
  "counts and their inline error are accessible in %s",
  async (theme) => {
    const { el, host } = await mountWidget<TillSetMenuCounts>(
      "till-set-menu-counts",
      { bill, draft: [seaBass], saveCount: async () => undefined },
      theme,
    );
    const steppers = el.shadowRoot!.querySelectorAll("wt-number-stepper");
    expect(steppers).toHaveLength(2);
    await expectNoA11yViolations(host);
    const special = steppers[1]!;
    await userEvent.click(special.shadowRoot!.querySelector('[data-step="-1"]')!);
    await vi.waitFor(() => expect(special.shadowRoot!.querySelector("[data-error]")).toBeTruthy());
    await expectNoA11yViolations(host);
  },
);
