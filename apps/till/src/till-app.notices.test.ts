import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  DeviceEquipment,
  DeviceEquipmentRead,
  EquipmentChange,
  StaffNotice,
} from "./api/client.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import {
  emit,
  mountEquipmentApp,
  mountEquipmentAppAsKitchen,
  openEquipment,
  signIn,
  till,
} from "../test/equipment-app.js";
import { NFC_EQUIPMENT } from "../test/equipment-nfc.js";
import { openTable, resetBillPayDrafts, stubApi, tableOrder } from "../test/bill-pay-app.js";
import {
  addDish,
  draft,
  mountApp as mountOrderApp,
  openTable as openOrderTable,
  resetAllergyFixture,
  tableOrder as orderScreen,
} from "../test/allergy-app-fixture.js";
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

describe("a poll beside an open order", () => {
  beforeEach(() => {
    resetAllergyFixture();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  it("brings changed notices and leaves the order screen and its draft line in place", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(withNotices([A]))
      .mockResolvedValue(withNotices([B]));
    const { el } = await mountOrderApp({ getDeviceEquipment });
    const order = await openOrderTable(el);
    await addDish(el);
    const lines = draft(el).lines;
    expect(lines).toHaveLength(1);
    await vi.waitFor(() => expect(seen(el).staffNotices).toEqual([A]));
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(seen(el).staffNotices).toEqual([B]);
    expect(orderScreen(el)).toBe(order);
    expect(draft(el).lines).toEqual(lines);
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

  it("uses the existing manual opening action from a drawer expiry notice", async () => {
    const expired: StaffNotice = {
      owner: "drawers",
      key: "expired:one",
      code: "print_job.drawer_expired",
      severity: "warning",
      params: {},
    };
    let opened = false;
    const openDrawer = vi.fn(async () => {
      opened = true;
    });
    const { el } = await mountEquipmentApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
      getDeviceEquipment: vi.fn(async () => withNotices(opened ? [] : [expired])),
      openDrawer,
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    await userEvent.click(strip(el).drawn!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await vi.waitFor(() => expect(openDrawer).toHaveBeenCalledWith());
    expect(openDrawer).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(strip(el).drawn).toBeNull());
  });

  it.each([false, true])(
    "keeps a shown unconfirmed-change warning while opening the drawer (refused: %s)",
    async (refused) => {
      const openDrawer = refused
        ? vi.fn().mockRejectedValue({ code: "drawer.not_attached" })
        : vi.fn().mockResolvedValue(undefined);
      const { el } = await mountEquipmentApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
        getDeviceEquipment: vi.fn().mockResolvedValue(
          withNotices([
            {
              owner: "drawers",
              key: "one",
              code: "print_job.drawer_expired",
              severity: "warning",
              params: {},
            },
          ]),
        ),
        openDrawer,
      });
      await signIn(el);
      Object.assign(el, {
        errorKey: { lateChange: { lineName: "Fish", tableLabel: "4", unanswered: true } },
      });
      await el.updateComplete;
      const before = el.shadowRoot!.querySelector('[role="alert"]')!.textContent;
      expect(before).toContain("Fish");
      await userEvent.click(strip(el).drawn!.querySelector<HTMLElement>("[data-open-drawer]")!);
      await vi.waitFor(() => expect(openDrawer).toHaveBeenCalledOnce());
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(before);
    },
  );

  it("does not send another opening while the drawer notice request is in flight", async () => {
    const opening = held<void>();
    const openDrawer = vi.fn(() => opening.promise);
    const { el } = await mountEquipmentApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
      getDeviceEquipment: vi.fn().mockResolvedValue(
        withNotices([
          {
            owner: "drawers",
            key: "one",
            code: "print_job.drawer_expired",
            severity: "warning",
            params: {},
          },
        ]),
      ),
      openDrawer,
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    const button = strip(el).drawn!.querySelector<HTMLElement>("[data-open-drawer]")!;
    await userEvent.click(button);
    await el.updateComplete;
    expect(
      button.hasAttribute("disabled") || (button as unknown as { disabled: boolean }).disabled,
    ).toBe(true);
    emit(strip(el).node!, "till-open-drawer");
    expect(openDrawer).toHaveBeenCalledTimes(1);
    opening.resolve();
    await vi.waitFor(() =>
      expect((button as unknown as { disabled: boolean }).disabled).toBe(false),
    );
  });

  it("keeps a drawer expiry visible without an action on a profile that cannot open it", async () => {
    const { el } = await mountEquipmentApp({
      getDeviceEquipment: vi.fn().mockResolvedValue(
        withNotices([
          {
            owner: "drawers",
            key: "one",
            code: "print_job.drawer_expired",
            severity: "warning",
            params: {},
          },
        ]),
      ),
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    expect(strip(el).drawn!.querySelector("[data-open-drawer]")).toBeNull();
  });

  it("offers the existing supervisor override when the drawer notice action is refused", async () => {
    const openDrawer = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockResolvedValueOnce(undefined);
    const { el } = await mountEquipmentApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
      getDeviceEquipment: vi.fn().mockResolvedValue(
        withNotices([
          {
            owner: "drawers",
            key: "one",
            code: "print_job.drawer_expired",
            severity: "warning",
            params: {},
          },
        ]),
      ),
      openDrawer,
      listDrawerAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "supervisor", displayName: "Supervisor" }]),
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    await userEvent.click(strip(el).drawn!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-supervisor-override-dialog")).not.toBeNull(),
    );
    emit(el.shadowRoot!.querySelector("till-supervisor-override-dialog")!, "override-confirm", {
      personId: "supervisor",
      pin: "4321",
    });
    await vi.waitFor(() =>
      expect(openDrawer).toHaveBeenNthCalledWith(2, { personId: "supervisor", pin: "4321" }),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-supervisor-override-dialog")).toBeNull(),
    );
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
      getTill: vi.fn().mockResolvedValue({ ...till, formFactor: "phone-portrait" }),
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

const UNCONFIRMED: StaffNotice = {
  owner: "box-clock",
  key: "clock.unconfirmed",
  code: "clock.unconfirmed",
  severity: "error",
  params: { agreed: 1 },
};

function clockLine(el: TillApp): string | null {
  const line = el
    .shadowRoot!.querySelector("till-lock-screen")
    ?.shadowRoot?.querySelector("[data-clock-notice]");
  return line === null || line === undefined ? null : line.textContent!.replace(/\s+/g, " ").trim();
}

/** Mounted, with the device proved: its identity names the PIN screen's heading. */
async function mountAtPin(getDeviceEquipment: ReturnType<typeof vi.fn>) {
  const mounted = await mountEquipmentApp({ getDeviceEquipment });
  await vi.waitFor(() =>
    expect(
      mounted.el.shadowRoot!.querySelector("till-lock-screen")!.shadowRoot!.textContent,
    ).toContain("Terrace handheld"),
  );
  return mounted;
}

describe("a till or handheld at the PIN screen", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  it("reads its equipment every 15 s, so the server hears its clock with nobody signed in", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await settle(el);
    expect(getDeviceEquipment).not.toHaveBeenCalled();
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(getDeviceEquipment).toHaveBeenLastCalledWith({ signal: expect.any(AbortSignal) });
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
  });

  it("reads once a tick after sign-in, and again from the PIN screen after sign-out", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await signIn(el);
    await vi.waitFor(() => expect(getDeviceEquipment).toHaveBeenCalledTimes(1));
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(3);
  });

  it("stops reading once the device is no longer proved", async () => {
    const getDeviceEquipment = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    await poll(el);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
  });

  it("shows the waiting line with its count, and drops it once a read answers without it", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([UNCONFIRMED]));
    const { el } = await mountAtPin(getDeviceEquipment);
    expect(clockLine(el)).toBeNull();
    await poll(el);
    expect(clockLine(el)).toBe(
      "Payments wait: the server is waiting for devices to connect and agree with its time (1 of 2 so far)",
    );
    getDeviceEquipment.mockResolvedValue(withNotices([]));
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(clockLine(el)).toBeNull();
  });

  it("drops the waiting line once the device is refused, and reads no more", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([UNCONFIRMED]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(clockLine(el)).toContain("(1 of 2 so far)");
    getDeviceEquipment.mockRejectedValue({ code: "device.unauthorized" });
    await poll(el);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(clockLine(el)).toBeNull();
  });

  it("shows no line for a waiting notice that is not well formed, and the screen still draws", async () => {
    const noParams: Partial<StaffNotice> = { ...UNCONFIRMED };
    delete noParams.params;
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValue(withNotices([noParams as unknown as StaffNotice]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(clockLine(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-lock-screen")!.shadowRoot!.textContent).toContain(
      "Terrace handheld",
    );
  });

  it("keeps the waiting line while a read names the box's clock unavailable", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([UNCONFIRMED]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(clockLine(el)).toContain("(1 of 2 so far)");
    getDeviceEquipment.mockResolvedValue({
      ...withNotices([]),
      noticesUnavailable: ["box-clock"],
    });
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(clockLine(el)).toContain("(1 of 2 so far)");
  });

  it("shows no line for a waiting notice from anyone but the box's clock", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValue(withNotices([{ ...UNCONFIRMED, owner: "fiscal-verifactu" }]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(clockLine(el)).toBeNull();
  });

  it("shows no other notice at the PIN screen", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([CLOCK, DISK]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(clockLine(el)).toBeNull();
    expect(seen(el).staffNotices).toEqual([]);
  });
});
