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
import { openTable, resetBillPayDrafts, stubApi, tableOrder } from "../test/bill-pay-app.js";
import { en, es } from "./i18n/strings.js";
import { currentLocale, setLocale } from "./i18n/t.js";

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
    const { el, api } = await mountEquipmentAppAsKitchen(getDeviceEquipment);
    await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalled());
    vi.advanceTimersByTime(30_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getDeviceEquipment).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-shell")).not.toBeNull());
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-notice-strip")).toBeNull();
  });
});

const DISK: StaffNotice = {
  owner: "box",
  key: "storage.disk_full",
  code: "storage.disk_full",
  severity: "error",
  params: {},
};
const CLOCK: StaffNotice = {
  owner: "fiscal-verifactu",
  key: "clock.unusable",
  code: "clock.unusable",
  severity: "error",
  params: {},
};
const TILL_IDENTITY = { deviceId: "till-1", name: "Bar till", formFactor: "till" };

/** The strip `till-shell` holds in its light DOM, and the words it draws. */
function strip(el: TillApp) {
  const node = el.shadowRoot!.querySelector("till-shell > till-notice-strip");
  const drawn = node?.shadowRoot?.querySelector("[data-notice-strip]") ?? null;
  return { node, drawn, words: (drawn?.textContent ?? "").replace(/\s+/g, " ").trim() };
}

describe("the staff notice strip on a signed-in till or handheld", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  it("shows a till's red notice under its top bar", async () => {
    const { el } = await mountEquipmentApp({
      getDeviceIdentity: vi.fn().mockResolvedValue(TILL_IDENTITY),
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([DISK])),
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    expect((strip(el).node as unknown as { notices: StaffNotice[] }).notices).toEqual([DISK]);
    expect(strip(el).words).toContain(en["staff_notice.storage.disk_full"]);
  });

  it("shows the first of two reds, in the server's order, and +1", async () => {
    const { el } = await mountEquipmentApp({
      getDeviceIdentity: vi.fn().mockResolvedValue(TILL_IDENTITY),
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([DISK, CLOCK])),
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    expect(strip(el).words).toContain(en["staff_notice.storage.disk_full"]);
    expect(strip(el).words).not.toContain(en["staff_notice.clock.unusable"]);
    expect(strip(el).drawn!.querySelector("[data-notice-more] [aria-hidden]")!.textContent).toBe(
      "+1",
    );
  });

  it("shows it on a handheld too", async () => {
    const { el } = await mountEquipmentApp({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "h1", name: "Handheld", formFactor: "phone-portrait" }),
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
        capabilities: ["take-orders"],
        formFactor: "phone-portrait",
      }),
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([DISK])),
    });
    await signIn(el);
    expect(el.shadowRoot!.querySelector("till-shell")!.formFactor).toBe("phone-portrait");
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    expect(strip(el).words).toContain(en["staff_notice.storage.disk_full"]);
  });

  it("draws nothing once a read brings no notices", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(withNotices([DISK]))
      .mockResolvedValue(withNotices([]));
    const { el } = await mountEquipmentApp({
      getDeviceIdentity: vi.fn().mockResolvedValue(TILL_IDENTITY),
      getDeviceEquipment,
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(strip(el).node).not.toBeNull();
    expect(strip(el).drawn).toBeNull();
  });

  it("words the notice in Spanish for a Spanish speaker", async () => {
    const before = currentLocale();
    try {
      const { el } = await mountEquipmentApp({
        getDeviceIdentity: vi.fn().mockResolvedValue(TILL_IDENTITY),
        getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([DISK])),
      });
      await signIn(el, "es-ES");
      await vi.waitFor(() =>
        expect(strip(el).words).toContain(es["staff_notice.storage.disk_full"]),
      );
    } finally {
      setLocale(before);
    }
  });
});

describe("the open notice list beside an open order", () => {
  beforeEach(resetBillPayDrafts);
  afterEach(cleanupWidgets);

  it("pushes the order screen down rather than covering it", async () => {
    const api = stubApi({
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([DISK, CLOCK])),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    const button = strip(el).drawn!.querySelector<HTMLButtonElement>("button")!;
    button.click();
    await (strip(el).node as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await el.updateComplete;
    const list = strip(el).drawn!.querySelector("[data-notice-list]")!;
    expect(list).not.toBeNull();
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(order).toBe(tableOrder(el));
    const listBox = list.getBoundingClientRect();
    expect(listBox.height).toBeGreaterThan(0);
    expect(order.getBoundingClientRect().top).toBeGreaterThanOrEqual(listBox.bottom);
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
