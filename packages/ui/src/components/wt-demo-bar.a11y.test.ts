import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtDemoBar } from "./wt-demo-bar.js";
import "./wt-demo-bar.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-demo-bar a11y (%s theme)", (theme) => {
  test.each(["Demo", "Preparation"])("%s navigation", async (modeLabel) => {
    const el = (await mountThemed("<wt-demo-bar></wt-demo-bar>", theme)) as WtDemoBar;
    el.modeLabel = modeLabel;
    el.navigationLabel = `${modeLabel} navigation`;
    el.links = [
      { label: "Dashboard", href: "/manage", current: true },
      { label: "Device", href: "/" },
      { label: "Email inbox", href: "/manage/email" },
    ];
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
