import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpSwitch } from "./wt-help-switch.js";
import "./wt-help-switch.js";

afterEach(cleanup);
afterEach(() => setHelpMode(false));

describe.each(["light", "dark"] as const)("wt-help-switch a11y (%s theme)", (theme) => {
  test("help off", async () => {
    await mountThemed("<wt-help-switch></wt-help-switch>", theme);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });

  test("help on", async () => {
    const el = (await mountThemed("<wt-help-switch></wt-help-switch>", theme)) as WtHelpSwitch;
    setHelpMode(true);
    await el.updateComplete;
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
