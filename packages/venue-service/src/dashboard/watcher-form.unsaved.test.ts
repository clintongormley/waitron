import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PrepStationsApi, PrepStationsView } from "./routing-client.js";
import { PrepStationsScreen } from "./prep-stations-screen.js";
const view: PrepStationsView = {
  routing: {
    claims: [
      { categoryId: "cocktails", target: { kind: "station", stationId: "bar" }, stationOff: false },
    ],
    exceptions: [],
    unassigned: {
      folders: [{ id: "food", name: "Food" }],
      products: [{ id: "bread", name: "Bread" }],
    },
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
  zones: [{ id: "terrace", name: "Terrace", active: true }],
  products: [{ id: "bread", name: "Bread" }],
  testProducts: [{ id: "bread", name: "Bread" }],
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

import type { WatcherForm } from "./watcher-form.js";
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
async function mount(write?: Promise<void>, refreshFails = false) {
  history.replaceState(null, "", "/manage/prep-stations/view/watchers");
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("watcher-leave-test-app") as WatcherLeaveApp;
  app.api = {
    load: async () => {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(view);
    },
    readStationHealth: async () => ({
      capturedAt: "2026-10-06T08:00:00Z",
      stations: [],
      outputsDown: { printersDown: [], screensDark: [] },
    }),
    createWatcher: async (body: unknown) => {
      writes.push(body);
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
    .poll(() => screen.shadowRoot?.querySelector("[data-test=new-watcher]"))
    .not.toBeNull();
  return { screen, writes };
}
async function open(screen: PrepStationsScreen) {
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=new-watcher]")!.click();
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    "[data-test=watcher-modal]",
  )!;
  await modal.updateComplete;
  const form = modal.querySelector<WatcherForm>("watcher-form")!;
  await form.updateComplete;
  return { modal, form };
}
async function change(form: WatcherForm, name: string, detail: object) {
  form
    .shadowRoot!.querySelector(`[name=${name}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail }));
  await form.updateComplete;
}
function value(form: WatcherForm) {
  return (form.shadowRoot!.querySelector("[name=name]") as HTMLElementTagNameMap["wt-input"]).value;
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
function cancel(form: WatcherForm) {
  form.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!.click();
}
function save(form: WatcherForm) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save-watcher]")!.click();
}
async function valid(form: WatcherForm) {
  await change(form, "name", { value: "  Runner  " });
  await change(form, "everyStation", { checked: true });
  await change(form, "everyZone", { checked: true });
}
it("Watcher keeps its name through native Escape and discards without writing", async () => {
  const { screen, writes } = await mount();
  const { form, modal } = await open(screen);
  await change(form, "name", { value: "Runner" });
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question()).open).toBe(true);
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await choose("keep");
  expect(value(form)).toBe("Runner");
  cancel(form);
  await choose("discard");
  await expect.poll(() => form.isConnected).toBe(false);
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
it("Watcher clean and normalized reverted fields close without a question", async () => {
  const { screen } = await mount();
  let { form } = await open(screen);
  cancel(form);
  await expect.poll(() => form.isConnected).toBe(false);
  ({ form } = await open(screen));
  await change(form, "name", { value: "Runner" });
  await change(form, "name", { value: "  " });
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => form.isConnected).toBe(false);
  expect((await question()).open).toBe(false);
});
for (const [name, detail] of [
  ["everyStation", { checked: true }],
  ["stationIds", { checked: true }],
  ["everyZone", { checked: true }],
  ["zoneIds", { checked: true }],
  ["runsPass", { checked: true }],
] as const) {
  it(`Watcher protects ${name} and recognizes its revert`, async () => {
    const { screen } = await mount();
    const { form } = await open(screen);
    await change(form, name, detail);
    expect(unload()).toBe(true);
    cancel(form);
    await choose("keep");
    await change(form, name, { checked: false });
    expect(unload()).toBe(false);
    cancel(form);
    await expect.poll(() => form.isConnected).toBe(false);
  });
}
it("Watcher accepted write commits its submitted values before refresh fails", async () => {
  const { screen, writes } = await mount(undefined, true);
  const { form } = await open(screen);
  await valid(form);
  save(form);
  await expect.poll(() => form.isConnected).toBe(false);
  expect(writes).toEqual([
    {
      name: "Runner",
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: false,
    },
  ]);
  expect(unload()).toBe(false);
});
it("Watcher refused write retains its name and requires a discard decision", async () => {
  const write = deferred();
  const { screen } = await mount(write.promise);
  const { form } = await open(screen);
  await valid(form);
  save(form);
  write.reject({ code: "watcher.name_taken" });
  await expect.poll(() => form.shadowRoot!.querySelector("[data-field-error=name]")).not.toBeNull();
  expect(unload()).toBe(true);
  cancel(form);
  await choose("keep");
  expect(value(form)).toBe("  Runner  ");
});
it("Watcher blocks pending write dismissal and retains newer input after acceptance", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const { form, modal } = await open(screen);
  await valid(form);
  save(form);
  await screen.updateComplete;
  await form.updateComplete;
  expect(await modal.requestClose("cancel")).toBe(false);
  expect((await question()).open).toBe(false);
  await change(form, "name", { value: "Later runner" });
  write.resolve();
  await expect.poll(() => form.busy).toBe(false);
  expect(form.isConnected).toBe(true);
  expect(writes).toHaveLength(1);
  expect(unload()).toBe(true);
  await change(form, "name", { value: "Runner" });
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => form.isConnected).toBe(false);
});
it("Watcher disconnect aborts its question and removes unload handling", async () => {
  const { screen } = await mount();
  const { form } = await open(screen);
  await change(form, "name", { value: "Runner" });
  cancel(form);
  expect((await question()).open).toBe(true);
  screen.remove();
  await expect.poll(async () => (await question()).open).toBe(false);
  expect(unload()).toBe(false);
});

it("Watcher seeded edit keeps its starting snapshot across refreshed rows and offered order", async () => {
  const { screen } = await mount();
  const { form } = await open(screen);
  form.watcher = { ...view.watchers[0]!, stationIds: ["bar", "grill"] };
  form.stations = [
    { id: "bar", name: "Bar" },
    { id: "grill", name: "Grill" },
  ];
  await form.updateComplete;
  expect(unload()).toBe(false);
  await change(form, "name", { value: "Local draft" });
  form.watcher = { ...form.watcher, name: "Remote change", displayOrder: 9 };
  form.stations = [...form.stations].reverse();
  await form.updateComplete;
  expect(value(form)).toBe("Local draft");
  cancel(form);
  await choose("keep");
  await change(form, "name", { value: "  Pass  " });
  expect(unload()).toBe(false);
  const writes: unknown[] = [];
  form.addEventListener("watcher-save", (event) =>
    writes.push((event as CustomEvent).detail.input),
  );
  save(form);
  expect(writes).toEqual([
    {
      name: "Pass",
      everyStation: false,
      stationIds: ["grill", "bar"],
      everyZone: false,
      zoneIds: ["terrace"],
      runsPass: false,
      displayOrder: 7,
    },
  ]);
});
it("Watcher submitting while a leave question is pending invalidates the old answer", async () => {
  const { screen } = await mount();
  const { form, modal } = await open(screen);
  await valid(form);
  const leaving = modal.requestClose("cancel");
  const q = await question();
  expect(q.open).toBe(true);
  save(form);
  await expect.poll(() => form.isConnected).toBe(false);
  expect(await leaving).toBe(false);
  await expect.poll(() => q.open).toBe(false);
  const next = await open(screen);
  q.dispatchEvent(new CustomEvent("wt-unsaved-choice", { detail: { decision: "discard" } }));
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  cancel(form);
  save(form);
  await screen.updateComplete;
  expect(next.form.isConnected).toBe(true);
  expect(value(next.form)).toBe("");
});
for (const refused of [false, true]) {
  it(`Watcher departed ${refused ? "refusal" : "acceptance"} cannot release a new pending write`, async () => {
    const oldWrite = deferred();
    const newWrite = deferred();
    const { screen } = await mount(oldWrite.promise);
    const old = await open(screen);
    await valid(old.form);
    save(old.form);
    await screen.updateComplete;
    screen.remove();
    screen.api = {
      ...screen.api,
      createWatcher: async () => newWrite.promise,
    } as unknown as PrepStationsApi;
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const next = await open(screen);
    await valid(next.form);
    save(next.form);
    await screen.updateComplete;
    if (refused) oldWrite.reject({ code: "watcher.name_taken" });
    else oldWrite.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    await next.form.updateComplete;
    expect(next.form.busy).toBe(true);
    expect(await next.modal.requestClose("cancel")).toBe(false);
    expect((await question()).open).toBe(false);
    expect(next.form.refusal).toBeUndefined();
    newWrite.resolve();
    await expect.poll(() => next.form.isConnected).toBe(false);
  });
}
it("Watcher removed form cannot submit through its retained host callback", async () => {
  const { screen, writes } = await mount();
  const { form } = await open(screen);
  await valid(form);
  form.remove();
  save(form);
  await screen.updateComplete;
  expect(writes).toEqual([]);
});
it("Watcher background host render leaves the pending discard close valid", async () => {
  const { screen } = await mount();
  const { form } = await open(screen);
  await change(form, "name", { value: "Runner" });
  cancel(form);
  expect((await question()).open).toBe(true);
  screen.requestUpdate();
  await screen.updateComplete;
  await choose("discard");
  await expect.poll(() => form.isConnected).toBe(false);
  expect(unload()).toBe(false);
});

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
