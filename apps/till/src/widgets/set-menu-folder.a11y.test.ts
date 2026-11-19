import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { courses, daily } from "../../test/set-menu-widgets.js";
import { TillSetMenuFolder } from "./set-menu-folder.js";

afterEach(cleanupWidgets);

it.each(["light", "dark"] as const)("the set-menu folder is accessible in %s", async (theme) => {
  const { el, host } = await mountWidget<TillSetMenuFolder>(
    "till-set-menu-folder",
    { copy: daily, versionId: "lunch", courseNames: courses },
    theme,
  );
  expect(el.shadowRoot?.querySelectorAll("h3")).toHaveLength(3);
  expect(el.shadowRoot?.querySelector("wt-button[disabled]")?.textContent).toContain("Sold out");
  await expectNoA11yViolations(host);
});
