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
  zones: [{ id: "terrace", name: "Terrace", active: true }],
  products: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [
    {
      id: "pass",
      name: "Pass",
      active: true,
      displayOrder: 7,
      everyStation: false,
      stationIds: ["bar"],
      everyZone: false,
      zoneIds: ["terrace"],
      runsPass: false,
      printerIds: [],
      inUse: false,
    },
  ],
  disabledWatchers: [],
};

class WatcherLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("watcher-leave-test-app", WatcherLeaveApp);
let app: WatcherLeaveApp;
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
async function mount(write?: Promise<void>, refreshFails = false, initial = view) {
  history.replaceState(null, "", "/manage/prep-stations/view/watchers");
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("watcher-leave-test-app") as WatcherLeaveApp;
  app.api = {
    load: async () => {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(initial);
    },
    setWatcherPrinters: async (id: string, ids: string[]) => {
      writes.push({ id, ids: [...ids] });
      await write;
    },
    updateWatcher: async (id: string, body: unknown) => {
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
    .poll(() => screen.shadowRoot?.querySelector("[data-test=watchers-table]"))
    .not.toBeNull();
  return { screen, writes };
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
async function openRename(screen: PrepStationsScreen) {
  const table = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    "[data-test=watchers-table]",
  )!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-watcher-pass]")!.click();
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    "[data-test=watcher-rename-modal]",
  )!;
  await modal.updateComplete;
  return modal;
}
async function renameName(screen: PrepStationsScreen, modal: HTMLElement, name: string) {
  modal
    .querySelector("[data-test=watcher-rename-name]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: name } }));
  await screen.updateComplete;
}
function renameValue(modal: HTMLElement) {
  return modal.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=watcher-rename-name]")!
    .value;
}
function renameCancel(modal: HTMLElement) {
  modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
}
function renameSave(modal: HTMLElement) {
  modal.querySelector<HTMLElement>("[data-test=save-watcher-name]")!.click();
}
for (const route of ["cancel", "escape"] as const) {
  it(`Watcher Rename ${route} keeps edits until explicit Discard without writing`, async () => {
    const { screen, writes } = await mount();
    const modal = await openRename(screen);
    await renameName(screen, modal, "  Expo  ");
    if (route === "cancel") renameCancel(modal);
    else await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("keep");
    expect(renameValue(modal)).toBe("  Expo  ");
    expect(unload()).toBe(true);
    renameCancel(modal);
    await choose("discard");
    await expect.poll(() => modal.isConnected).toBe(false);
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("Watcher Rename clean and normalized reverted names close directly", async () => {
  const { screen } = await mount();
  let modal = await openRename(screen);
  renameCancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  modal = await openRename(screen);
  await renameName(screen, modal, "Expo");
  expect(unload()).toBe(true);
  await renameName(screen, modal, "  Pass  ");
  expect(unload()).toBe(false);
  renameCancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect((await question()).open).toBe(false);
});
it("Watcher Rename accepted body commits before a failed refresh and invalidates a pending question", async () => {
  const { screen, writes } = await mount(undefined, true);
  const modal = await openRename(screen);
  await renameName(screen, modal, "  Expo  ");
  const leaving = modal.requestClose("cancel");
  expect((await question()).open).toBe(true);
  renameSave(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(await leaving).toBe(false);
  expect((await question()).open).toBe(false);
  expect(unload()).toBe(false);
  expect(writes).toEqual([
    {
      id: "pass",
      body: {
        name: "Expo",
        everyStation: false,
        stationIds: ["bar"],
        everyZone: false,
        zoneIds: ["terrace"],
        runsPass: false,
        displayOrder: 7,
      },
    },
  ]);
});
it("Watcher Rename refuses a write without losing its draft or discard protection", async () => {
  const write = deferred();
  const { screen } = await mount(write.promise);
  const modal = await openRename(screen);
  await renameName(screen, modal, "Expo");
  renameSave(modal);
  write.reject({ code: "watcher.name_taken" });
  await expect
    .poll(() => modal.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error)
    .not.toBe("");
  renameCancel(modal);
  await choose("keep");
  expect(renameValue(modal)).toBe("Expo");
  expect(unload()).toBe(true);
});
it("Watcher Rename retains newer input against its submitted baseline", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const modal = await openRename(screen);
  await renameName(screen, modal, "Expo");
  renameSave(modal);
  await screen.updateComplete;
  expect(await modal.requestClose("cancel")).toBe(false);
  await renameName(screen, modal, "Later expo");
  write.resolve();
  await expect.poll(() => modal.dismissible).toBe(true);
  expect(modal.isConnected).toBe(true);
  expect(renameValue(modal)).toBe("Later expo");
  expect(writes).toHaveLength(1);
  expect(unload()).toBe(true);
  await renameName(screen, modal, "  Expo  ");
  expect(unload()).toBe(false);
  renameCancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
});
it("Watcher Rename background render does not invalidate a pending discard", async () => {
  const { screen } = await mount();
  const modal = await openRename(screen);
  await renameName(screen, modal, "Expo");
  renameCancel(modal);
  expect((await question()).open).toBe(true);
  screen.requestUpdate();
  await screen.updateComplete;
  await choose("discard");
  await expect.poll(() => modal.isConnected).toBe(false);
});
it("Watcher Rename disconnect aborts its decision and removes unload protection", async () => {
  const { screen } = await mount();
  const modal = await openRename(screen);
  await renameName(screen, modal, "Expo");
  renameCancel(modal);
  expect((await question()).open).toBe(true);
  screen.remove();
  await expect.poll(async () => (await question()).open).toBe(false);
  expect(unload()).toBe(false);
});

for (const refused of [false, true]) {
  it(`Watcher Rename departed ${refused ? "refusal" : "acceptance"} cannot alter a replacement write`, async () => {
    const oldWrite = deferred();
    const nextWrite = deferred();
    const { screen, writes } = await mount(oldWrite.promise);
    const old = await openRename(screen);
    await renameName(screen, old, "Old expo");
    renameSave(old);
    await screen.updateComplete;
    screen.remove();
    screen.api = {
      ...screen.api,
      updateWatcher: async () => nextWrite.promise,
    } as unknown as PrepStationsApi;
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const next = await openRename(screen);
    await renameName(screen, next, "Next expo");
    renameSave(next);
    await screen.updateComplete;
    if (refused) oldWrite.reject({ code: "watcher.name_taken" });
    else oldWrite.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(next.isConnected).toBe(true);
    expect(renameValue(next)).toBe("Next expo");
    expect(next.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error).toBe("");
    expect(await next.requestClose("cancel")).toBe(false);
    expect((await question()).open).toBe(false);
    expect(writes).toHaveLength(1);
    nextWrite.resolve();
    await expect.poll(() => next.isConnected).toBe(false);
  });
}
it("Watcher Rename departed controls and native close cannot edit or submit a new opening", async () => {
  const { screen, writes } = await mount();
  const old = await openRename(screen);
  renameCancel(old);
  await expect.poll(() => old.isConnected).toBe(false);
  const next = await openRename(screen);
  await renameName(screen, next, "Next expo");
  await renameName(screen, old, "Old expo");
  renameSave(old);
  old.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  old
    .querySelector("wt-input")!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await screen.updateComplete;
  expect(writes).toEqual([]);
  expect(next.isConnected).toBe(true);
  expect(renameValue(next)).toBe("Next expo");
});
it("Watcher Rename keeps newer input when its in-flight write is refused", async () => {
  const write = deferred();
  const { screen } = await mount(write.promise);
  const modal = await openRename(screen);
  await renameName(screen, modal, "Expo");
  renameSave(modal);
  await screen.updateComplete;
  await renameName(screen, modal, "Newer expo");
  write.reject({ code: "connection.failed" });
  await expect.poll(() => modal.dismissible).toBe(true);
  expect(renameValue(modal)).toBe("Newer expo");
  expect(unload()).toBe(true);
  renameCancel(modal);
  await choose("keep");
});

function watcherCellRoot(screen: PrepStationsScreen) {
  return screen.shadowRoot!.querySelector("[data-test=watchers-table]")!.shadowRoot!;
}
async function openCell(
  screen: PrepStationsScreen,
  field: "follows" | "zones" | "pass" | "printers",
) {
  const root = watcherCellRoot(screen);
  root.querySelector<HTMLElement>(`[data-test=edit-watcher-${field}-pass]`)!.click();
  await expect.poll(() => root.querySelector("wt-combobox")).not.toBeNull();
  return root.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!;
}
async function changeCell(screen: PrepStationsScreen, values: string[]) {
  watcherCellRoot(screen)
    .querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { values, value: values[0] ?? "" } }));
  await screen.updateComplete;
  await (watcherCellRoot(screen).host as LitElement).updateComplete;
}
function cellAction(screen: PrepStationsScreen, action: "cancel" | "save", printers = false) {
  watcherCellRoot(screen)
    .querySelector<HTMLElement>(
      `[data-test=${action}-watcher-${printers ? "printers-pass" : "cell"}]`,
    )!
    .click();
}
for (const field of ["follows", "zones", "pass", "printers"] as const) {
  const original =
    field === "follows"
      ? ["bar"]
      : field === "zones"
        ? ["terrace"]
        : field === "pass"
          ? ["no"]
          : [];
  const edited = field === "pass" ? ["yes"] : field === "printers" ? ["paper"] : ["__every__"];
  const printers = field === "printers";
  it(`Watcher inline ${field} keeps edited selections on Cancel and Escape, then discards without a write`, async () => {
    const { screen, writes } = await mount();
    const combo = await openCell(screen, field);
    await changeCell(screen, edited);
    expect(unload()).toBe(true);
    cellAction(screen, "cancel", printers);
    expect((await question()).open).toBe(true);
    await choose("keep");
    expect(combo.isConnected).toBe(true);
    expect(printers || field !== "pass" ? combo.values : [combo.value]).toEqual(edited);
    await expect
      .poll(
        () =>
          app
            .shadowRoot!.querySelector("wt-unsaved-changes")!
            .shadowRoot!.querySelector("wt-modal")
            ?.shadowRoot!.querySelector("dialog")?.open ?? false,
      )
      .toBe(false);
    const trigger = combo.shadowRoot!.querySelector<HTMLElement>("button")!;
    trigger.focus();
    expect(combo.shadowRoot!.activeElement).toBe(trigger);
    const keys: string[] = [];
    combo.addEventListener("keydown", (event) => keys.push((event as KeyboardEvent).key));
    await userEvent.keyboard("{Escape}");
    expect(keys).toEqual(["Escape"]);
    expect(unload()).toBe(true);
    await expect.poll(async () => (await question()).open).toBe(true);
    await choose("discard");
    await expect.poll(() => combo.isConnected).toBe(false);
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
  it(`Watcher inline ${field} closes unchanged and reverted selections directly`, async () => {
    const { screen } = await mount();
    let combo = await openCell(screen, field);
    cellAction(screen, "cancel", printers);
    await expect.poll(() => combo.isConnected).toBe(false);
    combo = await openCell(screen, field);
    await changeCell(screen, edited);
    await changeCell(screen, original);
    expect(unload()).toBe(false);
    cellAction(screen, "cancel", printers);
    await expect.poll(() => combo.isConnected).toBe(false);
    expect((await question()).open).toBe(false);
  });
  it(`Watcher inline ${field} commits accepted selections before a refused refresh`, async () => {
    const { screen, writes } = await mount(undefined, true);
    const combo = await openCell(screen, field);
    await changeCell(screen, edited);
    cellAction(screen, "save", printers);
    await expect.poll(() => combo.isConnected).toBe(false);
    expect(writes).toEqual(
      printers
        ? [{ id: "pass", ids: edited }]
        : [
            {
              id: "pass",
              body: {
                name: "Pass",
                everyStation: field === "follows",
                stationIds: field === "follows" ? [] : ["bar"],
                everyZone: field === "zones",
                zoneIds: field === "zones" ? [] : ["terrace"],
                runsPass: field === "pass",
                displayOrder: 7,
              },
            },
          ],
    );
    expect(unload()).toBe(false);
    expect((await question()).open).toBe(false);
  });
  it(`Watcher inline ${field} retains a newer selection on write refusal`, async () => {
    const write = deferred();
    const { screen } = await mount(write.promise);
    const combo = await openCell(screen, field);
    await changeCell(screen, edited);
    cellAction(screen, "save", printers);
    await changeCell(screen, field === "pass" ? ["no"] : []);
    write.reject({ code: "connection.failed" });
    await expect.poll(() => combo.disabled).toBe(false);
    expect(field === "pass" ? [combo.value] : combo.values).toEqual(field === "pass" ? ["no"] : []);
    expect(unload()).toBe(field !== "pass" && !printers);
    if (field !== "pass" && !printers) {
      cellAction(screen, "cancel");
      expect((await question()).open).toBe(true);
      await choose("keep");
    }
  });
  it(`Watcher inline ${field} retains newer input against the submitted baseline after success`, async () => {
    const write = deferred();
    const { screen, writes } = await mount(write.promise);
    const combo = await openCell(screen, field);
    await changeCell(screen, edited);
    cellAction(screen, "save", printers);
    await changeCell(screen, original);
    write.resolve();
    await expect.poll(() => combo.disabled).toBe(false);
    expect(combo.isConnected).toBe(true);
    expect(field === "pass" ? [combo.value] : combo.values).toEqual(original);
    expect(writes).toHaveLength(1);
    expect(unload()).toBe(true);
    await changeCell(screen, edited);
    expect(unload()).toBe(false);
    cellAction(screen, "cancel", printers);
    await expect.poll(() => combo.isConnected).toBe(false);
  });
}
it("Watcher inline replacement asks before discarding and ignores departed selection/save controls", async () => {
  const { screen, writes } = await mount();
  const old = await openCell(screen, "follows");
  await changeCell(screen, ["__every__"]);
  const oldSave = watcherCellRoot(screen).querySelector<HTMLElement>(
    "[data-test=save-watcher-cell]",
  )!;
  watcherCellRoot(screen)
    .querySelector<HTMLElement>("[data-test=edit-watcher-zones-pass]")!
    .click();
  expect((await question()).open).toBe(true);
  await choose("keep");
  expect(old.isConnected).toBe(true);
  watcherCellRoot(screen)
    .querySelector<HTMLElement>("[data-test=edit-watcher-zones-pass]")!
    .click();
  await choose("discard");
  await expect.poll(() => old.isConnected).toBe(false);
  const current =
    watcherCellRoot(screen).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!;
  expect(current.name).toBe("zoneIds");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { values: [], value: "" } }));
  oldSave.click();
  await screen.updateComplete;
  expect(current.values).toEqual(["terrace"]);
  expect(writes).toEqual([]);
});
it("Watcher inline disconnect aborts the warning and a late write cannot affect a new opening", async () => {
  const write = deferred();
  const { screen } = await mount(write.promise);
  await openCell(screen, "follows");
  await changeCell(screen, ["__every__"]);
  cellAction(screen, "cancel");
  const q = await question();
  expect(q.open).toBe(true);
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await openCell(screen, "zones");
  await changeCell(screen, ["__every__"]);
  cellAction(screen, "save");
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  const next = await openCell(screen, "pass");
  write.resolve();
  await expect.poll(() => next.disabled).toBe(false);
  expect(next.isConnected).toBe(true);
  expect(next.value).toBe("no");
});

for (const field of ["follows", "zones", "printers"] as const) {
  it(`Watcher inline ${field} compares saved membership independently of selection order`, async () => {
    const initial = structuredClone(view);
    const watcher = initial.watchers[0]!;
    if (field === "follows") watcher.stationIds = ["bar", "other"];
    else if (field === "zones") watcher.zoneIds = ["terrace", "other"];
    else watcher.printerIds = ["paper", "other"];
    const ids =
      field === "follows"
        ? watcher.stationIds
        : field === "zones"
          ? watcher.zoneIds
          : watcher.printerIds;
    const { screen } = await mount(undefined, false, initial);
    const combo = await openCell(screen, field);
    await changeCell(screen, [...ids].reverse());
    expect(unload()).toBe(false);
    cellAction(screen, "cancel", field === "printers");
    await expect.poll(() => combo.isConnected).toBe(false);
    expect((await question()).open).toBe(false);
  });
}
it("Watcher inline printer commit and refresh leave an independently edited follows choice dirty", async () => {
  const initial = structuredClone(view);
  const { screen, writes } = await mount(undefined, false, initial);
  const combo = await openCell(screen, "follows");
  await changeCell(screen, ["__every__"]);
  const root = watcherCellRoot(screen);
  root.querySelector<HTMLElement>("[data-test=edit-watcher-printers-pass]")!.click();
  await expect.poll(() => root.querySelector("[data-test=watcher-printers-pass]")).not.toBeNull();
  root
    .querySelector("[data-test=watcher-printers-pass]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["paper"] } }));
  await screen.updateComplete;
  initial.watchers[0]!.stationIds = ["changed-in-background"];
  cellAction(screen, "save", true);
  await expect.poll(() => root.querySelector("[data-test=watcher-printers-pass]")).toBeNull();
  expect(combo.values).toEqual(["__every__"]);
  expect(unload()).toBe(true);
  cellAction(screen, "cancel");
  await choose("keep");
  await changeCell(screen, ["bar"]);
  expect(unload()).toBe(false);
  expect(writes).toEqual([{ id: "pass", ids: ["paper"] }]);
});
it("Watcher inline changing a draft invalidates a pending discard answer", async () => {
  const { screen, writes } = await mount();
  const combo = await openCell(screen, "follows");
  await changeCell(screen, ["__every__"]);
  cellAction(screen, "cancel");
  const q = await question();
  expect(q.open).toBe(true);
  await changeCell(screen, []);
  await expect.poll(() => q.open).toBe(false);
  q.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(combo.isConnected).toBe(true);
  expect(combo.values).toEqual([]);
  expect(unload()).toBe(true);
  expect(writes).toEqual([]);
});
it("Watcher inline printer replacement protects its draft and departed controls", async () => {
  const initial = structuredClone(view);
  initial.watchers.push({ ...initial.watchers[0]!, id: "runner", name: "Runner", displayOrder: 8 });
  const { screen, writes } = await mount(undefined, false, initial);
  const combo = await openCell(screen, "printers");
  await changeCell(screen, ["paper"]);
  const root = watcherCellRoot(screen);
  const oldSave = root.querySelector<HTMLElement>("[data-test=save-watcher-printers-pass]")!;
  root.querySelector<HTMLElement>("[data-test=edit-watcher-printers-runner]")!.click();
  await choose("keep");
  expect(combo.isConnected).toBe(true);
  root.querySelector<HTMLElement>("[data-test=edit-watcher-printers-runner]")!.click();
  await choose("discard");
  await expect.poll(() => combo.isConnected).toBe(false);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["other"] } }));
  oldSave.click();
  await screen.updateComplete;
  expect(
    (
      root.querySelector(
        "[data-test=watcher-printers-runner]",
      ) as HTMLElementTagNameMap["wt-combobox"]
    ).values,
  ).toEqual([]);
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
