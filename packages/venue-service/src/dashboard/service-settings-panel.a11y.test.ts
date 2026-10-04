import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption, cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";
import "./service-settings-panel.js";

afterEach(cleanup);
const model: VenueServiceSettingsView = {
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
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

describe.each(["light", "dark"] as const)(
  "kitchen ticket grouping setting accessibility (%s)",
  (theme) => {
    test.each([
      ["stored", undefined],
      ["refused", new Error("refused")],
    ] as const)("the select and its hint, %s", async (_state, refusal) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
      el.api = {
        loadSettings: vi.fn().mockResolvedValue(model),
        saveKitchenTicketGrouping: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
      } as unknown as VenueServiceApi;
      host.append(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      const select = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        'wt-combobox[name="kitchenTicketGrouping"]',
      )!;
      expect(select).not.toBeNull();
      if (refusal) {
        await chooseOption(select, "separate");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(select.error).not.toBe("");
      }
      await expectNoA11yViolations(host);
    });
  },
);

describe.each(["light", "dark"] as const)("print held work setting accessibility (%s)", (theme) => {
  test.each([
    ["stored", undefined],
    ["refused", new Error("offline")],
  ] as const)("the switch and its hint, %s", async (_state, refusal) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
    el.api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      savePrintHeldWork: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const toggle = el.shadowRoot!.querySelector('wt-switch[name="printHeldWork"]');
    expect(toggle).not.toBeNull();
    if (refusal) {
      toggle!.shadowRoot!.querySelector("input")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-field-error="printHeldWork"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "release reminder setting accessibility (%s)",
  (theme) => {
    test.each([
      ["stored", undefined],
      ["refused", new Error("offline")],
    ] as const)("the select and its hint, %s", async (_state, refusal) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
      el.api = {
        loadSettings: vi.fn().mockResolvedValue(model),
        saveReleaseReminderMinutes: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
      } as unknown as VenueServiceApi;
      host.append(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      const select = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        'wt-combobox[name="releaseReminderMinutes"]',
      )!;
      expect(select).not.toBeNull();
      if (refusal) {
        await chooseOption(select, "5");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(select.error).not.toBe("");
      }
      await expectNoA11yViolations(host);
    });
  },
);

describe.each(["light", "dark"] as const)("tables panel accessibility (%s)", (theme) => {
  test("has no violations", async () => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
    el.api = { loadSettings: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi;
    el.subject = "tables";
    host.append(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
