import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "../index.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-icon-button a11y (%s)", (theme) => {
  test.each(["action", "off", "on", "disabled", "focused"])("%s", async (state) => {
    const el = (await mountThemed(
      '<wt-icon-button label="Select" icon="select-rows"></wt-icon-button>',
      theme,
    )) as HTMLElementTagNameMap["wt-icon-button"];
    expect(el.shadowRoot?.querySelector("button")).toBeInstanceOf(HTMLButtonElement);
    if (state === "off" || state === "on") el.pressed = state === "on";
    if (state === "disabled") el.disabled = true;
    await el.updateComplete;
    if (state === "focused") {
      await userEvent.keyboard("{Tab}");
      el.focus();
      expect(getComputedStyle(el.shadowRoot!.querySelector(".icon-tooltip")!).display).toBe(
        "block",
      );
    }
    await expectNoA11yViolations(host);
  });
});
