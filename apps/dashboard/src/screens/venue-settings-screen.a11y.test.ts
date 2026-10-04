import { html } from "lit";
import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./venue-settings-screen.js";
import type { VenueSettingsScreen } from "./venue-settings-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("venue settings a11y (%s theme)", (theme) => {
  it("renders accessibly with two tabs", async () => {
    const { el, host } = await mountWidget<VenueSettingsScreen>(
      "dashboard-venue-settings-screen",
      {
        panels: [
          {
            key: "r",
            tab: "receipts",
            render: () =>
              html`<h2>Receipt text</h2>
                <p>Body</p>`,
          },
          { key: "k", tab: "kitchen", render: () => html`<h2>Courses</h2>` },
        ],
      },
      theme,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
