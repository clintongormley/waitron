import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PrepStationsApi, PrepStationsView } from "./routing-client.js";
import { PrepStationsScreen } from "./prep-stations-screen.js";
const view: PrepStationsView = {
  routing: {
    zones: [],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "cocktails", name: "Cocktails", parentId: "drinks" },
      { id: "food", name: "Food", parentId: null },
    ],
    products: [{ id: "bread", name: "Bread", categoryId: null }],
    periods: [],
    cells: [
      {
        row: { kind: "category", categoryId: "cocktails" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
    ],
    canMakeDefault: true,
    defaultStationId: "bar",
    stations: [{ id: "bar", name: "Bar", active: true }],
    stationTimes: [
      {
        stationId: "bar",
        nextTransition: null,
        status: { open: true, why: "default" },
        hours: [],
        fallbackStationId: null,
        today: null,
        closedSendsTo: "bar",
      },
    ],
    todayEnds: { timeOfDay: "06:00", tomorrow: true },
    clockReadable: true,
  },
  stations: [
    {
      id: "bar",
      name: "Bar",
      active: true,
      isDefault: true,
      displayOrder: 1,
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
      timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
      timingOverrides: {
        warmAfterMinutes: null,
        overdueAfterMinutes: null,
        forgottenAfterMinutes: null,
      },
      showsRestOfOrder: false,
    },
  ],
  categories: [
    { id: "drinks", name: "Drinks", parentId: null },
    { id: "cocktails", name: "Cocktails", parentId: "drinks" },
    { id: "food", name: "Food", parentId: null },
  ],
  zones: [],
  products: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
  disabledWatchers: [],
};

class StationLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("station-leave-test-app", StationLeaveApp);
let app: StationLeaveApp;
afterEach(() => app?.remove());
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(write?: Promise<void>, refreshFails = false) {
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("station-leave-test-app") as StationLeaveApp;
  app.api = {
    load: async () => {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(view);
    },
    readStationHealth: async () => ({
      capturedAt: "2026-10-06T08:00:00Z",
      stations: [
        {
          id: "bar",
          name: "Bar",
          hasScreen: false,
          waiting: 0,
          preparing: null,
          ready: null,
          late: { warm: 0, overdue: 0, forgotten: 0 },
          oldestMinutes: null,
          items: [],
        },
      ],
      outputsDown: { printersDown: [], screensDark: [] },
    }),
    createStation: async (body: unknown) => {
      writes.push(body);
      await write;
    },
    updateStation: async (id: string, body: unknown) => {
      writes.push({ id, body });
      await write;
    },
  } as unknown as PrepStationsApi;
  setLocale("en");
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<PrepStationsScreen>(
    "dashboard-prep-stations-screen",
  )!;
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[data-test=new-station]"))
    .not.toBeNull();
  return { screen, writes };
}
async function open(screen: PrepStationsScreen, rename: boolean) {
  const root = rename
    ? screen
        .shadowRoot!.querySelector("prep-station-health-table")!
        .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!
    : screen.shadowRoot!;
  await expect
    .poll(() => root.querySelector(`[data-test=${rename ? "rename-bar" : "new-station"}]`))
    .not.toBeNull();
  root.querySelector<HTMLElement>(`[data-test=${rename ? "rename-bar" : "new-station"}]`)!.click();
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return modal;
}
async function field(modal: HTMLElementTagNameMap["wt-modal"], value: string, name = "name") {
  const input = modal.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${modal.hasAttribute("data-test") ? "stationName" : name}]`,
  )!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await ((modal.getRootNode() as ShadowRoot).host as PrepStationsScreen).updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
for (const rename of [false, true]) {
  const label = rename ? "Rename" : "Add";
  it(`${label} keeps name through native Escape and discards once without writing`, async () => {
    const { screen, writes } = await mount();
    const modal = await open(screen, rename);
    await field(modal, "Kitchen");
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("keep");
    expect(modal.querySelector("wt-input")!.value).toBe("Kitchen");
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await choose("discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
  it(`${label} clean and reverted submitted values close directly`, async () => {
    const { screen } = await mount();
    let modal = await open(screen, rename);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    modal = await open(screen, rename);
    await field(modal, "Kitchen");
    await field(modal, rename ? " Bar " : "");
    expect(unload()).toBe(false);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect((await question()).open).toBe(false);
  });
  it(`${label} accepted write commits before a refused refresh`, async () => {
    const { screen, writes } = await mount(undefined, true);
    const modal = await open(screen, rename);
    await field(modal, "Kitchen");
    modal
      .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-name" : "save-station"}]`)!
      .click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual(
      rename
        ? [{ id: "bar", body: { name: "Kitchen" } }]
        : [
            {
              name: "Kitchen",
              displayOrder: 0,
              warmAfterMinutes: 5,
              overdueAfterMinutes: 10,
              forgottenAfterMinutes: 15,
            },
          ],
    );
    expect(unload()).toBe(false);
  });
  it(`${label} refused write remains dirty and asks`, async () => {
    const write = deferred();
    const { screen } = await mount(write.promise);
    const modal = await open(screen, rename);
    await field(modal, "Kitchen");
    modal
      .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-name" : "save-station"}]`)!
      .click();
    write.reject({ code: "station.name_taken" });
    await expect
      .poll(() =>
        modal
          .querySelector<HTMLElement>(
            `[data-test=${rename ? "save-station-name" : "save-station"}]`,
          )!
          .hasAttribute("disabled"),
      )
      .toBe(false);
    expect(unload()).toBe(true);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await choose("keep");
    expect(modal.querySelector("wt-input")!.value).toBe("Kitchen");
  });
  it(`${label} pending write blocks cancellation and newer input stays dirty after success`, async () => {
    const write = deferred();
    const { screen } = await mount(write.promise);
    const modal = await open(screen, rename);
    await field(modal, "Kitchen");
    modal
      .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-name" : "save-station"}]`)!
      .click();
    await screen.updateComplete;
    expect(await modal.requestClose("cancel")).toBe(false);
    expect((await question()).open).toBe(false);
    await field(modal, "Newer kitchen");
    write.resolve();
    await expect
      .poll(() =>
        modal
          .querySelector<HTMLElement>(
            `[data-test=${rename ? "save-station-name" : "save-station"}]`,
          )!
          .hasAttribute("disabled"),
      )
      .toBe(false);
    expect(modal.isConnected).toBe(true);
    expect(modal.querySelector("wt-input")!.value).toBe("Newer kitchen");
    expect(unload()).toBe(true);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await choose("discard");
  });
  it(`${label} disconnect aborts its pending question and unload handling`, async () => {
    const { screen } = await mount();
    const modal = await open(screen, rename);
    await field(modal, "Kitchen");
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    expect((await question()).open).toBe(true);
    screen.remove();
    await expect.poll(async () => (await question()).open).toBe(false);
    expect(unload()).toBe(false);
  });
}

for (const rename of [false, true])
  for (const refused of [false, true]) {
    it(`${rename ? "Rename" : "Add"} departed ${refused ? "refused" : "accepted"} write and field events cannot affect a new editor`, async () => {
      const write = deferred();
      const { screen } = await mount(write.promise);
      const old = await open(screen, rename);
      await field(old, "Kitchen");
      old
        .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-name" : "save-station"}]`)!
        .click();
      await screen.updateComplete;
      screen.remove();
      app.shadowRoot!.append(screen);
      await screen.updateComplete;
      const next = await open(screen, rename);
      await field(next, "New station draft");
      old
        .querySelector("wt-input")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed input" } }));
      if (refused) write.reject({ code: "station.name_taken" });
      else write.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await screen.updateComplete;
      expect(next.isConnected).toBe(true);
      expect(
        next
          .querySelector(`[data-test=${rename ? "save-station-name" : "save-station"}]`)!
          .hasAttribute("disabled"),
      ).toBe(false);
      expect(next.querySelector("wt-input")!.value).toBe("New station draft");
      expect(unload()).toBe(true);
      expect(next.querySelector("[role=alert]")).toBeNull();
    });
  }
for (const [name, changed, reverted] of [
  ["displayOrder", "3", "0"],
  ["warmAfterMinutes", "6", "5"],
  ["overdueAfterMinutes", "12", "10"],
  ["forgottenAfterMinutes", "20", "15"],
] as const) {
  it(`Add compares ${name} after its existing numeric conversion`, async () => {
    const { screen } = await mount();
    const modal = await open(screen, false);
    await field(modal, changed, name);
    expect(unload()).toBe(true);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await choose("keep");
    await field(modal, reverted, name);
    expect(unload()).toBe(false);
    expect(await modal.requestClose("cancel")).toBe(true);
  });
}

for (const rename of [false, true]) {
  it(`${rename ? "Rename" : "Add"} reconnects its retained editor with a coordinated Save scope`, async () => {
    const { screen, writes } = await mount();
    await open(screen, rename);
    screen.remove();
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const modal = screen.shadowRoot!.querySelector("wt-modal")!;
    const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${rename ? "save-station-name" : "save-station"}]`,
    )!;
    await save.updateComplete;
    expect(save.variant).toBe("secondary");
    expect(save.disabled).toBe(true);
    save.click();
    await screen.updateComplete;
    expect(writes).toEqual([]);
    await field(modal, "After reconnect");
    await save.updateComplete;
    expect(save.variant).toBe("primary");
    expect(save.disabled).toBe(false);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    expect((await question()).open).toBe(true);
    await choose("keep");
    expect(modal.querySelector("wt-input")!.value).toBe("After reconnect");
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await choose("discard");
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
}

for (const rename of [false, true]) {
  it(`${rename ? "Rename" : "Add"} retains its dirty baseline through reconnect and quiets on undo`, async () => {
    const { screen, writes } = await mount();
    await open(screen, rename);
    const before = screen.shadowRoot!.querySelector("wt-modal")!;
    const original = before.querySelector("wt-input")!.value;
    await field(before, "Retained edit");
    screen.remove();
    await screen.updateComplete;
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const modal = screen.shadowRoot!.querySelector("wt-modal")!;
    const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${rename ? "save-station-name" : "save-station"}]`,
    )!;
    await save.updateComplete;
    expect(modal.querySelector("wt-input")!.value).toBe("Retained edit");
    expect(save.variant).toBe("primary");
    expect(save.disabled).toBe(false);
    expect(unload()).toBe(true);
    await field(modal, original);
    await save.updateComplete;
    expect(save.variant).toBe("secondary");
    expect(save.disabled).toBe(true);
    expect(unload()).toBe(false);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await screen.updateComplete;
    expect(writes).toEqual([]);
  });
}
