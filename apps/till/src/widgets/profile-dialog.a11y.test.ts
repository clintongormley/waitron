import { afterEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
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
  ["a refusal under the profile", { notice: { code: "device_profile.not_admitted" } }],
  ["a refusal naming no field", { notice: { code: "device.payment_in_progress" } }],
  ["an order in progress", { notice: "order_open" }],
  ["an unsaved order change", { notice: "draft_unsaved" }],
  ["an order change refused and replaced", { notice: "draft_replaced" }],
  ["a station the profile does not list", { notice: { code: "station.not_allowed" } }],
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

  it.each([
    ["Switch quiet, the active profile chosen", "pr-counter", true],
    ["Switch ready, another profile chosen", "pr-bar", false],
  ])("has no violations with %s", async (_name, choice, disabled) => {
    setLocale("es-ES");
    const { host, el } = await mountWidget<TillProfileDialog>(
      "till-profile-dialog",
      { open: true, profiles: PROFILES, activeProfileId: "pr-counter" },
      theme,
    );
    await chooseOption(
      el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="profileId"]')!,
      choice,
    );
    await el.updateComplete;
    const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="profile-switch"]',
    )!;
    await button.updateComplete;
    expect(button.disabled).toBe(disabled);
    expect(button.variant).toBe(disabled ? "secondary" : "primary");
    await expectNoA11yViolations(host);
  });
});
