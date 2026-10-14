import { vi, expect } from "vitest";
import type { TillApp } from "../src/till-app.js";
import "../src/till-app.js";
import { TillApi } from "../src/api/client.js";
import { mountWidget } from "../src/widgets/test-helpers.js";
import { NFC_EQUIPMENT } from "./equipment-nfc.js";

export function emit(source: Element, name: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

export async function mountEquipmentApp(
  overrides: Record<string, unknown> = {},
  theme?: "light" | "dark",
) {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = new TillApi("", async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(NFC_EQUIPMENT));
  });
  const api = {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "en-GB", label: "English" },
        { code: "es-ES", label: "Español" },
      ],
      venueDefault: "en-GB",
      loginDefault: "en-GB",
    }),
    getTill: vi.fn().mockResolvedValue({
      locale: "en-GB",
      invoiceLocale: "en-GB",
      venueName: "Terrace restaurant",
      nif: "B12345678",
      orderFlow: "prepay",
      bumpMode: "line",
      fireControl: "waiter",
      courses: [],
      cardProvider: "none",
      tipsEnabled: false,
      inactivityTimeoutSeconds: null,
      nodeId: "n1",
      servers: [],
      capabilities: ["show-schedule", "show-station", "show-expo", "take-orders"],
      canvas: {
        formFactor: "handheld",
        tabs: [
          {
            key: "counter",
            title: "Counter",
            columns: 12,
            cards: [{ type: "product-grid", colSpan: 12, rowSpan: 6, config: {} }],
          },
        ],
      },
    }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "nfc-till",
      name: "Terrace handheld",
      formFactor: "handheld",
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      context: {
        zoneId: "terrace",
        departmentId: "restaurant",
        departmentName: "Restaurant",
        serviceMode: "prepay",
      },
      offers: [],
      menus: [],
      defaultMenuId: null,
      service: { open: true, zoneOpen: true, periodName: null, keepOpen: null, zoneKeepOpen: null },
    }),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    getExpoQueue: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
    getDeviceEquipment: vi.fn().mockResolvedValue(NFC_EQUIPMENT),
    setDeviceEquipment: client.setDeviceEquipment.bind(client),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
  const mounted = await mountWidget<TillApp>("till-app", { api }, theme);
  await vi.waitFor(() =>
    expect(mounted.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
  );
  return { ...mounted, api, requests };
}

export async function signIn(el: TillApp, locale = "en-GB"): Promise<void> {
  emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
    personId: "ana",
    displayName: "Ana",
    permissions: [],
    locale,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-tab-shell")).not.toBeNull());
  await el.updateComplete;
}

export async function openEquipment(el: TillApp): Promise<void> {
  emit(el.shadowRoot!.querySelector("till-tab-shell")!, "open-equipment");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-equipment-dialog")).not.toBeNull(),
  );
  await el.updateComplete;
}
