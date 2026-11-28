import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

it.each(["light", "dark"] as const)(
  "keeps placeholders out of reading and tab order in %s",
  async (theme) => {
    const shape = await mountThemed(
      '<wt-placeholder style="height: 36px"></wt-placeholder>',
      theme,
    );
    const before = document.createElement("button");
    before.textContent = "Left";
    const after = document.createElement("button");
    after.textContent = "Right";
    shape.before(before);
    shape.after(after);

    expect(shape.getAttribute("aria-hidden")).toBe("true");
    before.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(after);
    await expectNoA11yViolations(host);
  },
);
