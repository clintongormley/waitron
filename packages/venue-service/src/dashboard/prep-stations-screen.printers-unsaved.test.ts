import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens, type WtCombobox } from "@waitron/ui";
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
    {
      id: "kitchen",
      name: "Kitchen",
      active: true,
      isDefault: false,
      displayOrder: 2,
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
  printers: [
    { id: "old", name: "Old printer", active: true },
    { id: "next", name: "Next printer", active: true },
  ],
  stationPrinters: [{ stationId: "bar", printerId: "old" }],
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

class PrinterLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("printer-leave-test-app", PrinterLeaveApp);
let app: PrinterLeaveApp;
afterEach(() => {
  app?.remove();
  history.replaceState(null, "", "/manage");
  setLocale("en");
});
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
  history.replaceState(null, "", "/manage/prep-stations/view/tickets");
  setLocale("en");
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("printer-leave-test-app") as PrinterLeaveApp;
  app.api = {
    load: async () => {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(initial);
    },
    readStationHealth: async () => ({
      capturedAt: "2026-10-06T12:00:00Z",
      stations: [],
      outputsDown: { printersDown: [], screensDark: [] },
    }),
    setStationPrinters: async (id: string, ids: readonly string[]) => {
      writes.push({ id, ids: [...ids] });
      await write;
    },
  } as unknown as PrepStationsApi;
  applyTokens(app);
  app.style.cssText =
    "display:block;background:var(--wt-color-bg);color:var(--wt-color-text);font-family:var(--wt-font-family);";
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<PrepStationsScreen>(
    "dashboard-prep-stations-screen",
  )!;
  await expect.poll(() => cell(screen, "edit-printers-bar")).not.toBeNull();
  return { screen, writes, reads: () => reads };
}
function cell(screen: PrepStationsScreen, key: string) {
  return (
    screen
      .shadowRoot!.querySelector("[data-test=tickets-table]")
      ?.shadowRoot?.querySelector<HTMLElement>(`[data-test=${key}]`) ?? null
  );
}
async function settle(screen: PrepStationsScreen) {
  await screen.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  await (screen.shadowRoot!.querySelector("[data-test=tickets-table]") as LitElement)
    ?.updateComplete;
}
async function open(screen: PrepStationsScreen, station = "bar") {
  cell(screen, `edit-printers-${station}`)!.click();
  await settle(screen);
}
async function change(screen: PrepStationsScreen, ids: string[]) {
  cell(screen, "station-printers-bar")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values: ids }, bubbles: true, composed: true }),
  );
  await settle(screen);
}
function shown(screen: PrepStationsScreen, station = "bar") {
  return (cell(screen, `station-printers-${station}`) as WtCombobox | null)?.values;
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
it.each(["cancel", "escape"])(
  "printer %s asks, Keep retains choices and Discard closes without writing",
  async (how) => {
    const { screen, writes } = await mount();
    await open(screen);
    await change(screen, ["old", "next"]);
    expect(unload()).toBe(true);
    if (how === "cancel") cell(screen, "cancel-printers-bar")!.click();
    else {
      const control = cell(screen, "station-printers-bar") as WtCombobox;
      await control.updateComplete;
      const trigger = control.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
      let escapeDefaultPrevented: boolean | undefined;
      control.addEventListener("keydown", (event) => {
        if (event.key === "Escape") escapeDefaultPrevented = event.defaultPrevented;
      });
      await userEvent.click(trigger);
      await expect
        .poll(() => control.shadowRoot!.querySelector("[popover]")!.matches(":popover-open"))
        .toBe(true);
      await userEvent.keyboard("{Escape}");
      await expect
        .poll(() => control.shadowRoot!.querySelector("[popover]")!.matches(":popover-open"))
        .toBe(false);
      expect((await question()).open).toBe(false);
      trigger.focus();
      expect(control.shadowRoot!.activeElement).toBe(trigger);
      await userEvent.keyboard("{Escape}");
      expect(escapeDefaultPrevented).toBe(true);
    }
    await expect.poll(async () => (await question()).open).toBe(true);
    expect(shown(screen)).toEqual(["old", "next"]);
    await choose("keep");
    expect(shown(screen)).toEqual(["old", "next"]);
    cell(screen, "cancel-printers-bar")!.click();
    await choose("discard");
    await expect.poll(() => shown(screen)).toBeUndefined();
    expect(unload()).toBe(false);
    expect(writes).toEqual([]);
    await open(screen);
    expect(shown(screen)).toEqual(["old"]);
  },
);
it("clean and reverted membership closes without warning, including reordered selections", async () => {
  const initial = structuredClone(view);
  initial.stationPrinters.push({ stationId: "bar", printerId: "next" });
  const { screen, writes } = await mount(undefined, false, initial);
  await open(screen);
  await change(screen, []);
  expect(unload()).toBe(true);
  await change(screen, ["next", "old"]);
  expect(unload()).toBe(false);
  cell(screen, "cancel-printers-bar")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});
it("switching printer cells asks and Keep retains the original station", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, ["next"]);
  cell(screen, "edit-printers-kitchen")!.click();
  await choose("keep");
  expect(shown(screen)).toEqual(["next"]);
  expect(shown(screen, "kitchen")).toBeUndefined();
  cell(screen, "edit-printers-kitchen")!.click();
  await choose("discard");
  await expect.poll(() => shown(screen, "kitchen")).toEqual([]);
  expect(shown(screen)).toBeUndefined();
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it("accepted printer write clears the draft before a refused refresh", async () => {
  const { screen, writes } = await mount(undefined, true);
  await open(screen);
  await change(screen, ["next"]);
  cell(screen, "save-printers-bar")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect(unload()).toBe(false);
  expect(writes).toEqual([{ id: "bar", ids: ["next"] }]);
  await expect.poll(() => screen.shadowRoot!.textContent).toContain("could not be loaded");
});
it("refused printer write keeps choices dirty for retry and Cancel", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  await open(screen);
  await change(screen, ["next"]);
  cell(screen, "save-printers-bar")!.click();
  write.reject({ code: "printer.not_found" });
  await expect.poll(() => (cell(screen, "station-printers-bar") as WtCombobox)?.error).not.toBe("");
  expect(shown(screen)).toEqual(["next"]);
  expect(unload()).toBe(true);
  cell(screen, "cancel-printers-bar")!.click();
  await choose("keep");
  expect(writes).toEqual([{ id: "bar", ids: ["next"] }]);
});
it("newer selections remain dirty against the accepted submitted snapshot", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  await open(screen);
  await change(screen, ["next"]);
  cell(screen, "save-printers-bar")!.click();
  await settle(screen);
  await change(screen, ["old", "next"]);
  write.resolve();
  await expect.poll(() => cell(screen, "save-printers-bar")?.hasAttribute("disabled")).toBe(false);
  expect(shown(screen)).toEqual(["old", "next"]);
  expect(unload()).toBe(true);
  expect(writes).toEqual([{ id: "bar", ids: ["next"] }]);
  await change(screen, ["next"]);
  expect(unload()).toBe(false);
  cell(screen, "cancel-printers-bar")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
});
it("leaving the actual Tickets tab asks and restores the printer draft on Discard", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, ["next"]);
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  const target = () => tabs.shadowRoot!.querySelector<HTMLButtonElement>("[data-key=settings]")!;
  target().click();
  await choose("keep");
  expect(location.pathname).toBe("/manage/prep-stations/view/tickets");
  expect(shown(screen)).toEqual(["next"]);
  target().click();
  await choose("discard");
  await expect.poll(() => location.pathname).toBe("/manage/prep-stations/view/settings");
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it.each([false, true])(
  "disconnected printer editor ignores an old %s reply on reconnect",
  async (refused) => {
    const write = deferred();
    const { screen, writes, reads } = await mount(write.promise);
    await open(screen);
    await change(screen, ["next"]);
    cell(screen, "save-printers-bar")!.click();
    await settle(screen);
    screen.remove();
    expect(unload()).toBe(false);
    app.shadowRoot!.append(screen);
    await settle(screen);
    expect(shown(screen)).toBeUndefined();
    await open(screen);
    await change(screen, ["old", "next"]);
    const before = reads();
    if (refused) write.reject({ code: "printer.not_found" });
    else write.resolve();
    await settle(screen);
    await settle(screen);
    expect(shown(screen)).toEqual(["old", "next"]);
    expect((cell(screen, "station-printers-bar") as WtCombobox).error).toBe("");
    expect(reads()).toBe(before);
    expect(unload()).toBe(true);
    expect(writes).toEqual([{ id: "bar", ids: ["next"] }]);
  },
);
it("pristine printer form leaves without a question or write", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  expect(unload()).toBe(false);
  cell(screen, "cancel-printers-bar")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});
it("pending printer write refuses Cancel, Escape and tab leave until its reply", async () => {
  const write = deferred();
  const { screen } = await mount(write.promise);
  await open(screen);
  await change(screen, ["next"]);
  cell(screen, "save-printers-bar")!.click();
  await settle(screen);
  cell(screen, "cancel-printers-bar")!.click();
  cell(screen, "station-printers-bar")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
  );
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  tabs.shadowRoot!.querySelector<HTMLButtonElement>("[data-key=settings]")!.click();
  await settle(screen);
  expect(location.pathname).toBe("/manage/prep-stations/view/tickets");
  expect(shown(screen)).toEqual(["next"]);
  expect((await question()).open).toBe(false);
  write.resolve();
  await expect.poll(() => shown(screen)).toBeUndefined();
});
it("the current Tickets tab does not discard or ask about its draft", async () => {
  const { screen } = await mount();
  await open(screen);
  await change(screen, ["next"]);
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  tabs.shadowRoot!.querySelector<HTMLButtonElement>("[data-key=tickets]")!.click();
  await settle(screen);
  expect((await question()).open).toBe(false);
  expect(shown(screen)).toEqual(["next"]);
  expect(unload()).toBe(true);
});
it("a retained printer control cannot change or save a replacement editor", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  const old = cell(screen, "station-printers-bar")!;
  const save = cell(screen, "save-printers-bar")!;
  await open(screen, "kitchen");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  save.click();
  await settle(screen);
  expect(shown(screen, "kitchen")).toEqual([]);
  expect(shown(screen)).toBeUndefined();
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
it("a retained clean Settings cell cannot bypass the visible printer draft on tab leave", async () => {
  const { screen, writes } = await mount();
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  const tab = (key: string) =>
    tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key=${key}]`)!;
  tab("settings").click();
  await settle(screen);
  const settings = screen.shadowRoot!.querySelector("[data-test=settings-table]")!;
  await (settings as LitElement).updateComplete;
  settings.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-settings-rest-bar]")!.click();
  await settle(screen);
  tab("tickets").click();
  await settle(screen);
  await open(screen);
  await change(screen, ["next"]);
  tab("settings").click();
  await expect.poll(async () => (await question()).open).toBe(true);
  expect(tabs.value).toBe("tickets");
  await choose("keep");
  expect(tabs.value).toBe("tickets");
  expect(shown(screen)).toEqual(["next"]);
  expect(location.pathname).toBe("/manage/prep-stations/view/tickets");
  expect(writes).toEqual([]);
});
