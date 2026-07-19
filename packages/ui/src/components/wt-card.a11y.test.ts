import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-card.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-card a11y (%s theme)", (theme) => {
  test("plain card", async () => {
    await mountThemed("<wt-card>Contenido</wt-card>", theme);
    await expectNoA11yViolations(host);
  });

  test("raised card with header", async () => {
    await mountThemed(
      '<wt-card raised><span slot="header">Ticket</span>Contenido</wt-card>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
