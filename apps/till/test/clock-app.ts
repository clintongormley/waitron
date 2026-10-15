import { expect, vi, type Mock } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillApi, TillClockState, TillInfo } from "../src/api/client.js";
import type { TillApp } from "../src/till-app.js";
import "../src/till-app.js";
import { hoursView } from "./hours-fixtures.js";
import { mountWidget, type Theme } from "../src/widgets/test-helpers.js";

export function clockState(
  state: TillClockState["state"] = "out",
  id: string | null = null,
  personId = "p1",
  firstClockIn = id === null,
): TillClockState {
  return {
    personId,
    locationId: "venue",
    businessDay: "2026-10-14",
    state,
    activeLocationId: state === "out" ? null : "venue",
    lastEntryId: id,
    firstClockIn,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type ClockTestApi = {
  [
    K in
      | "getTill"
      | "getClockState"
      | "clockIn"
      | "clockOut"
      | "startBreak"
      | "endBreak"
      | "logout"
      | "login"
      | "switchDeviceProfile"
      | "getTablesState"
      | "getDeviceIdentity"
      | "listDefaultZoneOffers"
      | "getHours"
      | "getAttendanceInbox"
      | "getAttendanceDay"
      | "getAttendanceCommand"
      | "listAttendanceApprovers"
      | "sendAttendanceCommand"
  ]: Mock<TillApi[K]>;
};
export interface ClockAppFixture {
  el: TillApp;
  host: HTMLElement;
  api: ClockTestApi;
  info: TillInfo;
  setState(next: TillClockState): void;
  state(): TillClockState;
}
export async function clockApp(
  options: {
    state?: TillClockState;
    enabled?: boolean;
    action?: boolean;
    timeoutSeconds?: number;
    theme?: Theme;
    props?: Partial<TillApp>;
  } = {},
): Promise<ClockAppFixture> {
  let state = options.state ?? clockState();
  let entries = 0;
  const info: TillInfo = {
    locale: "en-GB",
    clockingAvailable: options.enabled ?? true,
    invoiceLocale: "es-ES",
    receiptLanguages: ["es-ES"],
    venueName: "Clock venue",
    nif: "B10101010",
    bumpMode: "line",
    fireControl: "waiter",
    courses: [],
    cardProvider: "none",
    activeReaders: [],
    tipsEnabled: false,
    canvas: {
      formFactor: "till",
      tabs: [
        { key: "counter", title: "Counter", columns: 12, cards: [] },
        {
          key: "floor",
          title: "Floor",
          columns: 24,
          cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
        },
      ],
    },
    capabilities: options.action === false ? [] : ["clock-in"],
    inactivityTimeoutSeconds: options.timeoutSeconds ?? null,
    startingScreen: null,
    nodeId: "node",
    servers: [],
    simplifiedInvoiceLimit: null,
    fullInvoices: false,
  };
  const write = (status: TillClockState["state"]) => {
    state = clockState(status, `entry-${++entries}`, state.personId, false);
    return state;
  };
  const api = {
    getTill: vi.fn().mockResolvedValue(info),
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
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "clock-device",
      name: "Clock till",
      formFactor: "till",
      kitchenScreens: [],
      profileId: "profile",
      approvedProfiles: [
        { id: "profile", name: "Clock till", formFactor: "till" },
        { id: "other", name: "Other profile", formFactor: "till" },
      ],
    }),
    getDeviceEquipment: vi.fn().mockResolvedValue({ roles: [] }),
    listStaff: vi.fn().mockResolvedValue([
      { personId: "p1", displayName: "Ana" },
      { personId: "p2", displayName: "Luis" },
    ]),
    login: vi.fn().mockImplementation(async (personId: string) => {
      if (personId !== state.personId) state = clockState("out", null, personId);
      return { personId, permissions: [], locale: null };
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      offers: [],
      menus: [],
      defaultMenuId: null,
      service: {
        open: true,
        zoneOpen: true,
        periodName: null,
        keepOpen: null,
        zoneKeepOpen: null,
      },
      context: {
        departmentName: "Restaurant",
        zoneId: "zone",
        departmentId: "department",
        serviceMode: "prepay",
      },
      zones: [],
    }),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
    getHours: vi
      .fn()
      .mockImplementation(async (locationId: string, selection) =>
        hoursView({ personId: state.personId, locationId, selection }),
      ),
    getAttendanceInbox: vi.fn().mockImplementation(async () => ({
      personId: state.personId,
      revision: "revision",
      prompts: [],
      items: [],
      locations: [{ id: "venue", name: "Clock venue", timeZone: "Europe/Madrid" }],
    })),
    getAttendanceDay: vi.fn().mockImplementation(async (date: string, locationId: string) => ({
      personId: state.personId,
      locationId,
      date,
      revision: "revision",
      timeZone: "Europe/Madrid",
      record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
      items: [],
    })),
    getAttendanceCommand: vi.fn().mockResolvedValue(null),
    listAttendanceApprovers: vi
      .fn()
      .mockResolvedValue([{ personId: "manager", displayName: "Marta" }]),
    sendAttendanceCommand: vi.fn().mockImplementation(async (command) => ({
      commandId: command.commandId,
      entryIds: ["answer"],
      replayed: false,
    })),
    getClockState: vi.fn().mockImplementation(async () => state),
    clockIn: vi.fn().mockImplementation(async () => write("working")),
    clockOut: vi.fn().mockImplementation(async () => write("out")),
    startBreak: vi.fn().mockImplementation(async () => write("on_break")),
    endBreak: vi.fn().mockImplementation(async () => write("working")),
    switchDeviceProfile: vi.fn().mockResolvedValue({ profileId: "other", sessionEnded: false }),
  };
  const mounted = await mountWidget<TillApp>(
    "till-app",
    { api: api as unknown as TillApi, ...options.props },
    options.theme,
  );
  await vi.waitFor(() =>
    expect(
      mounted.el
        .shadowRoot!.querySelector("till-lock-screen")
        ?.shadowRoot?.querySelector('[data-person="p1"]'),
    ).not.toBeNull(),
  );
  return {
    ...mounted,
    api,
    info,
    setState: (next: TillClockState) => {
      state = next;
    },
    state: () => state,
  };
}
export async function signIn(el: TillApp, personId = "p1") {
  const lock = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "till-lock-screen",
  )!;
  await vi.waitFor(() =>
    expect(lock.shadowRoot!.querySelector(".roster, till-numeric-pad")).not.toBeNull(),
  );
  if (lock.shadowRoot!.querySelector(`[data-person="${personId}"]`) === null) {
    await userEvent.click(lock.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
    await lock.updateComplete;
  }
  await userEvent.click(
    lock.shadowRoot!.querySelector<HTMLElement>(`[data-person="${personId}"]`)!,
  );
  await lock.updateComplete;
  const pad = lock.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "till-numeric-pad",
  )!;
  await pad.updateComplete;
  for (let n = 0; n < 4; n++)
    await userEvent.click(pad.shadowRoot!.querySelector<HTMLElement>('[data-key="5"]')!);
  await userEvent.click(lock.shadowRoot!.querySelector<HTMLElement>(".submit")!);
}
export const clockPage = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("till-clock-in-screen");
export async function pageButton(el: TillApp, selector: string) {
  const surface = () =>
    clockPage(el) ??
    (selector === "[data-cancel]"
      ? el.shadowRoot!.querySelector<HTMLElement>("till-attendance-questions")
      : null);
  await vi.waitFor(() => expect(surface()).not.toBeNull());
  await userEvent.click(surface()!.shadowRoot!.querySelector<HTMLElement>(selector)!);
}
export async function shellAction(el: TillApp, selector: string) {
  const shell = el.shadowRoot!.querySelector("till-tab-shell")!;
  const button = shell.shadowRoot!.querySelector<HTMLElement>(selector)!;
  expect(button).not.toBeNull();
  const menu = button.closest("wt-row-actions")!;
  await (menu as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(button);
}
export async function working(el: TillApp) {
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-tab-shell")).not.toBeNull());
}
