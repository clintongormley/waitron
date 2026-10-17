import { html, render } from "lit";
import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "./test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "./a11y-helpers.js";
import { themeChoices, themeChoicesStyles } from "./theme-choices.js";

afterEach(cleanup);

const labels = { theme: "Theme", light: "Light", dark: "Dark", device: "Follow device" };

describe.each(["light", "dark"] as const)("themeChoices a11y (%s theme)", (theme) => {
  test.each(["light", "dark", "device"] as const)("with %s pressed", async (active) => {
    const el = await mountThemed("<div></div>", theme);
    const root = el.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [themeChoicesStyles.styleSheet!];
    render(html`${themeChoices({ active, labels, onPick: () => {} })}`, root);
    await expectNoA11yViolations(host);
  });
});
