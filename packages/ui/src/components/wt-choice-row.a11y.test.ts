import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-choice-row.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-choice-row a11y (%s theme)", (theme) => {
  test("at rest", async () => {
    await mountThemed(
      '<wt-choice-row heading="Demo">A practice server. Nothing is filed to AEAT.</wt-choice-row>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("focused", async () => {
    const el = await mountThemed(
      '<wt-choice-row heading="Live">The real thing. Every sale is filed to AEAT.</wt-choice-row>',
      theme,
    );
    el.focus();
    await expectNoA11yViolations(host);
  });

  // A hovered row is painted --wt-color-surface-lifted behind its muted, small description.
  test("hovered", async () => {
    const el = await mountThemed(
      '<wt-choice-row heading="Prepare">Enter your real menus, then practise.</wt-choice-row>',
      theme,
    );
    const button = el.shadowRoot!.querySelector("button")!;
    const atRest = getComputedStyle(button).backgroundColor;
    await userEvent.hover(button);
    expect(button.matches(":hover")).toBe(true);
    expect(getComputedStyle(button).backgroundColor).not.toBe(atRest);
    await expectNoA11yViolations(host);
  });
});
