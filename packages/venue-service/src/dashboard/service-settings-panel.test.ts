import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
};

async function mount(
  api: VenueServiceApi,
  subject: "kitchen" | "tables" = "kitchen",
  readOnly = false,
): Promise<ServiceSettingsPanel> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
  el.api = api;
  el.subject = subject;
  el.readOnly = readOnly;
  host.appendChild(el);
  await settle(el);
  return el;
}

it("shows both settings panels to a read-only viewer with every control disabled", async () => {
  const api = {
    loadSettingsReadOnly: vi.fn().mockResolvedValue(model),
    saveSettings: vi.fn(),
    saveClearingWorkflow: vi.fn(),
  } as unknown as VenueServiceApi;
  const kitchen = await mount(api, "kitchen", true);
  const tables = await mount(api, "tables", true);
  expect(api.loadSettingsReadOnly).toHaveBeenCalledTimes(2);
  expect(kitchen.shadowRoot!.querySelector('[data-test="kitchen-changes"]')).not.toBeNull();
  expect(tables.shadowRoot!.querySelector('[data-test="clearing-settings"]')).not.toBeNull();
  for (const panel of [kitchen, tables]) {
    for (const control of panel.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
      "wt-switch, wt-combobox",
    )) {
      expect(control.disabled).toBe(true);
    }
  }
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(api.saveClearingWorkflow).not.toHaveBeenCalled();
});

it("refuses synthetic changes from a read-only viewer even when a control emits them", async () => {
  const api = {
    loadSettingsReadOnly: vi.fn().mockResolvedValue(model),
    saveSettings: vi.fn(),
    saveClearingWorkflow: vi.fn(),
    saveReleaseReminderMinutes: vi.fn(),
    saveKitchenTicketGrouping: vi.fn(),
  } as unknown as VenueServiceApi;
  const kitchen = await mount(api, "kitchen", true);
  const tables = await mount(api, "tables", true);
  const change = (root: ShadowRoot, selector: string, detail: object) => {
    const control = root.querySelector(selector)!;
    control.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
  };
  change(kitchen.shadowRoot!, 'wt-switch[name="editSentLines"]', { checked: false });
  change(kitchen.shadowRoot!, 'wt-combobox[name="releaseReminderMinutes"]', { value: "15" });
  change(kitchen.shadowRoot!, 'wt-combobox[name="kitchenTicketGrouping"]', {
    value: "separate",
  });
  change(tables.shadowRoot!, 'wt-switch[name="clearingWorkflow"]', { checked: true });
  await settle(kitchen);
  await settle(tables);
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(api.saveReleaseReminderMinutes).not.toHaveBeenCalled();
  expect(api.saveKitchenTicketGrouping).not.toHaveBeenCalled();
  expect(api.saveClearingWorkflow).not.toHaveBeenCalled();
});

async function settle(el: ServiceSettingsPanel) {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

type SettingBox = HTMLElement & {
  value: string;
  disabled: boolean;
  label: string;
  hint: string;
  error: string;
  options: { value: string; label: string }[];
};

async function clickChosenRow(box: HTMLElement): Promise<number> {
  const sent = vi.fn();
  box.addEventListener("wt-change", sent);
  await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  const row = box.shadowRoot!.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  expect(row).not.toBeNull();
  await userEvent.click(row!);
  box.removeEventListener("wt-change", sent);
  return sent.mock.calls.length;
}

async function changesHeardOutside(act: () => Promise<void>): Promise<number> {
  const heard = vi.fn();
  document.addEventListener("wt-change", heard);
  try {
    await act();
  } finally {
    document.removeEventListener("wt-change", heard);
  }
  return heard.mock.calls.length;
}

function pageAlert(el: ServiceSettingsPanel) {
  return el.shadowRoot!.querySelector('[data-test="page-alert"]')!.textContent!.trim();
}

type Dropdown = SettingBox & {
  search: string;
  placeholder: string;
};
function dropdown(root: ParentNode, name: string) {
  const box = root.querySelector<Dropdown>(`wt-combobox[name="${name}"]`)!;
  expect(box, name).not.toBeNull();
  return box;
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

describe("the setting for how identical dishes print on a kitchen ticket", () => {
  function groupingSelect(el: ServiceSettingsPanel) {
    const select = el.shadowRoot!.querySelector<SettingBox>(
      'wt-combobox[name="kitchenTicketGrouping"]',
    )!;
    expect(select).not.toBeNull();
    return select;
  }
  function beside(el: ServiceSettingsPanel) {
    return groupingSelect(el).error || undefined;
  }
  function stored(kitchenTicketGrouping: "combined" | "separate"): VenueServiceSettingsView {
    return { ...structuredClone(model), kitchenTicketGrouping };
  }
  async function choose(el: ServiceSettingsPanel, value: string) {
    await chooseOption(groupingSelect(el), value);
    await settle(el);
  }

  // Fails if the select stops reading the stored value, or loses its label, choices or hint.
  it("shows the stored value on the kitchen panel, combined by default", async () => {
    const combined = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const select = groupingSelect(combined);
    expect(select.closest('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(select.label).toContain("Identical dishes on a kitchen ticket");
    expect(select.options.map((option) => [option.value, option.label])).toEqual([
      ["combined", "One line: 3 x Burger"],
      ["separate", "A line each: 1 x Burger, three times"],
    ]);
    expect(select.value).toBe("combined");
    expect(select.hint).toContain("reprints");
    const separate = await mount({
      loadSettings: vi.fn().mockResolvedValue(stored("separate")),
    } as unknown as VenueServiceApi);
    expect(groupingSelect(separate).value).toBe("separate");
  });

  // Fails if the select sends the old value rather than the new one, or stays usable mid-save.
  it("saves the chosen value straight away and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      loadSettings: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(stored("separate")),
      saveKitchenTicketGrouping: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await choose(el, "separate");
    expect(api.saveKitchenTicketGrouping).toHaveBeenCalledWith("separate");
    expect(groupingSelect(el).disabled).toBe(true);
    // A synthetic event can reach a disabled select; it must not start a second write.
    await choose(el, "combined");
    expect(api.saveKitchenTicketGrouping).toHaveBeenCalledTimes(1);
    finish();
    await settle(el);
    expect(api.loadSettings).toHaveBeenCalledTimes(2);
    expect(groupingSelect(el).value).toBe("separate");
    expect(groupingSelect(el).disabled).toBe(false);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if a refused save leaves the select showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the select and at the top of the panel, and shows the stored value again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveKitchenTicketGrouping: vi.fn().mockRejectedValue(new Error("refused")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await choose(el, "separate");
    expect(api.saveKitchenTicketGrouping).toHaveBeenCalledWith("separate");
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(groupingSelect(el).value).toBe("combined");
    expect(
      groupingSelect(el).shadowRoot!.querySelector(".trigger")!.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  // Fails if choosing the grouping already stored saves it again.
  it("saves nothing when the grouping already shown is chosen again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveKitchenTicketGrouping: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    expect(await clickChosenRow(groupingSelect(el))).toBe(1);
    await settle(el);
    expect(api.saveKitchenTicketGrouping).not.toHaveBeenCalled();
    expect(api.loadSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the grouping's change inside the panel", async () => {
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
      saveKitchenTicketGrouping: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi);
    expect(await changesHeardOutside(() => choose(el, "separate"))).toBe(0);
  });

  // Fails if the Spanish catalogue loses the label or a choice.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const select = groupingSelect(el);
    expect(select.label).toContain("Platos iguales en una comanda de cocina");
    expect(select.options.map((option) => option.label)).toEqual([
      "Una línea: 3 x Hamburguesa",
      "Una por plato: 1 x Hamburguesa, tres veces",
    ]);
  });
});

describe("the setting that prints held groups in advance", () => {
  function printSwitch(el: ServiceSettingsPanel) {
    const host = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-switch[name="printHeldWork"]',
    )!;
    expect(host).not.toBeNull();
    return { host, input: host.shadowRoot!.querySelector<HTMLInputElement>('[role="switch"]')! };
  }
  function beside(el: ServiceSettingsPanel) {
    return el.shadowRoot!.querySelector('[data-field-error="printHeldWork"]')?.textContent?.trim();
  }
  function stored(printHeldWork: boolean): VenueServiceSettingsView {
    return { ...structuredClone(model), printHeldWork };
  }

  // Fails if the switch stops reading the stored value, leaves the kitchen changes section, or
  // loses its label or hint.
  it("shows the stored value on the Changes after sending tab, off by default", async () => {
    const off = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const { host, input } = printSwitch(off);
    expect(host.closest('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Print held groups in advance",
    );
    expect(input.checked).toBe(false);
    expect(
      off.shadowRoot!.querySelector('[data-test="print-held-work-hint"]')!.textContent,
    ).toContain("marked HOLD");
    const on = await mount({
      loadSettings: vi.fn().mockResolvedValue(stored(true)),
    } as unknown as VenueServiceApi);
    expect(printSwitch(on).input.checked).toBe(true);
  });

  // Fails if the switch sends the old value rather than the new one, sends it through another
  // setting's save, or stays usable mid-save.
  it("saves the chosen value straight away and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      loadSettings: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(stored(true)),
      savePrintHeldWork: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
      saveSettings: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    printSwitch(el).input.click();
    await settle(el);
    expect(api.savePrintHeldWork).toHaveBeenCalledWith(true);
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(printSwitch(el).host.disabled).toBe(true);
    expect(printSwitch(el).input.disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.loadSettings).toHaveBeenCalledTimes(2);
    expect(printSwitch(el).input.checked).toBe(true);
    expect(printSwitch(el).input.disabled).toBe(false);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if the in-flight guard goes: two changes arriving before the switch is disabled would
  // both be sent.
  it("sends one save for two changes that arrive before the switch is disabled", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      savePrintHeldWork: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const { host } = printSwitch(el);
    for (const checked of [true, false])
      host.dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
      );
    await settle(el);
    expect(api.savePrintHeldWork).toHaveBeenCalledTimes(1);
    expect(api.savePrintHeldWork).toHaveBeenCalledWith(true);
  });

  // Fails if a refused save leaves the switch showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the switch and at the top of the panel, and shows the stored value again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      savePrintHeldWork: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    printSwitch(el).input.click();
    await settle(el);
    expect(api.savePrintHeldWork).toHaveBeenCalledWith(true);
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(printSwitch(el).input.checked).toBe(false);
  });

  // Fails if the Spanish catalogue loses the label or the hint.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(printSwitch(el).host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Imprimir por adelantado los grupos en espera",
    );
    expect(
      el.shadowRoot!.querySelector('[data-test="print-held-work-hint"]')!.textContent,
    ).toContain("marcada HOLD");
  });
});

describe("the setting for the reminder to fire the next group", () => {
  function reminderSelect(el: ServiceSettingsPanel) {
    const select = el.shadowRoot!.querySelector<SettingBox>(
      'wt-combobox[name="releaseReminderMinutes"]',
    )!;
    expect(select).not.toBeNull();
    return select;
  }
  function beside(el: ServiceSettingsPanel) {
    return reminderSelect(el).error || undefined;
  }
  function stored(releaseReminderMinutes: number | null): VenueServiceSettingsView {
    return { ...structuredClone(model), releaseReminderMinutes };
  }
  async function choose(el: ServiceSettingsPanel, value: string) {
    await chooseOption(reminderSelect(el), value);
    await settle(el);
  }

  // Fails if the select stops reading the stored value, leaves the kitchen changes section, or
  // loses its label, choices or hint.
  it("shows the stored value on the Changes after sending tab, ten minutes by default", async () => {
    const ten = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const select = reminderSelect(ten);
    expect(select.closest('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(select.label).toContain("Reminder to fire the next group");
    expect(select.options.map((option) => [option.value, option.label])).toEqual([
      ["", "Off"],
      ["5", "5 minutes"],
      ["10", "10 minutes"],
      ["15", "15 minutes"],
      ["20", "20 minutes"],
      ["30", "30 minutes"],
    ]);
    expect(select.value).toBe("10");
    expect(select.hint).toContain("marked served");
    const off = await mount({
      loadSettings: vi.fn().mockResolvedValue(stored(null)),
    } as unknown as VenueServiceApi);
    expect(reminderSelect(off).value).toBe("");
  });

  // Fails if a stored value outside the list reads as another choice.
  it("keeps a stored value the list does not offer", async () => {
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(stored(45)),
    } as unknown as VenueServiceApi);
    const select = reminderSelect(el);
    expect(select.value).toBe("45");
    expect(select.shadowRoot!.querySelector(".trigger")!.textContent!.trim()).toBe("45 minutes");
  });

  // Fails if the select sends the old value, a string rather than a number, or stays usable mid-save.
  it("saves the chosen minutes straight away, or none for Off, and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      loadSettings: vi
        .fn()
        .mockResolvedValueOnce(model)
        .mockResolvedValueOnce(stored(20))
        .mockResolvedValue(stored(null)),
      saveReleaseReminderMinutes: vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
        .mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await choose(el, "20");
    expect(api.saveReleaseReminderMinutes).toHaveBeenCalledWith(20);
    expect(reminderSelect(el).disabled).toBe(true);
    // A synthetic event can reach a disabled select; it must not start a second write.
    await choose(el, "5");
    expect(api.saveReleaseReminderMinutes).toHaveBeenCalledTimes(1);
    finish();
    await settle(el);
    expect(reminderSelect(el).value).toBe("20");
    expect(reminderSelect(el).disabled).toBe(false);
    await choose(el, "");
    expect(api.saveReleaseReminderMinutes).toHaveBeenLastCalledWith(null);
    expect(api.loadSettings).toHaveBeenCalledTimes(3);
    expect(reminderSelect(el).value).toBe("");
    expect(pageAlert(el)).toBe("");
  });

  // Fails if a refused save leaves the select showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the select and at the top of the panel, and shows the stored value again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveReleaseReminderMinutes: vi.fn().mockRejectedValue(new Error("refused")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await choose(el, "5");
    expect(api.saveReleaseReminderMinutes).toHaveBeenCalledWith(5);
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(reminderSelect(el).value).toBe("10");
    expect(
      reminderSelect(el).shadowRoot!.querySelector(".trigger")!.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  // Fails if choosing the reminder already stored saves it again.
  it("saves nothing when the reminder already shown is chosen again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveReleaseReminderMinutes: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    expect(await clickChosenRow(reminderSelect(el))).toBe(1);
    await settle(el);
    expect(api.saveReleaseReminderMinutes).not.toHaveBeenCalled();
    expect(api.loadSettings).toHaveBeenCalledTimes(1);
  });

  // Fails if Off already stored is saved again: a blank choice must still compare equal to none.
  it("saves nothing when Off is chosen again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(stored(null)),
      saveReleaseReminderMinutes: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    expect(await clickChosenRow(reminderSelect(el))).toBe(1);
    await settle(el);
    expect(api.saveReleaseReminderMinutes).not.toHaveBeenCalled();
  });

  it("keeps the reminder's change inside the panel", async () => {
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
      saveReleaseReminderMinutes: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi);
    expect(await changesHeardOutside(() => choose(el, "5"))).toBe(0);
  });

  // Fails if the Spanish catalogue loses the label or a choice.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const select = reminderSelect(el);
    expect(select.label).toContain("Aviso para marchar el siguiente grupo");
    expect(select.options.map((option) => option.label)).toEqual([
      "Deshabilitado",
      "5 minutos",
      "10 minutos",
      "15 minutos",
      "20 minutos",
      "30 minutos",
    ]);
  });
});

describe("the kitchen panel's fields", () => {
  // Fails if a setting's dropdown loses its search rule, its hint, or Off as the text it shows.
  it("gives the two kitchen settings' dropdowns their hints", async () => {
    const el = await mount({
      loadSettings: vi.fn().mockResolvedValue({ ...model, releaseReminderMinutes: null }),
    } as unknown as VenueServiceApi);
    const grouping = dropdown(el.shadowRoot!, "kitchenTicketGrouping");
    expect([grouping.search, grouping.hint]).toEqual([
      "auto",
      "Applies to new kitchen tickets and to reprints.",
    ]);
    const reminder = dropdown(el.shadowRoot!, "releaseReminderMinutes");
    expect([reminder.search, reminder.placeholder, reminder.value]).toEqual(["auto", "Off", ""]);
    expect(reminder.hint).toContain("marked served");
    expect(reminder.shadowRoot!.querySelector(".trigger")!.textContent!.trim()).toBe("Off");
  });
});

describe("the Needs clearing setting", () => {
  function clearingSwitch(el: ServiceSettingsPanel) {
    const host = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-switch[name="clearingWorkflow"]',
    )!;
    expect(host).not.toBeNull();
    return { host, input: host.shadowRoot!.querySelector<HTMLInputElement>('[role="switch"]')! };
  }
  const withClearing = (clearingWorkflow: boolean): VenueServiceSettingsView => ({
    ...structuredClone(model),
    clearingWorkflow,
  });

  it("shows only the Needs clearing switch on the tables panel, with its hint, off by default", async () => {
    const el = await mount(
      { loadSettings: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi,
      "tables",
    );
    const { host, input } = clearingSwitch(el);
    expect(host.shadowRoot!.querySelector("label")!.textContent).toBe("Needs clearing");
    expect(input.checked).toBe(false);
    expect(
      el.shadowRoot!.querySelector('[data-test="clearing-workflow-hint"]')!.textContent,
    ).toContain("Finish table");
    expect(el.shadowRoot!.querySelector('wt-switch[name="editSentLines"]')).toBeNull();
    expect(el.shadowRoot!.querySelector("h1")).toBeNull();
  });

  it("saves the new value at once, disabled until the save finishes, then shows the stored one", async () => {
    let finish!: () => void;
    const api = {
      loadSettings: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(withClearing(true)),
      saveClearingWorkflow: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    } as unknown as VenueServiceApi;
    const el = await mount(api, "tables");
    clearingSwitch(el).input.click();
    await settle(el);
    expect(api.saveClearingWorkflow).toHaveBeenCalledWith(true);
    expect(clearingSwitch(el).host.disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.loadSettings).toHaveBeenCalledTimes(2);
    expect(clearingSwitch(el).input.checked).toBe(true);
    expect(clearingSwitch(el).host.disabled).toBe(false);
  });

  it("says a refused save failed, beside the switch and at the top, and shows the stored value again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveClearingWorkflow: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api, "tables");
    clearingSwitch(el).input.click();
    await settle(el);
    expect(pageAlert(el)).toContain("could not be saved");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="clearingWorkflow"]')!.textContent,
    ).toContain("could not be saved");
    expect(clearingSwitch(el).input.checked).toBe(false);
  });

  it("follows a change another dashboard makes", async () => {
    const liveData = new LiveData();
    const loadSettings = vi.fn().mockResolvedValue(model);
    const el = await mount({ loadSettings, liveData } as unknown as VenueServiceApi, "tables");
    loadSettings.mockResolvedValue(withClearing(true));
    liveData.invalidate([{ type: "service_settings" }]);
    await vi.waitFor(() => expect(clearingSwitch(el).input.checked).toBe(true));
  });

  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount(
      { loadSettings: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi,
      "tables",
    );
    expect(clearingSwitch(el).host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Por recoger",
    );
    expect(
      el.shadowRoot!.querySelector('[data-test="clearing-workflow-hint"]')!.textContent,
    ).toContain("Cerrar mesa");
  });
});

it("says the settings could not be loaded when the read fails", async () => {
  const el = await mount({
    loadSettings: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as VenueServiceApi);
  expect(pageAlert(el)).toContain("could not be loaded");
});
