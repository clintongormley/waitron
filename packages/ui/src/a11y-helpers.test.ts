import { afterEach, expect, test } from "vitest";
import axe from "axe-core";
import { cleanup, host, mount } from "./test-helpers.js";
import { expectNoA11yViolations } from "./a11y-helpers.js";
import "./components/wt-button.js";
import "./components/wt-icon.js";

afterEach(cleanup);

// The canary for the whole a11y harness: the markup worth checking lives in shadow roots, so axe
// has to be seen reaching into them.
test("axe traverses into shadow roots: catches an icon-only button with no accessible name", async () => {
  await mount('<wt-button><wt-icon name="close"></wt-icon></wt-button>');
  const results = await axe.run(host);
  const ruleIds = results.violations.map((violation) => violation.id);
  expect(ruleIds).toContain("button-name");
});

test("the same button is clean once aria-label restores its accessible name", async () => {
  await mount('<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>');
  await expectNoA11yViolations(host);
});
