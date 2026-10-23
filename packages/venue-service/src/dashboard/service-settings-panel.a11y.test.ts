import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";
import "./service-settings-panel.js";

afterEach(cleanup);
const model: VenueServiceSettingsView = {
  settings: { editSentLines: true },
};

describe.each(["light", "dark"] as const)("kitchen changes setting accessibility (%s)", (theme) => {
  test.each([
    ["stored", undefined],
    ["refused", new Error("offline")],
  ] as const)("the switch and its hint, %s", async (_state, refusal) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
    el.api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveSettings: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    if (refusal) {
      el.shadowRoot!.querySelector("wt-switch")!.shadowRoot!.querySelector("input")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-field-error="editSentLines"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});
