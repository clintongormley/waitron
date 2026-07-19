import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-switch.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-switch a11y (%s theme)", (theme) => {
  test("unchecked", async () => {
    await mountThemed('<wt-switch label="Modo formación"></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });

  test("checked", async () => {
    await mountThemed('<wt-switch label="Activado" checked></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed('<wt-switch label="Activado" disabled></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });
});
