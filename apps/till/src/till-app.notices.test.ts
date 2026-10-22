import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeviceEquipment,
  DeviceEquipmentRead,
  EquipmentChange,
  StaffNotice,
  TillApi,
} from "./api/client.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { emit, mountEquipmentApp, openEquipment, signIn } from "../test/equipment-app.js";
import { NFC_EQUIPMENT } from "../test/equipment-nfc.js";

const notice = (key: string): StaffNotice => ({
  owner: "box",
  key,
  code: `box.${key}`,
  severity: "warning",
  params: {},
});
const A = notice("a");
const B = notice("b");

interface Held<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}
function held<T>(): Held<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const withNotices = (notices: StaffNotice[]): DeviceEquipmentRead => ({
  ...NFC_EQUIPMENT,
  notices,
});

type Seen = { staffNotices: readonly StaffNotice[]; deviceEquipment: DeviceEquipment | null };
const seen = (el: TillApp) => el as unknown as Seen;

async function settle(el: TillApp): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

/** One equipment poll read: the poll's timer is faked, every other timer is real. */
async function poll(el: TillApp): Promise<void> {
  vi.advanceTimersByTime(15_000);
  await settle(el);
}

describe("the staff notices an open till keeps", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  it("keeps the notices the sign-in read brings", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([A]));
    const { el } = await mountEquipmentApp({ getDeviceEquipment });
    await signIn(el);
    await vi.waitFor(() => expect(seen(el).staffNotices).toEqual([A]));
  });

  it("lets a later-sent read win over an earlier one that answers late", async () => {
    const signInRead = held<DeviceEquipmentRead>();
    const getDeviceEquipment = vi
      .fn()
      .mockReturnValueOnce(signInRead.promise)
      .mockResolvedValue(withNotices([B]));
    const { el } = await mountEquipmentApp({ getDeviceEquipment });
    await signIn(el);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(seen(el).staffNotices).toEqual([B]);
    signInRead.resolve(withNotices([A]));
    await settle(el);
    expect(seen(el).staffNotices).toEqual([B]);
  });

  it("takes the poll's notices even when an equipment change overtook its equipment", async () => {
    const put = held<DeviceEquipment>();
    const setDeviceEquipment = vi.fn().mockReturnValue(put.promise);
    const getDeviceEquipment = vi.fn().mockResolvedValue(NFC_EQUIPMENT);
    const { el } = await mountEquipmentApp({ getDeviceEquipment, setDeviceEquipment });
    await signIn(el);
    await vi.waitFor(() => expect(seen(el).deviceEquipment).toBe(NFC_EQUIPMENT));
    await openEquipment(el);
    const change: EquipmentChange = { role: "receipt", selection: "default", via: "list" };
    emit(el.shadowRoot!.querySelector("till-equipment-dialog")!, "equipment-change", change);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(1));
    const polled = withNotices([A]);
    getDeviceEquipment.mockResolvedValue(polled);
    await poll(el);
    expect(seen(el).staffNotices).toEqual([A]);
    expect(seen(el).deviceEquipment).toBe(NFC_EQUIPMENT);
    put.resolve(NFC_EQUIPMENT);
    await settle(el);
  });

  it("changes nothing on a failed read", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(withNotices([A]))
      .mockRejectedValue(new TypeError("offline"));
    const { el } = await mountEquipmentApp({ getDeviceEquipment });
    await signIn(el);
    await vi.waitFor(() => expect(seen(el).staffNotices).toEqual([A]));
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(seen(el).staffNotices).toEqual([A]);
  });

  it("clears them on logging out and drops an answer sent in the old session", async () => {
    const pollRead = held<DeviceEquipmentRead>();
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(withNotices([A]))
      .mockReturnValueOnce(pollRead.promise);
    const { el } = await mountEquipmentApp({ getDeviceEquipment });
    await signIn(el);
    await vi.waitFor(() => expect(seen(el).staffNotices).toEqual([A]));
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
    expect(seen(el).staffNotices).toEqual([]);
    pollRead.resolve(withNotices([B]));
    await settle(el);
    expect(seen(el).staffNotices).toEqual([]);
  });

  // A pin: a kitchen display never signs in, so it never starts the equipment reads.
  it("never reads them on a kitchen display", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([A]));
    const { api } = await mountEquipmentAppAsKitchen(getDeviceEquipment);
    await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalled());
    vi.advanceTimersByTime(30_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getDeviceEquipment).not.toHaveBeenCalled();
  });
});

async function mountEquipmentAppAsKitchen(getDeviceEquipment: TillApi["getDeviceEquipment"]) {
  const api = {
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "en", languages: ["en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [{ code: "en-GB", label: "English" }],
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
      capabilities: ["act-as-kds"],
      formFactor: "kds",
    }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "kd-1",
      name: "Kitchen screen",
      formFactor: "kds",
      kitchenScreens: [{ kind: "station", available: true, stations: [], zones: null }],
    }),
    getDeviceStationScreen: vi.fn().mockResolvedValue({ stations: [] }),
    listStaff: vi.fn().mockResolvedValue([]),
    getDeviceEquipment,
  } as unknown as TillApi & { getDeviceStationScreen: ReturnType<typeof vi.fn> };
  const mounted = await mountWidget<TillApp>("till-app", { api });
  return { ...mounted, api };
}
