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
import {
  flush as flushApp,
  lock as billPayLock,
  openTable,
  resetBillPayDrafts,
  stubApi,
  tableOrder,
  till as billPayTill,
} from "../test/bill-pay-app.js";
import type { CapabilityFlag } from "./layout.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
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
import { codeMessage } from "./i18n/codes.js";
import { staffNoticeText } from "./i18n/staff-notices.js";

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
/** As {@link withNotices}, on a device whose drawer printer may open a drawer. */
const withDrawerNotices = (notices: StaffNotice[]): DeviceEquipmentRead => ({
  ...withNotices(notices),
  opensDrawer: true,
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
      getDeviceEquipment: vi.fn(async () => withDrawerNotices(opened ? [] : [expired])),
      openDrawer,
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    await userEvent.click(strip(el).drawn!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await vi.waitFor(() => expect(openDrawer).toHaveBeenCalledWith());
    expect(openDrawer).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(strip(el).drawn).toBeNull());
  });

  it.each([false, true, "storage.disk_full"])(
    "keeps a shown unconfirmed-change warning while opening the drawer (refused: %s)",
    async (refused) => {
      const openDrawer = refused
        ? vi.fn().mockRejectedValue({
            code: typeof refused === "string" ? refused : "drawer.not_attached",
          })
        : vi.fn().mockResolvedValue(undefined);
      const { el } = await mountEquipmentApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
        getDeviceEquipment: vi.fn().mockResolvedValue(
          withDrawerNotices([
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
      if (refused === "storage.disk_full")
        expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
          codeMessage(refused),
        );
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
        withDrawerNotices([
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
      getDeviceEquipment: vi.fn().mockResolvedValue({
        ...withNotices([
          {
            owner: "drawers",
            key: "one",
            code: "print_job.drawer_expired",
            severity: "warning",
            params: {},
          },
        ]),
        opensDrawer: false,
      }),
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    expect(strip(el).drawn!.querySelector("[data-open-drawer]")).toBeNull();
  });

  it("keeps a drawer expiry visible without an action on a device that has no drawer it may open", async () => {
    const { el } = await mountEquipmentApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
      getDeviceEquipment: vi.fn().mockResolvedValue({
        ...withNotices([
          {
            owner: "drawers",
            key: "one",
            code: "print_job.drawer_expired",
            severity: "warning",
            params: {},
          },
        ]),
        opensDrawer: false,
      }),
    });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    expect(strip(el).drawn!.querySelector("[data-open-drawer]")).toBeNull();
  });

  it("offers Open drawer once a poll says the device may open one, though the till started without the permission", async () => {
    const expired: StaffNotice = {
      owner: "drawers",
      key: "one",
      code: "print_job.drawer_expired",
      severity: "warning",
      params: {},
    };
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValue({ ...withNotices([expired]), opensDrawer: false });
    const { el } = await mountEquipmentApp({ getDeviceEquipment });
    await signIn(el);
    await vi.waitFor(() => expect(strip(el).words).toContain("Drawer didn’t open"));
    expect((el as unknown as { capabilities: string[] }).capabilities).not.toContain(
      "open-cash-drawer",
    );
    expect(strip(el).drawn!.querySelector("[data-open-drawer]")).toBeNull();

    getDeviceEquipment.mockResolvedValue(withDrawerNotices([expired]));
    await poll(el);

    await vi.waitFor(() =>
      expect(strip(el).drawn!.querySelector("[data-open-drawer]")).not.toBeNull(),
    );
  });

  it("withdraws Open drawer once a poll says the device may no longer open one", async () => {
    const expired: StaffNotice = {
      owner: "drawers",
      key: "one",
      code: "print_job.drawer_expired",
      severity: "warning",
      params: {},
    };
    const getDeviceEquipment = vi.fn().mockResolvedValue(withDrawerNotices([expired]));
    const { el } = await mountEquipmentApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "open-cash-drawer"] }),
      getDeviceEquipment,
    });
    await signIn(el);
    await vi.waitFor(() =>
      expect(strip(el).drawn!.querySelector("[data-open-drawer]")).not.toBeNull(),
    );

    getDeviceEquipment.mockResolvedValue({ ...withNotices([expired]), opensDrawer: false });
    await poll(el);

    await vi.waitFor(() => expect(strip(el).drawn!.querySelector("[data-open-drawer]")).toBeNull());
    expect(strip(el).words).toContain("Drawer didn’t open");
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
        withDrawerNotices([
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
    expect(list.querySelectorAll("li")).toHaveLength(1);
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
  params: { agreed: 1, cause: "start" },
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

  it("shows no line for a waiting notice that is not well formed", async () => {
    const noKey = { ...UNCONFIRMED, key: 7 } as unknown as StaffNotice;
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([noKey]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(clockLine(el)).toBeNull();
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

  it.each(["en-GB", "es-ES"])(
    "shows the storage stop before sign-in in %s and clears it on recovery",
    async (locale) => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([DISK, UNCONFIRMED]));
        const { el } = await mountAtPin(getDeviceEquipment);
        setLocale(locale);
        await poll(el);
        const storageLine = () =>
          el
            .shadowRoot!.querySelector("till-lock-screen")!
            .shadowRoot!.querySelector("[data-storage-notice]")
            ?.textContent?.replace(/\s+/g, " ")
            .trim();
        const words = locale === "es-ES" ? es : en;
        expect(storageLine()).toBe(
          `${words["staff_notice.storage.disk_full"]} · ${words["staff_notice.tell_manager"]}`,
        );
        expect(clockLine(el)).not.toBeNull();
        getDeviceEquipment.mockResolvedValue({
          ...withNotices([UNCONFIRMED]),
          noticesUnavailable: ["box"],
        });
        await poll(el);
        expect(storageLine()).toContain(words["staff_notice.storage.disk_full"]);
        getDeviceEquipment.mockResolvedValue(withNotices([UNCONFIRMED]));
        await poll(el);
        expect(storageLine()).toBeUndefined();
        expect(clockLine(el)).not.toBeNull();
        expect(getDeviceEquipment).toHaveBeenCalledTimes(3);
      } finally {
        setLocale(previous);
      }
    },
  );

  it("shows the low-space warning from the existing PIN poll", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(
      withNotices([
        {
          ...DISK,
          key: "storage.space_low",
          code: "storage.space_low",
          severity: "warning",
        },
      ]),
    );
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(
      el
        .shadowRoot!.querySelector("till-lock-screen")!
        .shadowRoot!.querySelector("[data-storage-notice]")!.textContent,
    ).toContain(en["staff_notice.storage.space_low"]);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
  });

  it("shows no non-storage or non-start notice at the PIN screen", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValue(withNotices([CLOCK, { ...DISK, owner: "fiscal" }]));
    const { el } = await mountAtPin(getDeviceEquipment);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(clockLine(el)).toBeNull();
    expect(seen(el).staffNotices).toEqual([]);
    expect(
      el
        .shadowRoot!.querySelector("till-lock-screen")!
        .shadowRoot!.querySelector("[data-storage-notice]"),
    ).toBeNull();
  });
});

const pausedDialog = (el: TillApp) => el.shadowRoot!.querySelector("till-payments-paused-dialog");
const pausedWords = (el: TillApp) => {
  const root = pausedDialog(el)?.shadowRoot;
  const heading = root?.querySelector("wt-dialog")?.shadowRoot?.querySelector("h2");
  return `${heading?.textContent ?? ""} ${root?.textContent ?? ""}`.replace(/\s+/g, " ").trim();
};
const billPayDialog = (el: TillApp) => el.shadowRoot!.querySelector("till-bill-pay-dialog");
const lunch = {
  id: "meal",
  menuItemId: "offer-meal",
  menuId: "cat-default",
  name: "Lunch",
  pricingUnit: "each" as const,
  unitPrice: "30.00",
  vatClass: "general" as const,
  category: null,
  allergens: null,
};

describe("a payment started while a notice pauses payments", () => {
  beforeEach(resetBillPayDrafts);
  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  async function atCounter(
    notices: StaffNotice[],
    stage: "order" | "collect" = "order",
    overrides: Record<string, unknown> = {},
  ) {
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices(notices));
    const api = stubApi({
      getDeviceEquipment,
      parkOrder: vi.fn(() => new Promise(() => {})),
      ...overrides,
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flushApp(el);
    emit(billPayLock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flushApp(el);
    await vi.waitFor(() => expect(getDeviceEquipment).toHaveBeenCalled());
    await flushApp(el);
    const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    counter.store.addProduct(lunch, "1");
    if (stage === "collect") Object.assign(el, { stage, collectFlow: "ticket_then_pay" });
    await flushApp(el);
    const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
    const pay = async () => {
      tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
      await flushApp(el);
    };
    return { el, api, getDeviceEquipment, tender, pay };
  }

  it("opens the paused dialog, with the waiting sentence, and not the payment window, from the counter's Pay", async () => {
    const { el, api, pay } = await atCounter([UNCONFIRMED]);
    await pay();
    expect(api.parkOrder).not.toHaveBeenCalled();
    expect(billPayDialog(el)).toBeNull();
    expect(pausedDialog(el)).not.toBeNull();
    expect(pausedWords(el)).toContain(en["payments_paused.title"]);
    expect(pausedWords(el)).toContain(
      en["staff_notice.clock.unconfirmed"].replace("{agreed}", "1"),
    );
    expect(pausedWords(el)).toContain(en["payments_paused.order_open"]);
  });

  it("saves the order for the payment window from the counter's Pay without the waiting notice", async () => {
    const { el, api, pay } = await atCounter([]);
    await pay();
    expect(api.parkOrder).toHaveBeenCalledOnce();
    expect(pausedDialog(el)).toBeNull();
  });

  it("only the box's own waiting notice pauses payments", async () => {
    const { el, api, pay } = await atCounter([{ ...UNCONFIRMED, owner: "fiscal-verifactu" }]);
    await pay();
    expect(api.parkOrder).toHaveBeenCalledOnce();
    expect(pausedDialog(el)).toBeNull();
  });

  // Cash, Card and Other card start nothing until this question is answered yes: tender-pay.test.ts.
  it.each([
    [[UNCONFIRMED], false],
    [[], true],
  ] as const)(
    "answers a collecting counter's Cash or Card question (notices %j): go ahead %s",
    async (notices, proceed) => {
      const { el, tender } = await atCounter([...notices], "collect");
      const resolve = vi.fn();
      emit(tender, "check-before-tender", { resolve });
      await flushApp(el);
      if (proceed) expect(resolve).not.toHaveBeenCalled();
      else expect(resolve).toHaveBeenCalledExactlyOnceWith(false);
      expect(pausedDialog(el) !== null).toBe(!proceed);
    },
  );

  it.each([
    [[UNCONFIRMED], false],
    [[], true],
  ] as const)(
    "a collecting counter's Cash button (notices %j) opens amount entry: %s",
    async (notices, proceed) => {
      const { el, tender } = await atCounter([...notices], "collect");
      tender.shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
      await flushApp(el);
      await tender.updateComplete;
      expect(tender.shadowRoot!.querySelector("till-numeric-pad") !== null).toBe(proceed);
      expect(pausedDialog(el) !== null).toBe(!proceed);
    },
  );

  it.each([
    [[UNCONFIRMED], false],
    [[], true],
  ] as const)(
    "a collecting counter's Card button on a reader (notices %j) starts collecting: %s",
    async (notices, proceed) => {
      const { el, tender } = await atCounter([...notices], "collect", {
        getTill: vi.fn().mockResolvedValue({
          ...billPayTill,
          cardProvider: "simulator",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay: vi.fn(() => new Promise(() => {})),
      });
      const collect = vi.fn();
      tender.addEventListener("collect-card", collect);
      tender.shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
      await flushApp(el);
      expect(collect).toHaveBeenCalledTimes(proceed ? 1 : 0);
      expect(pausedDialog(el) !== null).toBe(!proceed);
    },
  );

  it("Check the time closes the paused dialog and opens the box's time dialog", async () => {
    const { el, pay } = await atCounter([UNCONFIRMED]);
    await pay();
    expect(el.shadowRoot!.querySelector("till-box-time-dialog")).toBeNull();
    pausedDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-check-time]")!.click();
    await flushApp(el);
    expect(pausedDialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-box-time-dialog")).not.toBeNull();
  });

  it("Close closes it and opens nothing else", async () => {
    const { el, pay } = await atCounter([UNCONFIRMED]);
    await pay();
    pausedDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
    await vi.waitFor(() => expect(pausedDialog(el)).toBeNull());
    await flushApp(el);
    expect(billPayDialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-box-time-dialog")).toBeNull();
  });

  it("Close by keyboard hands focus back to the Pay that opened it", async () => {
    const { el, tender } = await atCounter([UNCONFIRMED]);
    const payButton = tender
      .shadowRoot!.querySelector("[data-counter-pay]")!
      .shadowRoot!.querySelector("button")!;
    payButton.focus();
    await userEvent.keyboard("{Enter}");
    await flushApp(el);
    expect(pausedDialog(el)).not.toBeNull();
    const close = pausedDialog(el)!
      .shadowRoot!.querySelector("[data-close]")!
      .shadowRoot!.querySelector("button")!;
    close.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(pausedDialog(el)).toBeNull());
    await flushApp(el);
    let focused: Element | null = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    expect(focused).toBe(payButton);
  });

  it("offers no Check the time while the box does not offer it", async () => {
    const { el, pay } = await atCounter([UNCONFIRMED]);
    await pay();
    expect(pausedDialog(el)!.shadowRoot!.querySelector("[data-check-time]")).not.toBeNull();
    Object.assign(el, { checkTimeOffered: false });
    await flushApp(el);
    expect(pausedDialog(el)!.shadowRoot!.querySelector("[data-check-time]")).toBeNull();
    expect(pausedDialog(el)!.shadowRoot!.querySelector("[data-close]")).not.toBeNull();
  });

  it.each([UNCONFIRMED, CLOCK, DISK])(
    "closes once a later read no longer carries %j",
    async (notice) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { el, getDeviceEquipment, pay } = await atCounter([notice]);
      await pay();
      expect(pausedDialog(el)).not.toBeNull();
      getDeviceEquipment.mockResolvedValue(withNotices([]));
      await poll(el);
      expect(pausedDialog(el)).toBeNull();
    },
  );

  it.each([UNCONFIRMED, CLOCK, DISK])(
    "lets Pay go ahead once a read names the source of %j unavailable, still showing its line",
    async (notice) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { el, api, getDeviceEquipment, pay } = await atCounter([notice]);
      getDeviceEquipment.mockResolvedValue({
        ...withNotices([]),
        noticesUnavailable: [notice.owner],
      });
      await poll(el);
      expect(seen(el).staffNotices).toContainEqual(notice);
      await pay();
      expect(api.parkOrder).toHaveBeenCalledOnce();
      expect(pausedDialog(el)).toBeNull();
    },
  );

  const CHECK_TIME_MARKER: StaffNotice = {
    owner: "box-clock",
    key: "clock.check_time",
    code: "clock.check_time",
    severity: "error",
    params: {},
  };

  it.each([
    [[CLOCK], CLOCK, false, false],
    [[CHECK_TIME_MARKER, CLOCK], CLOCK, true, false],
    [[CLOCK, UNCONFIRMED], CLOCK, true, false],
    [[DISK], DISK, false, true],
    [[DISK, UNCONFIRMED], DISK, false, true],
  ] as const)(
    "a collecting counter's Cash button (notices %j) opens the paused dialog with the first one's sentence",
    async (notices, shown, checkTime, hint) => {
      const { el, api, tender } = await atCounter([...notices], "collect");
      tender.shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
      await flushApp(el);
      await tender.updateComplete;
      expect(tender.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
      expect(billPayDialog(el)).toBeNull();
      expect(pausedWords(el)).toContain(en["payments_paused.title"]);
      expect(pausedWords(el)).toContain(staffNoticeText(shown).main);
      expect(pausedWords(el)).toContain(en["payments_paused.order_open"]);
      const lines = [...pausedDialog(el)!.shadowRoot!.querySelectorAll("p")].map((p) =>
        p.textContent!.trim(),
      );
      expect(lines).toEqual([
        staffNoticeText(shown).main,
        ...(hint ? [en["staff_notice.tell_manager"]] : []),
        en["payments_paused.order_open"],
      ]);
      expect(pausedDialog(el)!.shadowRoot!.querySelector("[data-check-time]") !== null).toBe(
        checkTime,
      );
      for (const send of [api.pay, api.collectOrder, api.recordSale, api.takeBillPayment])
        expect(send).not.toHaveBeenCalled();
    },
  );

  // The commit that added this case says why the marker alone is left out.
  it("a collecting counter's Cash button with the check-the-time marker alone still opens amount entry", async () => {
    const { el, tender } = await atCounter([CHECK_TIME_MARKER], "collect");
    tender.shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await flushApp(el);
    await tender.updateComplete;
    expect(tender.shadowRoot!.querySelector("till-numeric-pad")).not.toBeNull();
    expect(pausedDialog(el)).toBeNull();
  });

  it("keeps an open paused dialog while a read names the box's clock unavailable", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { el, getDeviceEquipment, pay } = await atCounter([UNCONFIRMED]);
    await pay();
    expect(pausedDialog(el)).not.toBeNull();
    getDeviceEquipment.mockResolvedValue({
      ...withNotices([]),
      noticesUnavailable: ["box-clock"],
    });
    await poll(el);
    expect(pausedDialog(el)).not.toBeNull();
  });

  it("opens the paused dialog, not the bill payment dialog, from a table's Pay", async () => {
    const api = stubApi({
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([UNCONFIRMED])),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
    await flushApp(el);
    expect(billPayDialog(el)).toBeNull();
    expect(pausedDialog(el)).not.toBeNull();
    expect(api.getBillBalance).not.toHaveBeenCalled();
  });

  it("opens the paused dialog, not the presented bill's sheet", async () => {
    const api = stubApi({
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([UNCONFIRMED])),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    emit(order, "pay-presented", { workingOrderId: "wo-4" });
    await flushApp(el);
    expect(el.shadowRoot!.querySelector("till-presented-pay-dialog")).toBeNull();
    expect(pausedDialog(el)).not.toBeNull();
  });

  it("still opens the bill's payments to give back an overpayment", async () => {
    const api = stubApi({
      getDeviceEquipment: vi.fn().mockResolvedValue(withNotices([UNCONFIRMED])),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());
    emit(order, "refund-excess", { excess: "5.00" });
    await flushApp(el);
    expect(pausedDialog(el)).toBeNull();
    expect(billPayDialog(el)).not.toBeNull();
  });

  it("still reopens a bill payment that is out, so its answer can be seen", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const getDeviceEquipment = vi.fn().mockResolvedValue(withNotices([]));
    const takeBillPayment = vi.fn(() => new Promise(() => {}));
    const api = stubApi({ getDeviceEquipment, takeBillPayment });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
    await flushApp(el);
    const pay = billPayDialog(el)!;
    pay
      .shadowRoot!.querySelector<HTMLInputElement>('input[name="way"][value="contribution"]')!
      .click();
    await flushApp(el);
    for (const [name, value] of [
      ["amount", "40"],
      ["tendered", "50"],
    ] as const) {
      const input = pay
        .shadowRoot!.querySelector(`wt-input[name="${name}"]`)!
        .shadowRoot!.querySelector("input")!;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await flushApp(el);
    }
    pay.shadowRoot!.querySelector<HTMLElement>("[data-pay-continue]")!.click();
    await flushApp(el);
    pay.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!.click();
    await flushApp(el);
    expect(takeBillPayment).toHaveBeenCalledOnce();
    emit(pay, "bill-pay-close");
    await flushApp(el);
    expect(billPayDialog(el)).toBeNull();
    getDeviceEquipment.mockResolvedValue(withNotices([UNCONFIRMED]));
    await poll(el);
    await vi.waitFor(() => expect(strip(el).drawn).not.toBeNull());

    order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
    await flushApp(el);
    expect(pausedDialog(el)).toBeNull();
    expect(billPayDialog(el)).not.toBeNull();
    expect((billPayDialog(el) as unknown as { busy: boolean }).busy).toBe(true);
  });
});
