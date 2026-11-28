import { afterEach, expect, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "./wt-initials.js";

afterEach(cleanup);

test.each(["light", "dark"] as const)(
  "keeps the visible initials decorative in %s",
  async (theme) => {
    const el = await mountThemed(
      '<wt-initials name="Javier Torres"></wt-initials> Javier Torres',
      theme,
    );
    expect(el.shadowRoot?.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    host.style.color = "var(--wt-color-text)";
    await expectNoA11yViolations(host);
  },
);
