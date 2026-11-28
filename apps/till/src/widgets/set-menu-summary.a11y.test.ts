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
    await expectNoA11yViolations(host);
  },
);

it.each(["light", "dark"] as const)(
  "the note on an answer with no set menus that may not be the cheapest is accessible in %s",
  async (theme) => {
    const { el, host } = await mountWidget<TillSetMenuSummary>(
      "till-set-menu-summary",
      { bill: { ...bill, setMenus: [], dishes: [], exact: false }, courseNames: courses },
      theme,
    );
    expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeTruthy();
    await expectNoA11yViolations(host);
  },
);
