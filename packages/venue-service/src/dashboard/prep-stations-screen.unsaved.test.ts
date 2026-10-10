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

        status: { open: true, why: "default" },

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
        .shadowRoot!.querySelector("prep-station-table")!
        .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!
    : screen.shadowRoot!;
  await expect
    .poll(() => root.querySelector(`[data-test=${rename ? "edit-bar" : "new-station"}]`))
    .not.toBeNull();
  root.querySelector<HTMLElement>(`[data-test=${rename ? "edit-bar" : "new-station"}]`)!.click();
  await screen.updateComplete;
  const modal = modalIn(screen)!;
  await modal.updateComplete;
  return modal;
}
/** The open station form: Add station is drawn by the screen, Edit by its station editor. */
function modalIn(screen: PrepStationsScreen) {
  return (
    screen.shadowRoot!.querySelector("wt-modal") ??
    screen
      .shadowRoot!.querySelector("prep-station-editor")
      ?.shadowRoot?.querySelector("wt-modal") ??
    null
  );
}
/** The form's `wt-close`; take it before the click that closes it. */
function closeOf(modal: HTMLElementTagNameMap["wt-modal"]) {
  return new Promise((resolve) => modal.addEventListener("wt-close", resolve, { once: true }));
}
async function field(modal: HTMLElementTagNameMap["wt-modal"], value: string, name = "name") {
  const input = modal.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${modal.hasAttribute("data-test") ? "stationName" : name}]`,
  )!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await ((modal.getRootNode() as ShadowRoot).host as PrepStationsScreen).updateComplete;
  await modal.updateComplete;
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
  const label = rename ? "Edit" : "Add";
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
    const closed = closeOf(modal);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await choose("discard");
    await closed;
    await expect.poll(() => modalIn(screen)).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
  it(`${label} clean and reverted submitted values close directly`, async () => {
    const { screen } = await mount();
    let modal = await open(screen, rename);
    let closed = closeOf(modal);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await closed;
    await expect.poll(() => modalIn(screen)).toBeNull();
    modal = await open(screen, rename);
    await field(modal, "Kitchen");
    await field(modal, rename ? " Bar " : "");
    expect(unload()).toBe(false);
    closed = closeOf(modal);
    modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
    await closed;
    await expect.poll(() => modalIn(screen)).toBeNull();
    expect((await question()).open).toBe(false);
  });
  it(`${label} accepted write commits before a refused refresh`, async () => {
    const { screen, writes } = await mount(undefined, true);
    const modal = await open(screen, rename);
    await field(modal, "Kitchen");
    modal
      .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-edit" : "save-station"}]`)!
      .click();
    await expect.poll(() => modalIn(screen)).toBeNull();
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
      .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-edit" : "save-station"}]`)!
      .click();
    write.reject({ code: "station.name_taken" });
    await expect
      .poll(() =>
        modal
          .querySelector<HTMLElement>(
            `[data-test=${rename ? "save-station-edit" : "save-station"}]`,
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
      .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-edit" : "save-station"}]`)!
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
            `[data-test=${rename ? "save-station-edit" : "save-station"}]`,
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
    it(`${rename ? "Edit" : "Add"} departed ${refused ? "refused" : "accepted"} write and field events cannot affect a new editor`, async () => {
      const write = deferred();
      const { screen } = await mount(write.promise);
      const old = await open(screen, rename);
      await field(old, "Kitchen");
      old
        .querySelector<HTMLElement>(`[data-test=${rename ? "save-station-edit" : "save-station"}]`)!
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
          .querySelector(`[data-test=${rename ? "save-station-edit" : "save-station"}]`)!
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
  it(`${rename ? "Edit" : "Add"} reconnects its retained editor with a coordinated Save scope`, async () => {
    const { screen, writes } = await mount();
    const before = await open(screen, rename);
    screen.remove();
    await screen.updateComplete;
    if (!rename) expect(modalIn(screen)).toBeNull();
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const modal = modalIn(screen)!;
    // The station editor keeps its own draft while away, but draws a new dialog on its return.
    if (rename) expect(modal).not.toBe(before);
    const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${rename ? "save-station-edit" : "save-station"}]`,
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
  it(`${rename ? "Edit" : "Add"} retains its dirty baseline through reconnect and quiets on undo`, async () => {
    const { screen, writes } = await mount();
    await open(screen, rename);
    const before = modalIn(screen)!;
    const original = before.querySelector("wt-input")!.value;
    await field(before, "Retained edit");
    screen.remove();
    await screen.updateComplete;
    expect(unload()).toBe(false);
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const modal = modalIn(screen)!;
    const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${rename ? "save-station-edit" : "save-station"}]`,
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

for (const outcome of ["written", "refused"] as const) {
  it(`Edit ignores a save ${outcome} after reconnect once a newer save is sent`, async () => {
    const { screen } = await mount();
    const requests: { name: unknown; write: ReturnType<typeof deferred> }[] = [];
    app.api.updateStation = (async (_id: string, body: { name?: unknown }) => {
      const write = deferred();
      requests.push({ name: body.name, write });
      await write.promise;
    }) as PrepStationsApi["updateStation"];
    const first = await open(screen, true);
    await field(first, "First");
    first.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
    await expect.poll(() => requests.length).toBe(1);
    screen.remove();
    await screen.updateComplete;
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const modal = modalIn(screen)!;
    await field(modal, "Second");
    const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-station-edit]",
    )!;
    save.click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests.map((request) => request.name)).toEqual(["First", "Second"]);
    await expect.poll(() => save.loading).toBe(true);
    if (outcome === "written") requests[0]!.write.resolve();
    else requests[0]!.write.reject({ code: "station.name_taken" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await screen.updateComplete;
    expect(modalIn(screen)).not.toBeNull();
    expect(save.loading).toBe(true);
    expect(modal.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error).toBe("");
    requests[1]!.write.resolve();
    await expect.poll(() => modalIn(screen)).toBeNull();
  });
}

for (const outcome of ["written", "refused"] as const) {
  it(`Edit counts a lone save ${outcome} after reconnect when no newer save was sent`, async () => {
    const { screen } = await mount();
    const requests: ReturnType<typeof deferred>[] = [];
    app.api.updateStation = (async () => {
      const write = deferred();
      requests.push(write);
      await write.promise;
    }) as PrepStationsApi["updateStation"];
    const first = await open(screen, true);
    await field(first, "First");
    first.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
    await expect.poll(() => requests.length).toBe(1);
    screen.remove();
    await screen.updateComplete;
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const modal = modalIn(screen)!;
    const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-station-edit]",
    )!;
    if (outcome === "written") {
      requests[0]!.resolve();
      await expect.poll(() => modalIn(screen)).toBeNull();
    } else {
      requests[0]!.reject({ code: "station.name_taken" });
      await expect
        .poll(() => modal.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error)
        .not.toBe("");
      expect(modalIn(screen)).toBe(modal);
      await save.updateComplete;
      expect(save.loading).toBe(false);
    }
    expect(requests).toHaveLength(1);
  });
}

it("Edit keeps a redrawn editor open when a lone save written after reconnect finds it changed", async () => {
  const { screen } = await mount();
  const write = deferred();
  app.api.updateStation = (async () => {
    await write.promise;
  }) as PrepStationsApi["updateStation"];
  const load = app.api.load.bind(app.api);
  let loads = 0;
  app.api.load = (async () => {
    loads++;
    return load();
  }) as PrepStationsApi["load"];
  const first = await open(screen, true);
  await field(first, "First");
  first.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
  screen.remove();
  await screen.updateComplete;
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  const modal = modalIn(screen)!;
  await field(modal, "Typed while it was sent");
  await expect.poll(() => loads).toBe(1);
  write.resolve();
  await expect.poll(() => loads).toBe(2);
  await screen.updateComplete;
  expect(modalIn(screen)).toBe(modal);
  expect(modal.querySelector("wt-input")!.value).toBe("Typed while it was sent");
  expect(unload()).toBe(true);
});
