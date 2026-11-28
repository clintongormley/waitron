import { afterEach, describe, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "./wt-choice-tile.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-choice-tile (%s)", (theme) => {
  test("pills", async () => {
    await mountThemed(
      `<div>
        <wt-choice-tile variant="pill" label="Bill 1" selected></wt-choice-tile>
        <wt-choice-tile variant="pill" label="New bill"></wt-choice-tile>
        <wt-choice-tile variant="pill" label="Bill 2" disabled></wt-choice-tile>
      </div>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });
  test.each(["start", "end", "none"])("%s check", async (position) => {
    await mountThemed(
      `<div>
        <wt-choice-tile check-position="${position}" label="Whole bill" hint="€73.20" selected></wt-choice-tile>
        <wt-choice-tile check-position="${position}" label="Split equally" hint="Between guests"></wt-choice-tile>
        <wt-choice-tile check-position="${position}" label="Items" disabled></wt-choice-tile>
      </div>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
