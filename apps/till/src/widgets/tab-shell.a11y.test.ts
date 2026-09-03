import { afterEach, describe, it } from "vitest";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./tab-shell.js";
import type { ShellAffordance, TillTabShell } from "./tab-shell.js";

const tabs: TabDef[] = [
  { key: "counter", title: "Counter", columns: 12, cards: [] },
  { key: "floor", title: "Floor", columns: 12, cards: [] },
];

const affordances: ShellAffordance[] = ["station", "expo", "schedule"];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-tab-shell a11y (%s theme)", (theme) => {
  it("the tab bar + header chrome has no violations", async () => {
    const { host } = await mountWidget<TillTabShell>(
      "till-tab-shell",
      { tabs, activeTabKey: "counter", operatorName: "Ana", affordances },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
