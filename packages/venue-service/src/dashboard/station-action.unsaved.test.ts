import type { RetiredFallbackPrepStationsView as PrepStationsView } from "../../test/retired-routing-fixture-types.js";
import { afterEach, expect, it } from "vitest";
import { userEvent, page } from "vitest/browser";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { PrepStationsApi, StationDisableChoice } from "./routing-client.js";
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
};

class StationActionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("station-action-leave-test-app", StationActionLeaveApp);
let app: StationActionLeaveApp;
afterEach(() => {
  app?.remove();
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
async function mount(write?: Promise<void>, refreshFails = false, deactivate?: Promise<void>) {
  const writes: unknown[] = [];
  let reads = 0;
  const model = structuredClone(view);
  for (const [id, name] of [
    ["kitchen", "Kitchen"],
    ["grill", "Grill"],
  ]) {
    model.stations.push({ ...model.stations[0]!, id: id!, name: name!, isDefault: false });
    model.routing.stations.push({ id: id!, name: name!, active: true });
    model.routing.stationTimes.push({
      ...model.routing.stationTimes[0]!,
      stationId: id!,
      status: { open: true, why: "open" },
      closedSendsTo: null,
    });
  }
  history.replaceState(null, "", "/manage/prep-stations/view/stations");
  app = document.createElement("station-action-leave-test-app") as StationActionLeaveApp;
  const liveData = new LiveData();
  app.api = {
    liveData,
    load: async () => {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(model);
    },
    setStationFallback: async (id: string, choice: string | null) => {
      writes.push({ fallback: id, choice });
      await write;
      model.routing.stationTimes.find((row) => row.stationId === id)!.fallbackStationId = choice;
    },
    readStationClosing: async (id: string) => ({
      openDishCount: id === "bar" ? 0 : 3,
      destinations: model.stations
        .filter((row) => row.active && row.id !== id)
        .map(({ id, name, isDefault }) => ({ id, name, isDefault })),
    }),
    deactivateStation: async (id: string, choice?: StationDisableChoice) => {
      writes.push({ deactivate: id, ...(choice ? { choice } : {}) });
      await (deactivate ?? write);
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
  return { screen, writes, model, liveData, readCount: () => reads };
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

async function open(screen: PrepStationsScreen, id = "kitchen") {
  const table = screen
    .shadowRoot!.querySelector("prep-station-table")!
    .shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>(`[data-test=disable-${id}]`)!.click();
  await screen.updateComplete;
  await expect
    .poll(() => screen.shadowRoot!.querySelector("station-disable-dialog"))
    .not.toBeNull();
  const dialog = screen.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<boolean> }
  >("station-disable-dialog")!;
  await dialog.updateComplete;
  await expect
    .poll(() => dialog.shadowRoot?.querySelector("[data-test=disable-confirm]"))
    .not.toBeNull();
  const modal = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  await modal.updateComplete;
  return modal;
}
async function change(
  screen: PrepStationsScreen,
  modal: HTMLElementTagNameMap["wt-modal"],
  value: string,
) {
  modal
    .querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await ((modal.getRootNode() as ShadowRoot).host as LitElement).updateComplete;
  await screen.updateComplete;
}
function cancel(modal: HTMLElementTagNameMap["wt-modal"]) {
  modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
}
async function save(screen: PrepStationsScreen, modal: HTMLElementTagNameMap["wt-modal"]) {
  modal.querySelector<HTMLElement>("[data-test=disable-confirm]")!.click();
  await ((modal.getRootNode() as ShadowRoot).host as LitElement).updateComplete;
  await screen.updateComplete;
}
for (const route of ["cancel", "escape"] as const) {
  it(`Disable station ${route} protects its selected disposition without issuing a command`, async () => {
    const { screen, writes } = await mount();
    const modal = await open(screen);
    await change(screen, modal, "bar");
    if (route === "cancel") cancel(modal);
    else await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("keep");
    expect(modal.querySelector("wt-combobox")!.value).toBe("bar");
    cancel(modal);
    await choose("discard");
    await expect.poll(() => modal.isConnected).toBe(false);
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("Disable station clean and reverted disposition closes without another safety confirmation", async () => {
  const { screen, writes } = await mount();
  let modal = await open(screen);
  cancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  modal = await open(screen);
  await change(screen, modal, "bar");
  expect(unload()).toBe(true);
  await change(screen, modal, "");
  expect(unload()).toBe(false);
  cancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});
it("Disable station commits the accepted disposition before a failed refresh", async () => {
  const { screen, writes } = await mount(undefined, true);
  const modal = await open(screen);
  await change(screen, modal, "bar");
  await save(screen, modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(writes).toEqual([
    { deactivate: "kitchen", choice: { openDishes: "send", sendsToStationId: "bar" } },
  ]);
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
});
it("Disable station refused destination retains selection and asks before Cancel", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const modal = await open(screen);
  await change(screen, modal, "bar");
  await save(screen, modal);
  write.reject({ code: "station.destination_invalid" });
  await expect.poll(() => modal.querySelector("[data-field-error=openDishes]")).not.toBeNull();
  expect(unload()).toBe(true);
  cancel(modal);
  await choose("keep");
  expect(modal.querySelector("wt-combobox")!.value).toBe("bar");
  expect(writes).toEqual([
    { deactivate: "kitchen", choice: { openDishes: "send", sendsToStationId: "bar" } },
  ]);
});
it("Disable station refused write keeps its uncommitted disposition protected", async () => {
  const deactivation = deferred();
  const { screen, writes } = await mount(undefined, false, deactivation.promise);
  const modal = await open(screen);
  await change(screen, modal, "bar");
  await save(screen, modal);
  await expect.poll(() => writes.length).toBe(1);
  deactivation.reject({ code: "station.default_cannot_disable" });
  await expect.poll(() => modal.querySelector("[role=alert]")).not.toBeNull();
  expect(modal.querySelector("wt-combobox")!.value).toBe("bar");
  expect(unload()).toBe(true);
  cancel(modal);
  await choose("keep");
  expect(modal.isConnected).toBe(true);
  expect((await question()).open).toBe(false);
  cancel(modal);
  await choose("discard");
  await expect.poll(() => modal.isConnected).toBe(false);
});
it("Disable station pending write refuses dismissal and ignores changes to its disabled selector", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const modal = await open(screen);
  await change(screen, modal, "bar");
  await save(screen, modal);
  expect(await modal.requestClose("cancel")).toBe(false);
  await change(screen, modal, "grill");
  write.resolve();
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(writes).toEqual([
    { deactivate: "kitchen", choice: { openDishes: "send", sendsToStationId: "bar" } },
  ]);
  expect(unload()).toBe(false);
});
it("Disable station disconnect aborts the question and removes unload protection", async () => {
  const { screen } = await mount();
  const modal = await open(screen);
  await change(screen, modal, "bar");
  cancel(modal);
  expect((await question()).open).toBe(true);
  screen.remove();
  await expect.poll(async () => (await question()).open).toBe(false);
  expect(unload()).toBe(false);
});

it("Disable station rerenders while asking without replacing the pending close callback", async () => {
  const { screen } = await mount();
  const modal = await open(screen);
  await change(screen, modal, "bar");
  cancel(modal);
  expect((await question()).open).toBe(true);
  screen.requestUpdate();
  await screen.updateComplete;
  await choose("discard");
  await expect.poll(() => modal.isConnected).toBe(false);
});
for (const refused of [false, true]) {
  it(`Disable station departed ${refused ? "refused" : "accepted"} request cannot disable a replacement opening`, async () => {
    const write = deferred();
    const { screen, writes } = await mount(write.promise);
    const old = await open(screen);
    await change(screen, old, "bar");
    await save(screen, old);
    screen.remove();
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    const next = await open(screen, "grill");
    await change(screen, next, "kitchen");
    old
      .querySelector("wt-combobox")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
    old.querySelector<HTMLElement>("[data-test=disable-confirm]")!.click();
    if (refused) write.reject({ code: "station.destination_invalid" });
    else write.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(next.isConnected).toBe(true);
    expect(next.querySelector("wt-combobox")!.value).toBe("kitchen");
    expect(next.querySelector("[slot=cancel]")!.hasAttribute("disabled")).toBe(false);
    expect(next.querySelector("[role=alert]")).toBeNull();
    expect(writes).toEqual([
      { deactivate: "kitchen", choice: { openDishes: "send", sendsToStationId: "bar" } },
    ]);
    expect(unload()).toBe(true);
  });
}
it("Disable station departed controls cannot reopen a cancelled form", async () => {
  const { screen, writes } = await mount();
  const old = await open(screen);
  cancel(old);
  await expect.poll(() => old.isConnected).toBe(false);
  old
    .querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  old.querySelector<HTMLElement>("[data-test=disable-confirm]")!.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("station-disable-dialog")).toBeNull();
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("Disable station replacement waits for Discard and old controls cannot change the new opening", async () => {
  const { screen, writes } = await mount();
  const old = await open(screen);
  await change(screen, old, "bar");
  await open(screen, "grill");
  expect((await question()).open).toBe(true);
  expect(old.isConnected).toBe(true);
  await choose("keep");
  expect(old.querySelector("wt-combobox")!.value).toBe("bar");
  await open(screen, "grill");
  await choose("discard");
  await expect.poll(() => old.isConnected).toBe(false);
  const next = screen
    .shadowRoot!.querySelector("station-disable-dialog")!
    .shadowRoot!.querySelector("wt-modal")!;
  await change(screen, next, "kitchen");
  old
    .querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  old.querySelector<HTMLElement>("[data-test=disable-confirm]")!.click();
  await screen.updateComplete;
  expect(next.querySelector("wt-combobox")!.value).toBe("kitchen");
  expect(writes).toEqual([]);
  expect(unload()).toBe(true);
});

it("Disable default station is an unchanged safety confirmation without a draft warning", async () => {
  const { screen, writes } = await mount();
  const modal = await open(screen, "bar");
  expect(modal.querySelector("wt-combobox")).toBeNull();
  expect(unload()).toBe(false);
  cancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});
it("Disable station reviewing a no-work confirmation does not create unsaved changes", async () => {
  const { screen, writes } = await mount();
  const modal = await open(screen, "bar");
  expect(modal.querySelector("wt-combobox")).toBeNull();
  expect(unload()).toBe(false);
  cancel(modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});

it("Disable station a background default change cannot retire the opening's unsaved selection", async () => {
  const { screen, model, liveData } = await mount();
  const modal = await open(screen);
  await change(screen, modal, "bar");
  model.stations.find((row) => row.id === "kitchen")!.isDefault = true;
  liveData.invalidate([{ type: "kitchen_stations" }]);
  await expect.poll(() => modal.querySelector("wt-combobox")!.value).toBe("bar");
  expect(unload()).toBe(true);
  cancel(modal);
  await choose("keep");
  expect(modal.isConnected).toBe(true);
  expect(unload()).toBe(true);
});

it("Disable station keeps its choice through a background routing read, then submits it once", async () => {
  const { screen, model, liveData, writes, readCount } = await mount();
  const modal = await open(screen);
  await change(screen, modal, "bar");
  const reads = readCount();
  model.routing.cells = [
    ...model.routing.cells,
    { row: { kind: "all" }, zoneId: null, target: { kind: "station", stationId: "kitchen" } },
  ];
  liveData.invalidate([{ type: "kitchen_stations" }]);
  await expect.poll(readCount).toBeGreaterThan(reads);
  await screen.updateComplete;
  expect(modal.querySelector("wt-combobox")!.value).toBe("bar");
  expect(unload()).toBe(true);
  await save(screen, modal);
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(writes).toEqual([
    { deactivate: "kitchen", choice: { openDishes: "send", sendsToStationId: "bar" } },
  ]);
  expect(unload()).toBe(false);
});

it("Disable names every explicit routing cell that selects the station", async () => {
  const { screen, model, liveData, readCount } = await mount();
  model.routing.zones = [{ id: "terrace", name: "Terrace", departmentId: null }];
  model.routing.cells = [
    { row: { kind: "all" }, zoneId: null, target: { kind: "station", stationId: "kitchen" } },
    {
      row: { kind: "no_category" },
      zoneId: "terrace",
      target: { kind: "station", stationId: "kitchen" },
    },
    {
      row: { kind: "category", categoryId: "cocktails" },
      zoneId: null,
      target: { kind: "station", stationId: "kitchen" },
    },
    {
      row: { kind: "product", productId: "bread" },
      zoneId: "terrace",
      target: { kind: "station", stationId: "kitchen" },
    },
    {
      row: { kind: "category", categoryId: "food" },
      zoneId: null,
      target: { kind: "station", stationId: "bar" },
    },
  ];
  const reads = readCount();
  liveData.invalidate([{ type: "kitchen_stations" }]);
  await expect.poll(readCount).toBeGreaterThan(reads);
  const modal = await open(screen);
  expect([...modal.querySelectorAll("li")].map((row) => row.textContent!.trim())).toEqual([
    "All categories · Every zone",
    "No category · Terrace",
    "Drinks › Cocktails · Every zone",
    "Bread · Terrace",
  ]);
});

it.each(["cancel", "disabled"] as const)(
  "a departed Disable %s event cannot dismiss a newer opening or refresh its model",
  async (eventName) => {
    const { screen, writes, readCount } = await mount();
    const old = await open(screen);
    const oldDialog = (old.getRootNode() as ShadowRoot).host;
    cancel(old);
    await expect.poll(() => old.isConnected).toBe(false);
    const next = await open(screen, "grill");
    await change(screen, next, "kitchen");
    const reads = readCount();
    oldDialog.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { stationId: "kitchen" },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    expect(next.isConnected).toBe(true);
    expect(next.querySelector("wt-combobox")!.value).toBe("kitchen");
    expect(writes).toEqual([]);
    expect(readCount()).toBe(reads);
    expect(unload()).toBe(true);
  },
);

it.each(
  ([390, 1280] as const).flatMap((width) =>
    (["en", "es"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => ({ width, locale, theme })),
    ),
  ),
)(
  "connected Disable is readable in $locale $theme at $width CSS pixels",
  async ({ width, locale, theme }) => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 720);
      const { screen, model, liveData, readCount } = await mount();
      app.setAttribute("data-theme", theme);
      app.style.display = "block";
      app.style.background = "var(--wt-color-bg)";
      app.style.width = `${width}px`;
      model.routing.cells = [
        {
          row: { kind: "category", categoryId: "cocktails" },
          zoneId: null,
          target: { kind: "station", stationId: "kitchen" },
        },
      ];
      const reads = readCount();
      liveData.invalidate([{ type: "kitchen_stations" }]);
      await expect.poll(readCount).toBeGreaterThan(reads);
      setLocale(locale);
      screen.requestUpdate();
      await screen.updateComplete;
      const modal = await open(screen);
      const combo = modal.querySelector("wt-combobox")!;
      await combo.updateComplete;
      expect(combo.shadowRoot!.querySelector("button")!.name).toBe("openDishes");
      expect(combo.shadowRoot!.querySelector("[data-required]")!.textContent).toBe("*");
      expect(modal.querySelector("li")!.textContent).toContain("Drinks › Cocktails");
      expect(modal.querySelector("[data-test=disable-confirm]")!.textContent!.trim()).toBe(
        locale === "en" ? "Disable" : "Deshabilitar",
      );
      expect(window.innerWidth).toBe(width);
      const native = modal.shadowRoot!.querySelector("dialog")!;
      const rect = native.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
      expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth);
      await expectNoA11yViolations(app);
      await page.screenshot({
        path: `__screenshots__/look/connected-disable-${locale}-${theme}-${width}.png`,
      });
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
