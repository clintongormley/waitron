import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";
import "./service-settings-panel.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const model: VenueServiceSettingsView = {
  settings: { editSentLines: true },
};

async function mount(api: VenueServiceApi, readOnly = false): Promise<ServiceSettingsPanel> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
  el.api = api;
  el.readOnly = readOnly;
  host.appendChild(el);
  await settle(el);
  return el;
}

it("shows the settings panel to a read-only viewer with every control disabled", async () => {
  const api = {
    loadSettingsReadOnly: vi.fn().mockResolvedValue(model),
    saveSettings: vi.fn(),
  } as unknown as VenueServiceApi;
  const kitchen = await mount(api, true);
  expect(api.loadSettingsReadOnly).toHaveBeenCalledTimes(1);
  expect(kitchen.shadowRoot!.querySelector('[data-test="kitchen-changes"]')).not.toBeNull();
  for (const control of kitchen.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
    "wt-switch, wt-combobox",
  )) {
    expect(control.disabled).toBe(true);
  }
  expect(api.saveSettings).not.toHaveBeenCalled();
});

it("refuses synthetic changes from a read-only viewer even when a control emits them", async () => {
  const api = {
    loadSettingsReadOnly: vi.fn().mockResolvedValue(model),
    saveSettings: vi.fn(),
  } as unknown as VenueServiceApi;
  const kitchen = await mount(api, true);
  const change = (root: ShadowRoot, selector: string, detail: object) => {
    const control = root.querySelector(selector)!;
    control.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
  };
  change(kitchen.shadowRoot!, 'wt-switch[name="editSentLines"]', { checked: false });
  await settle(kitchen);
  expect(api.saveSettings).not.toHaveBeenCalled();
});

async function settle(el: ServiceSettingsPanel) {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function pageAlert(el: ServiceSettingsPanel) {
  return el.shadowRoot!.querySelector('[data-test="page-alert"]')!.textContent!.trim();
}

describe("the setting that allows changes to items already sent to the kitchen", () => {
  function kitchenSwitch(el: ServiceSettingsPanel) {
    const host = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-switch[name="editSentLines"]',
    )!;
    expect(host).not.toBeNull();
    return { host, input: host.shadowRoot!.querySelector<HTMLInputElement>('[role="switch"]')! };
  }
  function beside(el: ServiceSettingsPanel) {
    return el.shadowRoot!.querySelector('[data-field-error="editSentLines"]')?.textContent?.trim();
  }
  function withSetting(editSentLines: boolean): VenueServiceSettingsView {
    return { ...structuredClone(model), settings: { editSentLines } };
  }

  // Fails if the switch stops reading the stored value, or loses its label or hint.
  it("shows the stored value on the kitchen panel, on by default", async () => {
    const on = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const { host, input } = kitchenSwitch(on);
    expect(host.closest('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Allow changes to items already sent to the kitchen",
    );
    expect(input.checked).toBe(true);
    expect(
      on.shadowRoot!.querySelector('[data-test="edit-sent-lines-hint"]')!.textContent,
    ).toContain("cancel it instead");
    const off = await mount({
      loadSettings: vi.fn().mockResolvedValue(withSetting(false)),
    } as unknown as VenueServiceApi);
    expect(kitchenSwitch(off).input.checked).toBe(false);
  });

  // Fails if the switch sends the old value rather than the new one, or stays usable mid-save.
  it("saves the chosen value straight away and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      loadSettings: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(withSetting(false)),
      saveSettings: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    kitchenSwitch(el).input.click();
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledWith({ editSentLines: false });
    expect(kitchenSwitch(el).host.disabled).toBe(true);
    expect(kitchenSwitch(el).input.disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.loadSettings).toHaveBeenCalledTimes(2);
    expect(kitchenSwitch(el).input.checked).toBe(false);
    expect(kitchenSwitch(el).input.disabled).toBe(false);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if the in-flight guard goes: two changes arriving before the switch is disabled would
  // both be sent.
  it("sends one save for two changes that arrive before the switch is disabled", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveSettings: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const { host } = kitchenSwitch(el);
    for (const checked of [false, true])
      host.dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
      );
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ editSentLines: false });
  });

  // Fails if a refused save leaves the switch showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the switch and at the top of the panel, and shows the stored value again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveSettings: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    kitchenSwitch(el).input.click();
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledWith({ editSentLines: false });
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(kitchenSwitch(el).input.checked).toBe(true);
  });

  // Fails if a refresh failing after a stored change is reported as a failed save, or the switch
  // falls back to the value from before the save.
  it("reports a failed refresh after a stored change as a load failure, and keeps the stored value", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValueOnce(model).mockRejectedValue(new Error("offline")),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    kitchenSwitch(el).input.click();
    await settle(el);
    expect(api.loadSettings).toHaveBeenCalledTimes(2);
    expect(pageAlert(el)).toContain("could not be loaded");
    expect(pageAlert(el)).not.toContain("could not be saved");
    expect(beside(el)).toBeUndefined();
    expect(kitchenSwitch(el).input.checked).toBe(false);
  });

  // Fails if the panel's live query stops depending on the settings table.
  it("follows a change another dashboard makes", async () => {
    const liveData = new LiveData();
    const loadSettings = vi.fn().mockResolvedValue(model);
    const el = await mount({ loadSettings, liveData } as unknown as VenueServiceApi);
    expect(kitchenSwitch(el).input.checked).toBe(true);
    loadSettings.mockResolvedValue(withSetting(false));
    liveData.invalidate([{ type: "service_settings" }]);
    await vi.waitFor(() => expect(kitchenSwitch(el).input.checked).toBe(false));
  });

  // Fails if the Spanish catalogue loses the label.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(kitchenSwitch(el).host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Permitir cambios en los artículos ya enviados a cocina",
    );
  });
});

describe("the kitchen panel's fields", () => {
  // Fails if a printing choice that is now each station's own comes back to the Kitchen tab.
  it("the Kitchen tab's venue-service panel offers only Changes after sending", async () => {
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const root = el.shadowRoot!;
    expect([...root.querySelectorAll("wt-switch")].map((s) => s.getAttribute("name"))).toEqual([
      "editSentLines",
    ]);
    expect(root.querySelector("wt-combobox")).toBeNull();
    expect(root.querySelector('[data-test="print-held-work-hint"]')).toBeNull();
    expect(root.querySelector('[data-test="print-moved-slips-hint"]')).toBeNull();
  });

  it("the Kitchen tab draws no reminder", async () => {
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(el.shadowRoot!.querySelector('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('wt-combobox[name="releaseReminderMinutes"]')).toBeNull();
  });
});

it("says the settings could not be loaded when the read fails", async () => {
  const el = await mount({
    loadSettings: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as VenueServiceApi);
  expect(pageAlert(el)).toContain("could not be loaded");
});
