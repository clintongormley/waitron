import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, DeviceProfile } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import "./device-profiles-screen.js";

const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

function fixture(formFactor: DeviceProfile["formFactor"] = "till") {
  let profile: DeviceProfile = {
    id: "clock-profile",
    name: "Counter",
    canvasId: null,
    capabilities: [],
    formFactor,
    inactivityTimeoutSeconds: null,
    startingScreen: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    allowedZoneIds: null,
    admittedRoles: ["staff", "supervisor", "manager", "admin"],
    personExceptions: [],
    departmentId: "d1",
    startingZoneId: "z1",
  };
  const api = {
    listDeviceProfiles: vi.fn(async () => [profile]),
    getDeviceProfile: vi.fn(async () => profile),
    updateDeviceProfile: vi.fn(
      async (_id: string, _name: string, _canvas: string | null, capabilities: string[]) => {
        profile = { ...profile, capabilities };
        return profile;
      },
    ),
    listCanvases: vi.fn(async () => []),
    listPrinters: vi.fn(async () => []),
    listStations: vi.fn(async () => []),
    listProfileKitchenScreens: vi.fn(async () => []),
    getProfileScopeChoices: vi.fn(async () => ({
      departments: [{ id: "d1", name: "Restaurant", active: true }],
      zones: [{ id: "z1", name: "Counter", departmentId: "d1", active: true }],
    })),
    listStaff: vi.fn(async () => []),
    listReaders: vi.fn(async () => []),
    getProfileReaders: vi.fn(async () => ({ readerIds: [], defaultReaderId: null })),
    setProfileReaders: vi.fn(async () => ({ readerIds: [], defaultReaderId: null })),
  };
  return { api: api as unknown as DashboardApi, profile: () => profile };
}

async function editor(api: DashboardApi) {
  const { el } = await mountWidget<DeviceProfilesScreen>("dashboard-device-profiles-screen", {
    api,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=edit-clock-profile]")).not.toBeNull(),
  );
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-clock-profile]")!,
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=profile-save]")).not.toBeNull(),
  );
  return el;
}

describe("clock-in profile action", () => {
  it.each([
    ["en-GB", "Clock in"],
    ["es-ES", "Fichar"],
  ])(
    "offers Clock in only in Actions, saves its native switch and clears the draft (%s)",
    async (locale, label) => {
      setLocale(locale!);
      const f = fixture();
      const el = await editor(f.api);
      const clock = el.shadowRoot!.querySelector<HTMLElement>("[data-test=cap-clock-in]");
      expect(clock).not.toBeNull();
      expect(clock!.closest("[data-test=profile-actions]")).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector("[data-test=profile-screens] [data-test=cap-clock-in]"),
      ).toBeNull();
      expect(clock!.getAttribute("label")).toBe(label);
      const input = clock!.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      expect(input.checked).toBe(false);
      await userEvent.click(input);
      await el.updateComplete;
      const save = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-test=profile-save]",
      )!;
      expect(save.disabled).toBe(false);
      await userEvent.click(save);
      await vi.waitFor(() => expect(f.profile().capabilities).toEqual(["clock-in"]));
      await vi.waitFor(() =>
        expect(
          el.shadowRoot!.querySelector("[data-test=profile-name-clock-profile]"),
        ).not.toBeNull(),
      );
      const reopened = await editor(f.api);
      const persisted = reopened
        .shadowRoot!.querySelector("[data-test=cap-clock-in]")!
        .shadowRoot!.querySelector<HTMLInputElement>("input")!;
      expect(persisted.checked).toBe(true);
      expect(
        reopened.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
          "[data-test=profile-save]",
        )!.disabled,
      ).toBe(true);
    },
  );

  it("offers no clock-in switch on a shared display", async () => {
    const el = await editor(fixture("kds").api);
    expect(el.shadowRoot!.querySelector("[data-test=cap-clock-in]")).toBeNull();
  });
});
