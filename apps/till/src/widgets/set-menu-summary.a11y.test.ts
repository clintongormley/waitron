import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { bill, courses } from "../../test/set-menu-widgets.js";
import { TillSetMenuSummary } from "./set-menu-summary.js";

afterEach(cleanupWidgets);

it.each(["light", "dark"] as const)(
  "the folded and expanded summary is accessible in %s",
  async (theme) => {
    const { el, host } = await mountWidget<TillSetMenuSummary>(
      "till-set-menu-summary",
      {
        bill,
        courseNames: courses,
        dishNames: new Map([["sent-sirloin", "Sirloin"]]),
        removeMenu: async () => undefined,
        moveDish: async () => undefined,
        compMenu: () => undefined,
      },
      theme,
    );
    const details = el.shadowRoot!.querySelector("details")!;
    expect(details.open).toBe(false);
    await expectNoA11yViolations(host);
    await userEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(details.querySelector("[data-comp-menu]")).toBeTruthy();
    const move = Array.from(details.querySelectorAll("wt-button")).find((button) =>
      button.textContent?.includes("Move"),
    );
    await userEvent.click(move!);
    expect(details.querySelector("[data-move-options]")).toBeTruthy();
    await expectNoA11yViolations(host);
  },
);
