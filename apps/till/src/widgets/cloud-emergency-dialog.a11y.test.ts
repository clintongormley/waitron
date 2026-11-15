import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillCloudEmergencyDialog } from "./cloud-emergency-dialog.js";
let locale = currentLocale();
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("Cloud emergency dialog (%s)", (theme) => {
  it.each([false, true])("has no accessibility violations with roles %s", async (withRoles) => {
    const { host } = await mountWidget<TillCloudEmergencyDialog>(
      "till-cloud-emergency-dialog",
      {
        entrance: {
          address: "https://emergency.example.test",
          roles: withRoles ? [{ builtInKey: "admin", name: null }] : [],
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
