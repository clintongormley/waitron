import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./make-now.js";
import type { TillMakeNow } from "./make-now.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-make-now a11y (%s)", (theme) => {
  it("has an accessible heading and Done action", async () => {
    const { el, host } = await mountWidget<TillMakeNow>(
      "till-make-now",
      {
        items: [
          {
            lineId: "lager",
            name: "Lager",
            quantity: "2.000",
            unitName: null,
            soldInEach: true,
            optionSnapshots: [],
            extras: ["Lime"],
            note: null,
          },
        ],
      },
      theme,
    );
    expect(el.shadowRoot!.querySelector("h2")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
