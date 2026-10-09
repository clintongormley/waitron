import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, DeviceProfile, Printer, Station } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { DeviceProfilesScreen } from "./device-profiles-screen.js";

registerIcons(DASHBOARD_ICONS);
const profile: DeviceProfile = {
  id: "p1",
  name: "Counter",
  canvasId: "c1",
  capabilities: ["show-station", "show-expo"],
  formFactor: "till",
  inactivityTimeoutSeconds: 300,
  receiptPrinterIds: ["r1", "r2"],
  paymentSlipPrinterIds: [],
  cashDrawerPrinterIds: [],
  receiptPrinterDefaultId: null,
  paymentSlipPrinterDefaultId: null,
  cashDrawerPrinterDefaultId: null,
  departmentId: "d1",
  allowedZoneIds: null,
  startingZoneId: "z1",
  admittedRoles: ["staff", "supervisor", "manager", "admin"],
  personExceptions: [],
  startingScreen: "show-station",
};
const printer: Printer = {
  id: "r1",
  name: "Counter",
  transport: "network_tcp",
  host: "192.168.1.10",
  port: 9100,
  localKey: null,
  pollId: null,
  watcherId: null,
  paperWidth: "80mm",
  resolution: "203dpi",
  hasCashDrawer: false,
  portable: false,
  holder: null,
  active: true,
  lastPrintAgentId: null,
  pendingJobs: 0,
  lastPrintAt: null,
};
const station: Station = {
  id: "s1",
  name: "Kitchen",
  active: true,
  displayOrder: 0,
  isDefault: true,
  showsRestOfOrder: false,
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
class ProfileLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-device-profiles-screen
        .api=${this.api}
      ></dashboard-device-profiles-screen>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("profile-settings-leave-test-app", ProfileLeaveApp);
afterEach(cleanupWidgets);
function q(screen: DeviceProfilesScreen, id: string) {
  return screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${id}]`);
}
function change(screen: DeviceProfilesScreen, id: string, value: string | boolean) {
  q(screen, id)!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
    }),
  );
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function mount(overrides: Partial<DashboardApi> = {}, loaded = profile) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<ProfileLeaveApp>("profile-settings-leave-test-app", {
    api: {
      listDeviceProfiles: async () => [loaded],
      getDeviceProfile: async () => loaded,
      listCanvases: async () => [
        { id: "c1", name: "Counter", definition: {} },
        { id: "c2", name: "Bar", definition: {} },
      ],
      listPrinters: async () => [printer, { ...printer, id: "r2", name: "Bar" }],
      listStations: async () => [station],
      listProfileKitchenScreens: async () => [
        { profileId: "p1", screens: { station: { stationIds: ["s1"], zoneIds: null } } },
      ],
      listStaff: async () => [
        {
          personId: "pe1",
          displayName: "Ana",
          role: "staff",
          status: "active",
          hasPassword: true,
          hasTotp: false,
          email: null,
        },
      ],
      getProfileScopeChoices: async () => ({
        departments: [
          { id: "d1", name: "Restaurant", active: true },
          { id: "d2", name: "Bar", active: true },
        ],
        zones: [
          { id: "z1", name: "Room", departmentId: "d1", active: true },
          { id: "z2", name: "Terrace", departmentId: "d1", active: true },
          { id: "z3", name: "Bar", departmentId: "d2", active: true },
        ],
      }),
      listReaders: async () => [],
      getProfileReaders: async () => ({ readerIds: [], defaultReaderId: null }),
      updateDeviceProfile: async () => loaded,
      createDeviceProfile: async () => ({ ...loaded, id: "p2" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-device-profiles-screen")!;
  await expect.poll(() => q(screen, "edit-p1")).not.toBeNull();
  q(screen, "edit-p1")!.click();
  await expect.poll(() => q(screen, "profile-name")).not.toBeNull();
  await screen.updateComplete;
  return { app, screen };
}
async function choose(app: ProfileLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
it("W69 profile Cancel preserves the draft and focus until explicit Discard", async () => {
  const { app, screen } = await mount();
  change(screen, "profile-name", "New counter");
  await screen.updateComplete;
  const field = q(screen, "profile-name") as HTMLElementTagNameMap["wt-input"];
  await field.updateComplete;
  const native = field.shadowRoot!.querySelector("input")!;
  native.focus();
  q(screen, "profile-cancel")!.click();
  await choose(app, "keep");
  expect(field.value).toBe("New counter");
  await expect.poll(() => field.shadowRoot!.activeElement).toBe(native);
  q(screen, "profile-cancel")!.click();
  await choose(app, "discard");
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(unload()).toBe(false);
});
for (const [id, initial, edited] of [
  ["profile-name", "Counter", "New counter"],
  ["profile-canvas", "c1", "c2"],
  ["profile-inactivity", "5", "6"],
  ["profile-form-factor", "till", "phone-portrait"],
  ["profile-starting-zone", "z1", "z2"],
  ["profile-starting-screen", "show-station", "show-expo"],
  ["profile-role-staff", true, false],
  ["profile-person-pe1", "", "deny"],
  ["cap-take-orders", false, true],
  ["payment-slip-printers-r1", false, true],
  ["receipt-printers-default", "", "r1"],
] as const) {
  it(`W69 profile ${id} protects changed values and clears a revert`, async () => {
    const { screen } = await mount();
    expect(unload()).toBe(false);
    change(screen, id, edited);
    expect(unload()).toBe(true);
    change(screen, id, initial);
    expect(unload()).toBe(false);
  });
}
it("W69 profile department and zone selection revert without depending on touched flags", async () => {
  const { screen } = await mount();
  change(screen, "profile-department", "d2");
  expect(unload()).toBe(true);
  change(screen, "profile-department", "d1");
  expect(unload()).toBe(false);
  change(screen, "profile-every-zone", false);
  expect(unload()).toBe(true);
  change(screen, "profile-every-zone", true);
  expect(unload()).toBe(false);
});
it("W69 profile printer preference order is protected and a move back is clean", async () => {
  const { screen } = await mount();
  q(screen, "receipt-printers-down-r1")!.click();
  expect(unload()).toBe(true);
  await screen.updateComplete;
  q(screen, "receipt-printers-up-r1")!.click();
  expect(unload()).toBe(false);
});
it("W69 kitchen profile lists are protected with clean reverts", async () => {
  const { screen } = await mount(
    {},
    { ...profile, formFactor: "kds", capabilities: [], startingScreen: null },
  );
  change(screen, "profile-station-screen-station-s1", false);
  expect(unload()).toBe(true);
  change(screen, "profile-station-screen-station-s1", true);
  expect(unload()).toBe(false);
  change(screen, "profile-pass-monitor", true);
  expect(unload()).toBe(true);
  change(screen, "profile-pass-monitor", false);
  expect(unload()).toBe(false);
});

it("A366 a till's pass monitor is protected, and leaving with it asks", async () => {
  const { app, screen } = await mount();
  change(screen, "profile-pass-monitor", true);
  expect(unload()).toBe(true);
  q(screen, "profile-cancel")!.click();
  await choose(app, "keep");
  expect(q(screen, "editor-form")).not.toBeNull();
  change(screen, "profile-pass-monitor", false);
  expect(unload()).toBe(false);
});

it("A366 reconnect: a departed save's narrowed devices stay off the screen, and a kitchen screen changed after it still asks", async () => {
  let finish!: () => void;
  const kds = { ...profile, formFactor: "kds" as const, capabilities: [], startingScreen: null };
  const { app, screen } = await mount(
    {
      updateDeviceProfile: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          ...kds,
          narrowedDevices: [
            {
              deviceId: "dv1",
              deviceName: "Pantalla Pase",
              lost: { screens: [], stations: [{ id: "s1", name: "Kitchen" }], zones: [] },
            },
          ],
        };
      },
    },
    kds,
  );
  change(screen, "profile-station-screen-station-s1", false);
  q(screen, "profile-save")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  screen.remove();
  app.shadowRoot!.append(screen);
  await expect.poll(() => q(screen, "edit-p1")).not.toBeNull();
  q(screen, "edit-p1")!.click();
  await expect.poll(() => q(screen, "profile-name")).not.toBeNull();
  await screen.updateComplete;
  change(screen, "profile-pass-monitor", true);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(q(screen, "narrowed-devices")).toBeNull();
  expect((q(screen, "profile-pass-monitor") as HTMLElement & { checked: boolean }).checked).toBe(
    true,
  );
  expect(unload()).toBe(true);
  q(screen, "profile-cancel")!.click();
  await choose(app, "discard");
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(q(screen, "narrowed-devices")).toBeNull();
  expect(unload()).toBe(false);
});

it("W69 profile names compare their submitted trimming and invalid minutes remain distinct", async () => {
  const { screen } = await mount();
  change(screen, "profile-name", "  Counter  ");
  expect(unload()).toBe(false);
  change(screen, "profile-inactivity", "0");
  expect(unload()).toBe(true);
  change(screen, "profile-inactivity", "5");
  expect(unload()).toBe(false);
  q(screen, "profile-cancel")!.click();
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
});

it("W69 kitchen choices compare membership after reselecting in a different order", async () => {
  const { screen } = await mount(
    {
      listStations: async () => [station, { ...station, id: "s2", name: "Bar" }],
      listProfileKitchenScreens: async () => [
        { profileId: "p1", screens: { station: { stationIds: ["s1", "s2"], zoneIds: null } } },
      ],
    },
    { ...profile, formFactor: "kds", capabilities: [], startingScreen: null },
  );
  change(screen, "profile-station-screen-station-s1", false);
  expect(unload()).toBe(true);
  change(screen, "profile-station-screen-station-s1", true);
  expect(unload()).toBe(false);
});
it("W69 an accepted profile save closes before a refused refresh", async () => {
  let reads = 0;
  const writes: unknown[] = [];
  const { screen } = await mount({
    listDeviceProfiles: async () => {
      if (++reads > 1) throw { code: "connection.failed" };
      return [profile];
    },
    updateDeviceProfile: async (...args) => {
      writes.push(args);
      return profile;
    },
  });
  change(screen, "profile-name", "New counter");
  q(screen, "profile-save")!.click();
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(writes).toEqual([
    [
      "p1",
      "New counter",
      "c1",
      ["show-station", "show-expo"],
      "till",
      300,
      { receiptPrinterIds: ["r1", "r2"], paymentSlipPrinterIds: [] },
    ],
  ]);
  expect(unload()).toBe(false);
});
it("W69 a refused profile save preserves its dirty values", async () => {
  const { screen } = await mount({
    updateDeviceProfile: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "profile-name", "New counter");
  q(screen, "profile-save")!.click();
  await expect
    .poll(() => screen.shadowRoot!.textContent)
    .toContain(codeMessage("connection.failed"));
  expect(q(screen, "editor-form")).not.toBeNull();
  expect(unload()).toBe(true);
});
it("W69 profile save keeps newer input against the accepted submitted snapshot", async () => {
  let finish!: () => void;
  const writes: unknown[] = [];
  const { screen } = await mount({
    updateDeviceProfile: async (...args) => {
      writes.push(args);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return profile;
    },
  });
  change(screen, "profile-name", "Submitted counter");
  q(screen, "profile-save")!.click();
  await expect.poll(() => writes.length).toBe(1);
  change(screen, "profile-name", "Newer counter");
  q(screen, "profile-cancel")!.click();
  expect(q(screen, "editor-form")).not.toBeNull();
  finish();
  await expect
    .poll(() => (q(screen, "profile-save") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect((q(screen, "profile-name") as HTMLInputElement).value).toBe("Newer counter");
  expect(unload()).toBe(true);
  change(screen, "profile-name", "Submitted counter");
  expect(unload()).toBe(false);
});
it("W69 disconnect removes a profile draft and makes a pending answer inert", async () => {
  const { app, screen } = await mount();
  change(screen, "profile-name", "New counter");
  q(screen, "profile-cancel")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});

it("W69 reconnect releases the departed write's busy state and ignores its reply", async () => {
  let finish!: () => void;
  let writes = 0;
  const { app, screen } = await mount({
    updateDeviceProfile: async () => {
      writes++;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return profile;
    },
  });
  change(screen, "profile-name", "Departed counter");
  q(screen, "profile-save")!.click();
  await expect.poll(() => writes).toBe(1);
  screen.remove();
  app.shadowRoot!.append(screen);
  await expect.poll(() => q(screen, "edit-p1")).not.toBeNull();
  q(screen, "edit-p1")!.click();
  await expect.poll(() => q(screen, "profile-name")).not.toBeNull();
  change(screen, "profile-name", "Replacement counter");
  await expect.poll(() => (q(screen, "profile-save") as HTMLButtonElement).disabled).toBe(false);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(q(screen, "profile-name")).not.toBeNull();
  expect((q(screen, "profile-name") as HTMLInputElement).value).toBe("Replacement counter");
  expect(unload()).toBe(true);
});

it("W69 a departed profile reply cannot release a replacement save's busy gate", async () => {
  const finishes: (() => void)[] = [];
  const { app, screen } = await mount({
    updateDeviceProfile: async () => {
      await new Promise<void>((resolve) => {
        finishes.push(resolve);
      });
      return profile;
    },
  });
  change(screen, "profile-name", "Departed counter");
  q(screen, "profile-save")!.click();
  await expect.poll(() => finishes.length).toBe(1);
  screen.remove();
  app.shadowRoot!.append(screen);
  await expect.poll(() => q(screen, "edit-p1")).not.toBeNull();
  q(screen, "edit-p1")!.click();
  await expect.poll(() => q(screen, "profile-name")).not.toBeNull();
  change(screen, "profile-name", "Replacement counter");
  q(screen, "profile-save")!.click();
  await expect.poll(() => finishes.length).toBe(2);
  finishes[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((q(screen, "profile-save") as HTMLButtonElement).disabled).toBe(true);
  expect((q(screen, "profile-cancel") as HTMLButtonElement).disabled).toBe(true);
  expect((q(screen, "profile-name") as HTMLInputElement).value).toBe("Replacement counter");
  finishes[1]!();
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(unload()).toBe(false);
});

for (const phase of ["write", "refresh"] as const) {
  it(`W69 a departed ${phase} refusal cannot show an error on the reconnected profile list`, async () => {
    let refuse!: () => void;
    let reads = 0;
    const delayed = () =>
      new Promise<never>((_resolve, reject) => {
        refuse = () => reject({ code: "connection.failed" });
      });
    const { app, screen } = await mount({
      updateDeviceProfile: async () => (phase === "write" ? delayed() : profile),
      listDeviceProfiles: async () =>
        ++reads === 2 && phase === "refresh" ? delayed() : [profile],
    });
    change(screen, "profile-name", "Departed counter");
    q(screen, "profile-save")!.click();
    await expect.poll(() => typeof refuse).toBe("function");
    screen.remove();
    app.shadowRoot!.append(screen);
    await expect.poll(() => q(screen, "edit-p1")).not.toBeNull();
    refuse();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.shadowRoot!.textContent).not.toContain(codeMessage("connection.failed"));
    expect(q(screen, "edit-p1")).not.toBeNull();
    expect(unload()).toBe(false);
  });
}

it("W69 late create defaults keep earlier name input dirty and become the clean scope baseline", async () => {
  let finish!: () => void;
  let reads = 0;
  const { screen } = await mount({
    getProfileScopeChoices: async () => {
      if (++reads === 1)
        return {
          departments: [{ id: "d1", name: "Restaurant", active: true }],
          zones: [{ id: "z1", name: "Room", departmentId: "d1", active: true }],
        };
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        departments: [{ id: "d1", name: "Restaurant", active: true }],
        zones: [{ id: "z1", name: "Room", departmentId: "d1", active: true }],
      };
    },
  });
  q(screen, "profile-cancel")!.click();
  await expect.poll(() => q(screen, "create")).not.toBeNull();
  q(screen, "create")!.click();
  await expect.poll(() => q(screen, "profile-name")).not.toBeNull();
  change(screen, "profile-name", "New phone");
  finish();
  await expect.poll(() => (q(screen, "profile-department") as HTMLInputElement).value).toBe("d1");
  expect(unload()).toBe(true);
  change(screen, "profile-name", "");
  expect(unload()).toBe(false);
});

it("W69 a create accepted with newer input uses Update on its next save", async () => {
  let finish!: () => void;
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  const { screen } = await mount({
    createDeviceProfile: async (...args) => {
      creates.push(args);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        ...profile,
        id: "p2",
        name: "Submitted phone",
        canvasId: null,
        capabilities: [],
        inactivityTimeoutSeconds: null,
        receiptPrinterIds: [],
        startingScreen: null,
      };
    },
    updateDeviceProfile: async (...args) => {
      updates.push(args);
      return { ...profile, id: "p2", name: "Newer phone" };
    },
  });
  q(screen, "profile-cancel")!.click();
  await expect.poll(() => q(screen, "create")).not.toBeNull();
  q(screen, "create")!.click();
  await expect.poll(() => q(screen, "profile-name")).not.toBeNull();
  change(screen, "profile-name", "Submitted phone");
  change(screen, "profile-department", "d1");
  q(screen, "profile-save")!.click();
  await expect.poll(() => creates.length).toBe(1);
  change(screen, "profile-name", "Newer phone");
  finish();
  await expect.poll(() => (q(screen, "profile-save") as HTMLButtonElement).disabled).toBe(false);
  expect(unload()).toBe(true);
  q(screen, "profile-save")!.click();
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(creates).toEqual([
    [
      "Submitted phone",
      null,
      [],
      "till",
      null,
      { receiptPrinterIds: [], paymentSlipPrinterIds: [] },
      { departmentId: "d1", allowedZoneIds: null, startingZoneId: "z1" },
    ],
  ]);
  expect(updates).toEqual([
    [
      "p2",
      "Newer phone",
      null,
      [],
      "till",
      null,
      { receiptPrinterIds: [], paymentSlipPrinterIds: [] },
    ],
  ]);
  expect(unload()).toBe(false);
});

const readerRow = (id: string, name: string) => ({
  id,
  provider: "test",
  name,
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
});
async function mountWithEquipment(overrides: Partial<DashboardApi> = {}) {
  const mounted = await mount({
    listPrinters: async () => [
      { ...printer, hasCashDrawer: true },
      { ...printer, id: "r2", name: "Bar", hasCashDrawer: true },
    ],
    listReaders: async () => [readerRow("ra", "Counter"), readerRow("rb", "Terrace")],
    getProfileReaders: async () => ({ readerIds: ["ra"], defaultReaderId: null }),
    ...overrides,
  });
  await expect.poll(() => q(mounted.screen, "profile-reader-rb")).not.toBeNull();
  return mounted;
}
it("W100 reading the profile's card readers leaves the opened editor clean", async () => {
  const { screen } = await mountWithEquipment();
  expect(unload()).toBe(false);
  change(screen, "profile-name", "New counter");
  expect(unload()).toBe(true);
});
for (const [id, initial, edited] of [
  ["cash-drawer-printers-r1", false, true],
  ["cash-drawer-printers-default", "", "r2"],
  ["payment-slip-printers-default", "", "r1"],
  ["profile-reader-rb", false, true],
  ["profile-readers-default", "", "ra"],
] as const) {
  it(`W100 profile ${id} protects changed values and clears a revert`, async () => {
    const { screen } = await mountWithEquipment();
    expect(unload()).toBe(false);
    change(screen, id, edited);
    expect(unload()).toBe(true);
    change(screen, id, initial);
    expect(unload()).toBe(false);
  });
}
it("W100 Discard puts back the profile's card readers and closes the editor", async () => {
  const { app, screen } = await mountWithEquipment();
  change(screen, "profile-reader-rb", true);
  q(screen, "profile-cancel")!.click();
  await choose(app, "keep");
  expect((q(screen, "profile-reader-rb") as HTMLInputElement & { checked: boolean }).checked).toBe(
    true,
  );
  q(screen, "profile-cancel")!.click();
  await choose(app, "discard");
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(unload()).toBe(false);
});
it("W100 a saved reader list closes the editor with nothing left to warn about", async () => {
  const sent: unknown[] = [];
  const { screen } = await mountWithEquipment({
    setProfileReaders: async (id, list) => {
      sent.push([id, list]);
      return list;
    },
  });
  change(screen, "profile-reader-rb", true);
  q(screen, "profile-save")!.click();
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(sent).toEqual([["p1", { readerIds: ["ra", "rb"], defaultReaderId: null }]]);
  expect(unload()).toBe(false);
});
it("W100 a refused reader list keeps only the readers unsaved", async () => {
  const { screen } = await mountWithEquipment({
    setProfileReaders: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "profile-name", "New counter");
  change(screen, "profile-reader-rb", true);
  q(screen, "profile-save")!.click();
  await expect
    .poll(() => screen.shadowRoot!.textContent)
    .toContain(codeMessage("connection.failed"));
  expect(q(screen, "editor-form")).not.toBeNull();
  expect(unload()).toBe(true);
  change(screen, "profile-reader-rb", false);
  expect(unload()).toBe(false);
});
it("W100 the reader list sent is the one captured when Save was pressed", async () => {
  let finish!: () => void;
  const sent: unknown[] = [];
  const { screen } = await mountWithEquipment({
    updateDeviceProfile: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return profile;
    },
    setProfileReaders: async (id, list) => {
      sent.push([id, list]);
      return list;
    },
  });
  change(screen, "profile-reader-rb", true);
  q(screen, "profile-save")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  change(screen, "profile-readers-default", "ra");
  finish();
  await expect.poll(() => (q(screen, "profile-save") as HTMLButtonElement).disabled).toBe(false);
  expect(sent).toEqual([["p1", { readerIds: ["ra", "rb"], defaultReaderId: null }]]);
  expect(q(screen, "editor-form")).not.toBeNull();
  expect(unload()).toBe(true);
  change(screen, "profile-readers-default", "");
  expect(unload()).toBe(false);
});
it("W100 a department chosen while a refused reader save is in flight is sent by the next Save", async () => {
  let finish: (() => void) | undefined;
  const writes: unknown[][] = [];
  let readerSaves = 0;
  const { screen } = await mountWithEquipment({
    updateDeviceProfile: async (...args) => {
      writes.push(args);
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return profile;
    },
    setProfileReaders: async (_id, list) => {
      readerSaves += 1;
      if (readerSaves === 1) throw { code: "connection.failed" };
      return list;
    },
  });
  change(screen, "profile-reader-rb", true);
  q(screen, "profile-save")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  change(screen, "profile-department", "d2");
  finish!();
  await expect
    .poll(() => screen.shadowRoot!.textContent)
    .toContain(codeMessage("connection.failed"));
  await expect.poll(() => (q(screen, "profile-save") as HTMLButtonElement).disabled).toBe(false);
  q(screen, "profile-save")!.click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]![7]).toMatchObject({
    departmentId: "d2",
    allowedZoneIds: null,
    startingZoneId: "z3",
  });
});
it("W100 a department saved before a refused reader save is not sent again", async () => {
  const writes: unknown[][] = [];
  let readerSaves = 0;
  const { screen } = await mountWithEquipment({
    updateDeviceProfile: async (...args) => {
      writes.push(args);
      return { ...profile, ...(args[7] as Partial<DeviceProfile> | undefined) };
    },
    setProfileReaders: async (_id, list) => {
      readerSaves += 1;
      if (readerSaves === 1) throw { code: "connection.failed" };
      return list;
    },
  });
  change(screen, "profile-department", "d2");
  change(screen, "profile-reader-rb", true);
  q(screen, "profile-save")!.click();
  await expect
    .poll(() => screen.shadowRoot!.textContent)
    .toContain(codeMessage("connection.failed"));
  expect(writes[0]![7]).toMatchObject({ departmentId: "d2" });
  await expect.poll(() => (q(screen, "profile-save") as HTMLButtonElement).disabled).toBe(false);
  q(screen, "profile-save")!.click();
  await expect.poll(() => q(screen, "editor-form")).toBeNull();
  expect(writes).toHaveLength(2);
  expect(writes[1]![7]).toBeUndefined();
});
