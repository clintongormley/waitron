import { afterEach, expect, test } from "vitest";
import axe from "axe-core";
import { cleanup, host, mount } from "./test-helpers.js";
import { expectNoA11yViolations } from "./a11y-helpers.js";
import "./components/wt-button.js";
import "./components/wt-icon.js";

afterEach(cleanup);

// This is the canary for the whole a11y harness. All the interesting markup in these components
// lives inside shadow roots (wt-button's <button>, wt-icon's aria-hidden <svg>, ...). If axe.run()
// were only looking at light DOM, an icon-only button with no accessible name would report zero
// violations — a green suite that never actually checked anything. Proven empirically here: mount
// a component with a deliberately broken accessible name, assert axe actually reports it.
test("axe traverses into shadow roots: catches an icon-only button with no accessible name", async () => {
  // wt-icon's <svg> is aria-hidden and there's no text content, so an icon-only wt-button with no
  // aria-label has no accessible name at all — axe's "button-name" rule exists precisely for this.
  await mount('<wt-button><wt-icon name="close"></wt-icon></wt-button>');
  const results = await axe.run(host);
  const ruleIds = results.violations.map((violation) => violation.id);
  expect(ruleIds).toContain("button-name");
});

test("the same button is clean once aria-label restores its accessible name", async () => {
  await mount('<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>');
  await expectNoA11yViolations(host);
});
