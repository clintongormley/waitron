import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceApi } from "./client.js";
import "./service-settings-panel.js";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens, type WtCombobox, type WtInput } from "@waitron/ui";
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

class SettingsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("settings-leave-test-app", SettingsLeaveApp);
let app: SettingsLeaveApp;
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
  history.replaceState(null, "", "/manage/prep-stations/view/settings");
  setLocale("en");
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("settings-leave-test-app") as SettingsLeaveApp;
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
    updateStation: async (id: string, body: unknown) => {
      writes.push({ id, body });
      await write;
    },
    setStationFallback: async (id: string, target: string | null) => {
      writes.push({ id, target });
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
  await expect.poll(() => cell(screen, "[data-test=edit-settings-rest-bar]")).not.toBeNull();
  return { screen, writes };
}
function cell(screen: PrepStationsScreen, selector: string) {
  return (
    screen
      .shadowRoot!.querySelector("[data-test=settings-table]")
      ?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null
  );
}
async function settle(screen: PrepStationsScreen) {
  await screen.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  await (screen.shadowRoot!.querySelector("[data-test=settings-table]") as LitElement)
    ?.updateComplete;
}
async function open(screen: PrepStationsScreen, field = "rest", station = "bar") {
  cell(screen, `[data-test=edit-settings-${field}-${station}]`)!.click();
  await settle(screen);
}
async function change(screen: PrepStationsScreen, value: string, selector = "settings-choice") {
  cell(screen, `[data-test=${selector}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(screen);
}
function shown(screen: PrepStationsScreen, selector = "settings-choice") {
  return (cell(screen, `[data-test=${selector}]`) as WtCombobox | WtInput | null)?.value;
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
  "asks before %s discards a Settings cell and Keep retains its value",
  async (how) => {
    const { screen, writes } = await mount();
    await open(screen);
    await change(screen, "yes");
    expect(unload()).toBe(true);
    if (how === "cancel") cell(screen, "[data-test=cancel-settings-cell]")!.click();
    else
      cell(screen, "[data-test=settings-choice]")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
      );
    expect((await question()).open).toBe(true);
    expect(shown(screen)).toBe("yes");
    await choose("keep");
    expect(shown(screen)).toBe("yes");
    expect(writes).toEqual([]);
    cell(screen, "[data-test=cancel-settings-cell]")!.click();
    await choose("discard");
    await expect.poll(() => shown(screen)).toBeUndefined();
    expect(unload()).toBe(false);
    expect(writes).toEqual([]);
    await open(screen);
    expect(shown(screen)).toBe("no");
  },
);
it("asks before replacing one edited Settings cell with another", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, "yes");
  await open(screen, "warmAfterMinutes");
  expect((await question()).open).toBe(true);
  await choose("keep");
  expect(shown(screen)).toBe("yes");
  expect(shown(screen, "settings-minutes")).toBeUndefined();
  await open(screen, "warmAfterMinutes");
  await choose("discard");
  await settle(screen);
  expect(shown(screen, "settings-minutes")).toBe("");
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it("a reverted cell and an unchanged timing cell leave without a warning", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, "yes");
  await change(screen, "no");
  expect(unload()).toBe(false);
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await settle(screen);
  expect((await question()).open).toBe(false);
  expect(shown(screen)).toBeUndefined();
  await open(screen, "warmAfterMinutes");
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await settle(screen);
  expect(shown(screen, "settings-minutes")).toBeUndefined();
  expect(writes).toEqual([]);
});
it("keeps refused Settings values protected and clears protection on the accepted retry", async () => {
  const wait = deferred();
  const { screen, writes } = await mount(wait.promise);
  await open(screen);
  await change(screen, "yes");
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await settle(screen);
  wait.reject({ code: "station.not_found" });
  await settle(screen);
  expect(shown(screen)).toBe("yes");
  expect(unload()).toBe(true);
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await choose("keep");
  expect(shown(screen)).toBe("yes");
  app.api.updateStation = async (id, body) => {
    writes.push({ id, body });
  };
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect(writes).toEqual([
    { id: "bar", body: { showsRestOfOrder: true } },
    { id: "bar", body: { showsRestOfOrder: true } },
  ]);
  expect(unload()).toBe(false);
});
it("commits an accepted Settings value before a failing refresh", async () => {
  const { screen, writes } = await mount(undefined, true);
  await open(screen);
  await change(screen, "yes");
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect(writes).toEqual([{ id: "bar", body: { showsRestOfOrder: true } }]);
  expect(unload()).toBe(false);
  await expect.poll(() => screen.shadowRoot!.textContent).toContain("could not be loaded");
});
it("timing values compare their submitted numbers while invalid text remains unsaved", async () => {
  const { screen } = await mount();
  await open(screen, "warmAfterMinutes");
  await change(screen, "6", "settings-minutes");
  expect(unload()).toBe(true);
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await choose("discard");
  await settle(screen);
  await open(screen, "warmAfterMinutes");
  await change(screen, " ", "settings-minutes");
  expect(unload()).toBe(false);
  await change(screen, "invalid", "settings-minutes");
  expect(unload()).toBe(true);
});

it("keeps the Settings tab and its draft visible until the leave decision", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, "yes");
  const tabs = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;
  const leave = () =>
    tabs.dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "stations" } }));
  leave();
  expect((await question()).open).toBe(true);
  await settle(screen);
  expect(tabs.value).toBe("settings");
  expect(location.pathname).toBe("/manage/prep-stations/view/settings");
  await choose("keep");
  expect(tabs.value).toBe("settings");
  expect(shown(screen)).toBe("yes");
  leave();
  await choose("discard");
  await expect.poll(() => tabs.value).toBe("stations");
  await expect.poll(() => location.pathname).toBe("/manage/prep-stations/view/stations");
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it("ignores stale field events after another Settings editor replaces their owner", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  const old = cell(screen, "[data-test=settings-choice]")!;
  await open(screen, "warmAfterMinutes");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "yes" } }));
  await settle(screen);
  expect(shown(screen, "settings-minutes")).toBe("");
  expect(shown(screen)).toBeUndefined();
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it.each(["resolve", "reject"] as const)(
  "an old save's %s cannot replace a reconnected Settings draft",
  async (result) => {
    const wait = deferred();
    const { screen, writes } = await mount(wait.promise);
    await open(screen);
    await change(screen, "yes");
    cell(screen, "[data-test=save-settings-cell]")!.click();
    await settle(screen);
    screen.remove();
    expect(unload()).toBe(false);
    app.shadowRoot!.prepend(screen);
    await settle(screen);
    await open(screen, "warmAfterMinutes");
    await change(screen, "6", "settings-minutes");
    if (result === "resolve") wait.resolve();
    else wait.reject({ code: "station.not_found" });
    await settle(screen);
    expect(shown(screen, "settings-minutes")).toBe("6");
    expect(unload()).toBe(true);
    expect(writes).toEqual([{ id: "bar", body: { showsRestOfOrder: true } }]);
  },
);
it("holds the submitted value during a save and refuses replacement and extra writes", async () => {
  const wait = deferred();
  const { screen, writes } = await mount(wait.promise);
  await open(screen);
  await change(screen, "yes");
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await settle(screen);
  await change(screen, "no");
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await open(screen, "warmAfterMinutes");
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await settle(screen);
  expect(shown(screen)).toBe("yes");
  expect(shown(screen, "settings-minutes")).toBeUndefined();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([{ id: "bar", body: { showsRestOfOrder: true } }]);
  wait.resolve();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect(unload()).toBe(false);
});

it("ignores an old Save control after another Settings cell replaces it", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  const oldSave = cell(screen, "[data-test=save-settings-cell]")!;
  await open(screen, "warmAfterMinutes");
  await change(screen, "6", "settings-minutes");
  oldSave.click();
  await settle(screen);
  expect(writes).toEqual([]);
  expect(shown(screen, "settings-minutes")).toBe("6");
  expect(unload()).toBe(true);
});
it("a timing override's equivalent submitted number is clean", async () => {
  const initial = structuredClone(view);
  initial.stations[0]!.timingOverrides.warmAfterMinutes = 6;
  initial.stations[0]!.warmAfterMinutes = 6;
  const { screen, writes } = await mount(undefined, false, initial);
  await open(screen, "warmAfterMinutes");
  await change(screen, " 06 ", "settings-minutes");
  expect(unload()).toBe(false);
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await settle(screen);
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});
it("protects a fallback choice until its existing two-step confirmation writes it", async () => {
  const initial = structuredClone(view);
  initial.stations.push({
    ...structuredClone(initial.stations[0]!),
    id: "grill",
    name: "Grill",
    isDefault: false,
  });
  initial.routing.stations.push({ id: "grill", name: "Grill", active: true });
  initial.routing.stationTimes.push({
    ...structuredClone(initial.routing.stationTimes[0]!),
    stationId: "grill",
    fallbackStationId: "bar",
  });
  const { screen, writes } = await mount(undefined, false, initial);
  await open(screen, "fallback", "grill");
  await change(screen, "");
  expect(unload()).toBe(true);
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  await choose("keep");
  expect(shown(screen)).toBe("");
  await change(screen, "bar");
  expect(unload()).toBe(false);
  await change(screen, "");
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await settle(screen);
  expect(writes).toEqual([]);
  expect(unload()).toBe(true);
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect(writes).toEqual([{ id: "grill", target: null }]);
  expect(unload()).toBe(false);
});

it("a successful write makes an older pending Cancel answer inert", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, "yes");
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  const old = await question();
  expect(old.open).toBe(true);
  cell(screen, "[data-test=save-settings-cell]")!.click();
  await expect.poll(() => shown(screen)).toBeUndefined();
  expect((await question()).open).toBe(false);
  await open(screen, "warmAfterMinutes");
  await change(screen, "6", "settings-minutes");
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(screen);
  expect(shown(screen, "settings-minutes")).toBe("6");
  expect(unload()).toBe(true);
  expect(writes).toEqual([{ id: "bar", body: { showsRestOfOrder: true } }]);
});
it("a disconnected Settings draft releases unload protection and its pending answer", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await change(screen, "yes");
  cell(screen, "[data-test=cancel-settings-cell]")!.click();
  const old = await question();
  expect(old.open).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
  app.shadowRoot!.prepend(screen);
  await settle(screen);
  await open(screen, "warmAfterMinutes");
  await change(screen, "6", "settings-minutes");
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(screen);
  expect(shown(screen, "settings-minutes")).toBe("6");
  expect(writes).toEqual([]);
});

it.each(["light", "dark"])(
  "the Settings warning and retained editor are accessible in %s",
  async (theme) => {
    const { screen } = await mount();
    app.setAttribute("data-theme", theme);
    await open(screen);
    await change(screen, "yes");
    cell(screen, "[data-test=cancel-settings-cell]")!.click();
    expect((await question()).open).toBe(true);
    await expectNoA11yViolations(app);
    await choose("keep");
    expect(shown(screen)).toBe("yes");
    await expectNoA11yViolations(app);
  },
);
it("immediately saved service controls remain exempt while saving and after a refusal", async () => {
  await mount();
  const wait = deferred();
  const writes: unknown[] = [];
  const panel = document.createElement("dashboard-venue-service-settings");
  panel.api = {
    loadSettings: async () => ({
      settings: { editSentLines: true },
      kitchenTicketGrouping: "combined",
      printHeldWork: false,
      releaseReminderMinutes: 10,
      clearingWorkflow: false,
    }),
    saveSettings: async (input: unknown) => {
      writes.push(input);
      await wait.promise;
    },
  } as unknown as VenueServiceApi;
  app.shadowRoot!.append(panel);
  await expect.poll(() => panel.shadowRoot!.querySelector("wt-switch")).not.toBeNull();
  const control = panel.shadowRoot!.querySelector("wt-switch")!;
  await control.updateComplete;
  control.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
  await panel.updateComplete;
  expect(writes).toEqual([{ editSentLines: false }]);
  expect(unload()).toBe(false);
  wait.reject({ code: "connection.failed" });
  await expect.poll(() => panel.shadowRoot!.textContent).toContain("could not be saved");
  expect(control.shadowRoot!.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
  expect(unload()).toBe(false);
  let left = false;
  await app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed: () => {
      left = true;
    },
  });
  expect(left).toBe(true);
  expect((await question()).open).toBe(false);
});

it.each(["rest", "warmAfterMinutes"])(
  "native Escape keeps the Settings %s warning open until the next answer",
  async (field) => {
    const { screen, writes } = await mount();
    await open(screen, field);
    await change(
      screen,
      field === "rest" ? "yes" : "8",
      field === "rest" ? "settings-choice" : "settings-minutes",
    );
    const control = cell(
      screen,
      field === "rest" ? "[data-test=settings-choice]" : "[data-test=settings-minutes]",
    ) as WtCombobox | WtInput;
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector<HTMLElement>(
      field === "rest" ? ".trigger" : "input",
    )!;
    await userEvent.click(native);
    if (field === "rest") {
      await userEvent.keyboard("{Escape}");
      await expect
        .poll(() => control.shadowRoot!.querySelector("[popover]")!.matches(":popover-open"))
        .toBe(false);
    }
    native.focus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(async () => (await question()).open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(async () => (await question()).open).toBe(false);
    expect(shown(screen, field === "rest" ? "settings-choice" : "settings-minutes")).toBe(
      field === "rest" ? "yes" : "8",
    );
    expect(unload()).toBe(true);
    expect(writes).toEqual([]);
  },
);
