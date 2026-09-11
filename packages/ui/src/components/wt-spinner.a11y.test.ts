import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-spinner.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-spinner a11y (%s theme)", (theme) => {
  test.each(["sm", "md", "lg"] as const)("%s status spinner", async (size) => {
    await mountThemed(`<wt-spinner size="${size}"></wt-spinner>`, theme);
    await expectNoA11yViolations(host);
  });

  test("status spinner with a localized label", async () => {
    await mountThemed('<wt-spinner label="Buscando"></wt-spinner>', theme);
    await expectNoA11yViolations(host);
  });

  test("decorative spinner (as inside a busy control)", async () => {
    await mountThemed("<wt-spinner decorative></wt-spinner>", theme);
    await expectNoA11yViolations(host);
  });
});
