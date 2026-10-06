import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./profile-dialog.js";
import type { TillProfileDialog } from "./profile-dialog.js";

afterEach(cleanupWidgets);

const PROFILES = [
  { id: "pr-counter", name: "Counter till" },
  { id: "pr-bar", name: "Bar till" },
];

const STATES: [string, Partial<TillProfileDialog>][] = [
  ["the active profile chosen", {}],
  ["a refusal under the profile", { error: { code: "device_profile.not_admitted" } }],
  ["a refusal naming no field", { error: { code: "device.payment_in_progress" } }],
  ["an order in progress", { orderOpen: true }],
  ["a switch out", { busy: true }],
];

describe.each(["light", "dark"] as const)("till-profile-dialog a11y (%s theme)", (theme) => {
  it.each(STATES)("has no violations with %s", async (_name, props) => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillProfileDialog>(
      "till-profile-dialog",
      { open: true, profiles: PROFILES, activeProfileId: "pr-counter", ...props },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
