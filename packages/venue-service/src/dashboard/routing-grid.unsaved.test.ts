import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PrepStationsApi, PrepStationsView } from "./routing-client.js";
import { PrepStationsScreen } from "./prep-stations-screen.js";
const view: PrepStationsView = {
  routing: {
    zones: [{ id: "terrace", name: "Terrace" }],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "food", name: "Food", parentId: null },
    ],
    products: [{ id: "bread", name: "Bread", categoryId: "food" }],
    cells: [
      {
        row: { kind: "category", categoryId: "drinks" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
    ],
    canMakeDefault: true,
    defaultStationId: "bar",
    stations: [
      { id: "bar", name: "Bar", active: true },
      { id: "kitchen", name: "Kitchen", active: true },
    ],
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
    { id: "food", name: "Food", parentId: null },
  ],
  zones: [{ id: "terrace", name: "Terrace" }],
  products: [{ id: "bread", name: "Bread" }],
  testProducts: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
  disabledWatchers: [],
};

class CellLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("routing-cell-leave-test-app", CellLeaveApp);
let app: CellLeaveApp;
afterEach(() => {
  app?.remove();
  history.replaceState(null, "", "/manage");
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
const move = {
  productId: "bread",
  productName: "Bread",
  zoneId: "terrace",
  zoneName: "Terrace",
  from: { kind: "station", stationId: "bar" },
  to: { kind: "station", stationId: "kitchen" },
};
/** `refresh` holds every read after the first until it settles; a rejected one fails them. */
async function mount(write?: Promise<void>, refresh?: Promise<void>) {
  history.replaceState(null, "", "/manage/prep-stations/view/routing");
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("routing-cell-leave-test-app") as CellLeaveApp;
  app.api = {
    load: async () => {
      if (++reads > 1 && refresh) await refresh;
      return structuredClone(view);
    },
    readStationHealth: async () => ({
      capturedAt: "2026-10-07T08:00:00Z",
      stations: [],
      outputsDown: { printersDown: [], screensDark: [] },
    }),
    preview: async () => [move],
    setCell: async (address: unknown, target: unknown) => {
      writes.push({ address, target });
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
  await expect.poll(() => screen.shadowRoot?.querySelector("venue-routing-grid")).not.toBeNull();
  return { screen, writes, reads: () => reads };
}
type Grid = HTMLElement & { updateComplete: Promise<unknown> };
const grid = (screen: PrepStationsScreen) =>
  screen.shadowRoot!.querySelector<Grid>("venue-routing-grid")!;
const combo = (screen: PrepStationsScreen, row: string, zone: string) =>
  grid(screen).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `td[data-row="${row}"][data-zone="${zone}"] wt-combobox[name="routing-target"]`,
  )!;
async function shown(screen: PrepStationsScreen, row: string, zone: string) {
  await screen.updateComplete;
  await grid(screen).updateComplete;
  const box = combo(screen, row, zone);
  await box.updateComplete;
  return box.value;
}
async function choose(screen: PrepStationsScreen, row: string, zone: string, label: string) {
  await grid(screen).updateComplete;
  const box = combo(screen, row, zone);
  await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  const option = [...box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent!.trim() === label,
  )!;
  await userEvent.click(option);
}
async function preview(screen: PrepStationsScreen) {
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=routing-preview]"))
    .not.toBeNull();
  await screen.updateComplete;
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    "[data-test=routing-preview]",
  )!;
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
async function answer(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function changeTab(screen: PrepStationsScreen, value: string) {
  screen
    .shadowRoot!.querySelector("wt-tabs")!
    .dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value } }));
}
const tab = (screen: PrepStationsScreen) =>
  screen.shadowRoot!.querySelector<HTMLElement & { value: string }>("wt-tabs")!.value;

describe("a pending routing cell choice", () => {
  it("a pending choice asks on tab change and on navigation; Keep retains it, Discard restores without a write", async () => {
    const { screen, writes } = await mount();
    await choose(screen, "c:drinks", "terrace", "Kitchen");
    await preview(screen);
    expect(unload()).toBe(true);

    changeTab(screen, "stations");
    await answer("keep");
    expect(tab(screen)).toBe("routing");
    expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).not.toBeNull();
    expect(await shown(screen, "c:drinks", "terrace")).toBe("station:kitchen");

    let left = false;
    const navigation = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        left = true;
      },
    });
    await answer("keep");
    await navigation;
    expect(left).toBe(false);
    expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).not.toBeNull();

    const discarded = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        left = true;
      },
    });
    await answer("discard");
    await discarded;
    expect(left).toBe(true);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=routing-preview]"))
      .toBeNull();
    expect(await shown(screen, "c:drinks", "terrace")).toBe("");
    expect(unload()).toBe(false);

    await choose(screen, "c:drinks", "terrace", "Kitchen");
    await preview(screen);
    changeTab(screen, "stations");
    await answer("discard");
    await expect.poll(() => tab(screen)).toBe("stations");
    expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
    expect(await shown(screen, "c:drinks", "terrace")).toBe("");
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });

  for (const how of ["Cancel", "Escape"] as const) {
    it(`preview ${how} restores without a second question`, async () => {
      const { screen, writes } = await mount();
      await choose(screen, "c:drinks", "every", "Kitchen");
      const confirmation = await preview(screen);
      expect(unload()).toBe(true);
      if (how === "Cancel")
        confirmation.querySelector<HTMLElement>("[data-test=cancel-routing]")!.click();
      else await userEvent.keyboard("{Escape}");
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=routing-preview]"))
        .toBeNull();
      expect((await question()).open).toBe(false);
      expect(await shown(screen, "c:drinks", "every")).toBe("station:bar");
      expect(unload()).toBe(false);
      expect(writes).toEqual([]);
    });
  }

  it("Confirm commits before a failed refresh", async () => {
    const refresh = deferred();
    const { screen, writes, reads } = await mount(undefined, refresh.promise);
    await choose(screen, "c:drinks", "terrace", "Kitchen");
    const confirmation = await preview(screen);
    confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
    await expect.poll(reads).toBe(2);
    expect(writes).toEqual([
      {
        address: { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
        target: { kind: "station", stationId: "kitchen" },
      },
    ]);
    // The refresh is still open: the written choice is saved, so nothing asks.
    expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
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
    changeTab(screen, "stations");
    await expect.poll(() => tab(screen)).toBe("stations");
    expect((await question()).open).toBe(false);
    changeTab(screen, "routing");
    await expect.poll(() => tab(screen)).toBe("routing");

    refresh.reject({ code: "connection.failed" });
    await expect
      .poll(() => screen.shadowRoot!.textContent)
      .toContain("Prep stations could not be loaded.");
    // The write succeeded, so the cell keeps showing it until a read replaces the model.
    expect(await shown(screen, "c:drinks", "terrace")).toBe("station:kitchen");
    expect(unload()).toBe(false);
    changeTab(screen, "stations");
    await expect.poll(() => tab(screen)).toBe("stations");
    expect((await question()).open).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it("disconnect disposes the pending question", async () => {
    const { screen } = await mount();
    await choose(screen, "c:drinks", "terrace", "Kitchen");
    await preview(screen);
    changeTab(screen, "stations");
    expect((await question()).open).toBe(true);
    screen.remove();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
  });

  for (const refused of [false, true]) {
    it(`a departed confirmed ${refused ? "refusal" : "save"} cannot change a replacement editor`, async () => {
      const write = deferred();
      const { screen, writes } = await mount(write.promise);
      await choose(screen, "c:drinks", "terrace", "Kitchen");
      const confirmation = await preview(screen);
      confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
      await expect.poll(() => writes.length).toBe(1);
      screen.remove();
      app.shadowRoot!.append(screen);
      await screen.updateComplete;
      expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
      await choose(screen, "c:food", "every", "Kitchen");
      await preview(screen);
      if (refused) write.reject({ code: "route.station_inactive" });
      else write.resolve();
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      await screen.updateComplete;
      expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).not.toBeNull();
      expect(await shown(screen, "c:food", "every")).toBe("station:kitchen");
      expect(combo(screen, "c:drinks", "terrace").error).toBe("");
      expect(grid(screen).shadowRoot!.textContent).not.toContain("This station is disabled");
      expect(unload()).toBe(true);
      changeTab(screen, "stations");
      await answer("keep");
      expect(writes).toHaveLength(1);
    });
  }
});
