import { afterEach, expect, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "./wt-initials.js";

afterEach(cleanup);

test.each([
  ["light", "md"],
  ["light", "lg"],
  ["dark", "md"],
  ["dark", "lg"],
] as const)("keeps the visible initials decorative in %s at size %s", async (theme, size) => {
  const el = await mountThemed(
    `<wt-initials name="Javier Torres" size="${size}"></wt-initials> Javier Torres`,
    theme,
  );
  expect(el.shadowRoot?.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
  host.style.color = "var(--wt-color-text)";
  await expectNoA11yViolations(host);
});
