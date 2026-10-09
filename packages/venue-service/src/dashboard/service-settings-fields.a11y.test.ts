import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { ServiceSettingsFields } from "./service-settings-fields.js";

import "./service-settings-fields.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("service fields accessibility (%s)", (theme) => {
  it.each([
    "department",
    "zone",
    "disabled department",
    "disabled zone",
    "errors department",
    "errors zone",
  ])("%s", async (state) => {
    setLocale("en");
    expect(
      customElements.get("dashboard-service-settings-fields"),
      "shared service fields are registered",
    ).toBeDefined();
    const el = (await mountThemed(
      "<dashboard-service-settings-fields></dashboard-service-settings-fields>",
      theme,
    )) as ServiceSettingsFields;
    const department = {
      orderStart: "table",
      paidWhen: "prepay",
      collectionNumber: "numbered",
      receiptPrintMode: "auto",
    } as const;
    el.value = state.includes("zone")
      ? { orderStart: null, paidWhen: null, collectionNumber: null, receiptPrintMode: null }
      : department;
    if (state.includes("zone")) el.follows = department;
    el.disabled = state.includes("disabled");
    if (state.includes("errors"))
      el.errors = {
        orderStart: "Choose how orders start.",
        paidWhen: "Choose when payment happens.",
        collectionNumber: "Choose whether to print a ticket.",
        receiptPrintMode: "Choose when to print receipts.",
      };
    await el.updateComplete;
    await Promise.all(
      [
        ...el.shadowRoot!.querySelectorAll<HTMLElement & { updateComplete: Promise<unknown> }>(
          "wt-combobox, wt-switch",
        ),
      ].map((control) => control.updateComplete),
    );
    await expectNoA11yViolations(host);
  });
});
