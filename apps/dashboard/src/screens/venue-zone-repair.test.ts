import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtCombobox, WtSwitch } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { VenueZoneRepair } from "./venue-zone-repair.js";

const status = {
  nodeId: "node",
  locationId: "location",
  legalName: "Deli Test SL",
  country: "ES",
  province: "08",
  category: "invalid",
  eligible: true,
  clockRevision: 4,
  choices: ["Europe/Madrid", "Atlantic/Canary"],
  suggestion: "Europe/Madrid",
  admission: { state: "invalid" },
  clock: { dayCutover: "06:00", cutoverChanges: [] },
};
const preview = {
  at: "2026-10-14T23:30:00.000Z",
  timeZone: "Europe/Madrid",
  civilDate: "2026-10-15",
  timeOfDay: "01:30:00",
  offsetMinutes: 120,
  businessDay: "2026-10-14",
  dayCutover: "06:00",
};
const repaired = { repaired: true, clockRevision: 5, admission: "restart_required" };
const valid = {
  ...status,
  category: "valid",
  eligible: false,
  timeZone: "Europe/Madrid",
  clockRevision: 5,
  admission: { state: "restart_required" },
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const q = <T extends HTMLElement = HTMLElement>(el: VenueZoneRepair, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector)!;
async function change(el: VenueZoneRepair, name: string, value: string | boolean) {
  q(el, `[name=${name}]`).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
async function mount(
  overrides: Record<string, unknown> = {},
  props: Partial<VenueZoneRepair> = {},
) {
  const api = {
    getVenueZoneRepair: vi.fn(async (zone?: string) =>
      zone ? { ...status, preview: { ...preview, timeZone: zone } } : status,
    ),
    confirmVenueZone: vi.fn().mockResolvedValue(repaired),
    ...overrides,
  } as unknown as DashboardApi;
  const { el, host } = await mountWidget<VenueZoneRepair>("dashboard-venue-zone-repair", {
    api,
    canConfigure: true,
    admission: { state: "invalid" },
    ...props,
  });
  await expect.poll(() => q(el, "[name=timeZone]")).not.toBeNull();
  return { el, api, host };
}
async function ready(el: VenueZoneRepair) {
  await change(el, "timeZone", "Europe/Madrid");
  await expect.poll(() => q(el, "[data-test=preview]")).not.toBeNull();
  await change(el, "confirmed", true);
}
async function save(el: VenueZoneRepair) {
  await userEvent.click(q(el, "[data-test=save]"));
}
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
  vi.restoreAllMocks();
});

describe("zone confirmation", () => {
  it("keeps the geographic suggestion unselected and Save quiet until edited", async () => {
    const { el, api } = await mount();
    expect(q<WtCombobox>(el, "[name=timeZone]").value).toBe("");
    expect(q<WtCombobox>(el, "[name=timeZone]").options.map((x) => x.value)).toEqual([
      "Europe/Madrid",
      "Atlantic/Canary",
    ]);
    expect(
      q<WtSwitch>(el, "[name=confirmed]").shadowRoot!.querySelector<HTMLInputElement>("input")!
        .checked,
    ).toBe(false);
    expect(q(el, "[data-test=suggestion]").textContent).toContain("Europe/Madrid");
    expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(true);
    expect(q<WtButton>(el, "[data-test=save]").variant).toBe("secondary");
    expect(api.confirmVenueZone).not.toHaveBeenCalled();
  });
  it("shows civil date, numerical offset and the separate retained business date", async () => {
    const { el } = await mount();
    await ready(el);
    const text = q(el, "[data-test=preview]").textContent!;
    for (const value of ["2026-10-15", "01:30", "+120", "2026-10-14", "06:00"])
      expect(text).toContain(value);
    expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(false);
  });
  it("marks both missing fields, focuses the first and holds Save only until corrected", async () => {
    const { el, api } = await mount();
    await change(el, "timeZone", "Invalid/Zone");
    q(el, "form").dispatchEvent(new Event("submit", { cancelable: true }));
    await el.updateComplete;
    expect(q<WtCombobox>(el, "[name=timeZone]").error).not.toBe("");
    expect(q(el, "[data-test=confirmation-error]").textContent?.trim()).not.toBe("");
    expect(q(el, "wt-form-actions").getAttribute("error")).toBe(t("form.fix_fields"));
    expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[name=timeZone]"));
    expect(api.confirmVenueZone).not.toHaveBeenCalled();
    await ready(el);
    expect(q<WtCombobox>(el, "[name=timeZone]").error).toBe("");
    expect(q(el, "[data-test=confirmation-error]")).toBeNull();
    expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(false);
  });
  it("sends only the choice, revision and explicit confirmation once, then retires the draft", async () => {
    const pending = deferred<typeof repaired>();
    const { el, api } = await mount({
      confirmVenueZone: vi.fn(() => pending.promise),
      getVenueZoneRepair: vi.fn(async (zone?: string) => (zone ? { ...status, preview } : status)),
    });
    await ready(el);
    await save(el);
    q(el, "form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(api.confirmVenueZone).toHaveBeenCalledExactlyOnceWith({
      timeZone: "Europe/Madrid",
      expectedClockRevision: 4,
      confirmed: true,
    });
    pending.resolve(repaired);
    await expect.poll(() => q(el, "[data-test=restart]")).not.toBeNull();
    expect(q(el, "[name=timeZone]")).toBeNull();
    expect(q(el, "[data-test=save]")).toBeNull();
  });
  it("leaves request refusals retryable without another edit", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce({
        code: "venue.time_zone_conversion_failed",
        params: { reason: "unreadable_offset" },
        status: 409,
      })
      .mockResolvedValue(repaired);
    const { el } = await mount({ confirmVenueZone: write });
    await ready(el);
    await save(el);
    await expect.poll(() => q<WtButton>(el, "[data-test=save]")?.disabled).toBe(false);
    expect(q(el, "wt-form-actions").getAttribute("error")).not.toBe("");
    await save(el);
    await expect.poll(() => write.mock.calls.length).toBe(2);
    await expect.poll(() => q(el, "[data-test=restart]")).not.toBeNull();
  });
  it("reads status after a lost reply and never offers a second confirmation for a valid saved zone", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce({ ...status, preview })
      .mockResolvedValue(valid);
    const { el, api } = await mount({
      getVenueZoneRepair: read,
      confirmVenueZone: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    await ready(el);
    await save(el);
    await expect.poll(() => q(el, "[data-test=restart]")).not.toBeNull();
    expect(read).toHaveBeenLastCalledWith();
    expect(api.confirmVenueZone).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=save]")).toBeNull();
  });
  it("requires a successful status read after an ambiguous reply before retrying Save", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce({ ...status, preview })
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue(status);
    const { el, api } = await mount({
      getVenueZoneRepair: read,
      confirmVenueZone: vi.fn().mockRejectedValue({ code: "connection.timed_out" }),
    });
    await ready(el);
    await save(el);
    await expect.poll(() => q(el, "[data-test=load-error]")).not.toBeNull();
    expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(true);
    await userEvent.click(q(el, "[data-test=retry-status]"));
    await expect.poll(() => q<WtButton>(el, "[data-test=save]")?.disabled).toBe(false);
    expect(api.confirmVenueZone).toHaveBeenCalledTimes(1);
  });
  it("reports a post-save refresh failure as a load failure while keeping the editor closed", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce({ ...status, preview })
      .mockRejectedValue({ code: "connection.failed" });
    const { el, api } = await mount({ getVenueZoneRepair: read });
    await ready(el);
    await save(el);
    await expect.poll(() => q(el, "[data-test=load-error]")).not.toBeNull();
    expect(q(el, "[data-test=restart]")).not.toBeNull();
    expect(q(el, "[data-test=save]")).toBeNull();
    expect(api.confirmVenueZone).toHaveBeenCalledTimes(1);
  });
  it("ignores an older preview and requires confirmation again after changing choice", async () => {
    const old = deferred<object>();
    const read = vi.fn(async (zone?: string) =>
      zone === "Europe/Madrid"
        ? old.promise
        : zone
          ? {
              ...status,
              preview: { ...preview, timeZone: zone, offsetMinutes: 60, timeOfDay: "00:30:00" },
            }
          : status,
    );
    const { el } = await mount({ getVenueZoneRepair: read });
    await change(el, "timeZone", "Europe/Madrid");
    await change(el, "confirmed", true);
    await change(el, "timeZone", "Atlantic/Canary");
    await expect.poll(() => q(el, "[data-test=preview]")?.textContent).toContain("00:30");
    old.resolve({ ...status, preview });
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(q(el, "[data-test=preview]").textContent).not.toContain("01:30");
    expect(q<WtSwitch>(el, "[name=confirmed]").checked).toBe(false);
  });
  it("drops late manager context after permission is revoked", async () => {
    const old = deferred<object>();
    const read = vi.fn(() => old.promise);
    const api = { getVenueZoneRepair: read } as unknown as DashboardApi;
    const { el } = await mountWidget<VenueZoneRepair>("dashboard-venue-zone-repair", {
      api,
      canConfigure: true,
      admission: { state: "invalid" },
    });
    await expect.poll(() => read.mock.calls.length).toBe(1);
    el.canConfigure = false;
    await el.updateComplete;
    old.resolve(status);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(q(el, "form")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("zone_repair.explanation"));
  });
  it("does not submit after removing the screen while a preview is pending", async () => {
    const old = deferred<object>();
    const read = vi
      .fn()
      .mockResolvedValueOnce(status)
      .mockImplementation(() => old.promise);
    const { el, api } = await mount({ getVenueZoneRepair: read });
    await change(el, "timeZone", "Europe/Madrid");
    el.remove();
    old.resolve({ ...status, preview });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmVenueZone).not.toHaveBeenCalled();
  });
});

it("replaces the missing-zone explanation with saved status after confirmation", async () => {
  const { el } = await mount();
  await ready(el);
  await save(el);
  await expect.poll(() => q(el, "[data-test=restart]")).not.toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain(t("zone_repair.explanation"));
});

it("explains a conversion refusal and still allows the same draft to be retried", async () => {
  const { el } = await mount({
    confirmVenueZone: vi
      .fn()
      .mockRejectedValue({ code: "venue.time_zone_conversion_failed", status: 409 }),
  });
  await ready(el);
  await save(el);
  await expect
    .poll(() => q(el, "wt-form-actions").getAttribute("error"))
    .toBe(t("zone_repair.conversion_failed"));
  expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(false);
});
it("chooses and confirms with the keyboard, then submits from the native Save button", async () => {
  const { el, api } = await mount();
  const combo = q<WtCombobox>(el, "[name=timeZone]");
  combo.focus();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.poll(() => q(el, "[data-test=preview]")).not.toBeNull();
  const checkbox = q<WtSwitch>(el, "[name=confirmed]").shadowRoot!.querySelector<HTMLInputElement>(
    "input",
  )!;
  checkbox.focus();
  await userEvent.keyboard(" ");
  expect(checkbox.checked).toBe(true);
  q<WtButton>(el, "[data-test=save]")
    .shadowRoot!.querySelector<HTMLButtonElement>("button")!
    .focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => api.confirmVenueZone).toHaveBeenCalledTimes(1);
});
it("refreshes a stale revision, clears confirmation and sends the new revision on retry", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, preview })
    .mockResolvedValue({ ...status, clockRevision: 6, preview });
  const write = vi
    .fn()
    .mockRejectedValueOnce({ code: "venue.business_day_changed", status: 409 })
    .mockResolvedValue(repaired);
  const { el } = await mount({ getVenueZoneRepair: read, confirmVenueZone: write });
  await ready(el);
  await save(el);
  await expect.poll(() => read.mock.calls.length).toBe(4);
  expect(q<WtSwitch>(el, "[name=confirmed]").checked).toBe(false);
  await change(el, "confirmed", true);
  await save(el);
  await expect.poll(() => write.mock.calls.length).toBe(2);
  expect(write.mock.calls[1]).toEqual([
    { timeZone: "Europe/Madrid", expectedClockRevision: 6, confirmed: true },
  ]);
});

it("keeps an unchanged host click quiet and shows no missing-zone claim while admission is unchecked", async () => {
  const { el, api } = await mount();
  q(el, "[data-test=save]").click();
  await el.updateComplete;
  expect(q<WtCombobox>(el, "[name=timeZone]").error).toBe("");
  expect(q(el, "[data-test=confirmation-error]")).toBeNull();
  expect(api.confirmVenueZone).not.toHaveBeenCalled();
  el.admission = { state: "unchecked" };
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain(t("zone_repair.explanation"));
  expect(el.shadowRoot!.textContent).toContain(t("venue.time_zone_wait"));
});
it("keeps a zone refusal beside its field through an unrelated confirmation edit", async () => {
  const { el } = await mount({
    confirmVenueZone: vi.fn().mockRejectedValue({
      code: "venue.time_zone_invalid",
      params: { field: "timeZone" },
      status: 400,
    }),
  });
  await ready(el);
  await save(el);
  await expect
    .poll(() => q<WtCombobox>(el, "[name=timeZone]").error)
    .toBe(t("zone_repair.invalid_zone"));
  await change(el, "confirmed", false);
  expect(q<WtCombobox>(el, "[name=timeZone]").error).toBe(t("zone_repair.invalid_zone"));
  await change(el, "timeZone", "Atlantic/Canary");
  expect(q<WtCombobox>(el, "[name=timeZone]").error).toBe("");
});
it("retains a request refusal together with new validation messages until the next submission", async () => {
  const { el } = await mount({
    confirmVenueZone: vi
      .fn()
      .mockRejectedValue({ code: "venue.time_zone_conversion_failed", status: 409 }),
  });
  await ready(el);
  await save(el);
  await expect
    .poll(() => q(el, "wt-form-actions").getAttribute("error"))
    .toBe(t("zone_repair.conversion_failed"));
  await change(el, "confirmed", false);
  const message = q(el, "wt-form-actions").getAttribute("error")!;
  expect(message).toContain(t("form.fix_fields"));
  expect(message).toContain(t("zone_repair.conversion_failed"));
});
it("resolves a lost confirmation after normal boot removes the repair-only route", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, preview })
    .mockRejectedValue({ code: "server.internal", status: 404 });
  const me = vi.fn().mockResolvedValue({ tradingAdmission: { state: "ready" } });
  const { el, api } = await mount({
    getVenueZoneRepair: read,
    getMe: me,
    confirmVenueZone: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  await ready(el);
  await save(el);
  await expect.poll(() => q(el, "[data-test=restart]")).not.toBeNull();
  expect(me).toHaveBeenCalledTimes(1);
  expect(api.confirmVenueZone).toHaveBeenCalledTimes(1);
  expect(q(el, "[data-test=save]")).toBeNull();
});
it("does not treat a missing repair route as a saved zone when admission is still closed", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, preview })
    .mockRejectedValue({ code: "server.internal", status: 404 });
  const { el } = await mount({
    getVenueZoneRepair: read,
    getMe: vi.fn().mockResolvedValue({ tradingAdmission: { state: "invalid" } }),
    confirmVenueZone: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  await ready(el);
  await save(el);
  await expect.poll(() => q(el, "[data-test=load-error]")).not.toBeNull();
  expect(q(el, "[data-test=restart]")).toBeNull();
  expect(q<WtButton>(el, "[data-test=save]").disabled).toBe(true);
});
