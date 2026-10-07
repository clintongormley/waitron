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
    exceptions: [
      {
        id: "bread-rule",
        position: 1,
        zoneId: null,
        categoryId: null,
        productId: "bread",
        target: { kind: "no_preparation" },
        neverMatches: false,
        stationOff: false,
      },
    ],
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
  zones: [{ id: "terrace", name: "Terrace" }],
  products: [{ id: "bread", name: "Bread" }],
  testProducts: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
  disabledWatchers: [],
};

class ExceptionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: PrepStationsApi;
  override render() {
    return html`<dashboard-prep-stations-screen .api=${this.api}></dashboard-prep-stations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("exception-leave-test-app", ExceptionLeaveApp);
let app: ExceptionLeaveApp;
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
async function mount(write?: Promise<void>, refreshFails = false, preview?: Promise<[]>) {
  const writes: unknown[] = [];
  let reads = 0;
  app = document.createElement("exception-leave-test-app") as ExceptionLeaveApp;
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
    preview: async () => await (preview ?? Promise.resolve([])),
    createException: async (body: unknown) => {
      writes.push({ body });
      await write;
    },
    updateException: async (id: string, body: unknown) => {
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

async function open(screen: PrepStationsScreen, edit = false) {
  screen
    .shadowRoot!.querySelector("wt-tabs")!
    .dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "routing" } }));
  await screen.updateComplete;
  screen
    .shadowRoot!.querySelector<HTMLElement>(
      `[data-test=${edit ? "edit-exception-bread-rule" : "add-exception"}]`,
    )!
    .click();
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return modal;
}
async function field(modal: HTMLElementTagNameMap["wt-modal"], name: string, value: string) {
  modal
    .querySelector(`[data-test=exception-${name}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
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
function cancel(modal: HTMLElementTagNameMap["wt-modal"]) {
  modal.querySelector<HTMLElement>("[slot=cancel]")!.click();
}
function save(modal: HTMLElementTagNameMap["wt-modal"]) {
  modal.querySelector<HTMLElement>("[data-test=save-exception]")!.click();
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
for (const edit of [false, true]) {
  it(`${edit ? "Edit" : "Add"} exception keeps all fields through Escape and Cancel, discards without writing`, async () => {
    const { screen, writes } = await mount();
    const modal = await open(screen, edit);
    await field(modal, "what", "category:cocktails");
    await field(modal, "zone", "terrace");
    await field(modal, "target", "bar");
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("keep");
    expect(
      modal.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-what]")!
        .value,
    ).toBe("category:cocktails");
    expect(
      modal.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-zone]")!
        .value,
    ).toBe("terrace");
    expect(
      modal.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-target]")!
        .value,
    ).toBe("bar");
    cancel(modal);
    await choose("discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
  it(`${edit ? "Edit" : "Add"} exception clean and reverted fields close directly`, async () => {
    const { screen } = await mount();
    let modal = await open(screen, edit);
    cancel(modal);
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    modal = await open(screen, edit);
    await field(modal, "zone", "terrace");
    await field(modal, "zone", "");
    await field(modal, "what", "category:cocktails");
    await field(modal, "what", edit ? "product:bread" : "");
    await field(modal, "target", "bar");
    await field(modal, "target", edit ? "no_preparation" : "");
    expect(unload()).toBe(false);
    cancel(modal);
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect((await question()).open).toBe(false);
  });
}
for (const [name, value] of [
  ["what", ""],
  ["zone", "terrace"],
  ["target", ""],
] as const) {
  it(`Edit exception protects ${name}, including invalid blank input`, async () => {
    const { screen } = await mount();
    const modal = await open(screen, true);
    await field(modal, name, value);
    expect(unload()).toBe(true);
    cancel(modal);
    await choose("keep");
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  });
}
it("cancelling preview returns the still-dirty exception without another question", async () => {
  const { screen, writes } = await mount();
  const modal = await open(screen, true);
  await field(modal, "zone", "terrace");
  save(modal);
  const confirmation = await preview(screen);
  expect(unload()).toBe(true);
  confirmation.querySelector<HTMLElement>("[data-test=cancel-routing]")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=exception-zone]"))
    .not.toBeNull();
  const reopened = screen.shadowRoot!.querySelector("wt-modal")!;
  expect(
    reopened.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-zone]")!
      .value,
  ).toBe("terrace");
  expect((await question()).open).toBe(false);
  cancel(reopened);
  await choose("keep");
  expect(writes).toEqual([]);
});
for (const edit of [false, true]) {
  it(`${edit ? "Edit" : "Add"} exception commits its exact confirmed body before a failed refresh`, async () => {
    const { screen, writes } = await mount(undefined, true);
    const modal = await open(screen, edit);
    await field(modal, "what", "product:bread");
    await field(modal, "target", "bar");
    save(modal);
    const confirmation = await preview(screen);
    confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([
      {
        ...(edit ? { id: "bread-rule" } : {}),
        body: {
          zoneId: null,
          categoryId: null,
          productId: "bread",
          target: { kind: "station", stationId: "bar" },
        },
      },
    ]);
    expect(unload()).toBe(false);
    expect((await question()).open).toBe(false);
    expect(screen.shadowRoot!.textContent).toContain("Prep stations could not be loaded.");
  });
}
it("a refused confirmed write retains the exception and warning", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const modal = await open(screen, true);
  await field(modal, "target", "bar");
  save(modal);
  const confirmation = await preview(screen);
  confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  write.reject({ code: "route.station_inactive" });
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=exception-target]"))
    .not.toBeNull();
  const reopened = screen.shadowRoot!.querySelector("wt-modal")!;
  expect(
    reopened.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-target]")!
      .value,
  ).toBe("bar");
  expect(screen.shadowRoot!.textContent).toContain("station is disabled");
  expect(unload()).toBe(true);
  cancel(reopened);
  await choose("keep");
});
it("preview reads block exception dismissal until they finish", async () => {
  let resolve!: (value: []) => void;
  const pending = new Promise<[]>((yes) => {
    resolve = yes;
  });
  const { screen } = await mount(undefined, false, pending);
  const modal = await open(screen, true);
  await field(modal, "target", "bar");
  save(modal);
  await screen.updateComplete;
  cancel(modal);
  await userEvent.keyboard("{Escape}");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect((await question()).open).toBe(false);
  resolve([]);
  await preview(screen);
});
it("disconnect disposes an exception's question and ignores its departed fields", async () => {
  const { screen } = await mount();
  const modal = await open(screen, true);
  await field(modal, "zone", "terrace");
  cancel(modal);
  expect((await question()).open).toBe(true);
  screen.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
  modal
    .querySelector("[data-test=exception-zone]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "terrace" } }));
  expect(unload()).toBe(false);
});

it("a preview from a disconnected opening cannot replace the reopened exception", async () => {
  let resolve!: (value: []) => void;
  const pending = new Promise<[]>((yes) => {
    resolve = yes;
  });
  const { screen } = await mount(undefined, false, pending);
  const modal = await open(screen, true);
  await field(modal, "target", "bar");
  save(modal);
  await screen.updateComplete;
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  const next = await open(screen, true);
  await field(next, "zone", "terrace");
  resolve([]);
  await new Promise<void>((done) => requestAnimationFrame(() => done()));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
  expect(next.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(
    next.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-zone]")!.value,
  ).toBe("terrace");
  expect(unload()).toBe(true);
  cancel(next);
  await choose("keep");
});
it("fields retained from an old exception cannot edit the replacement", async () => {
  const { screen } = await mount();
  const modal = await open(screen, true);
  cancel(modal);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  const next = await open(screen, true);
  modal
    .querySelector("[data-test=exception-target]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  await screen.updateComplete;
  expect(
    next.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-target]")!.value,
  ).toBe("no_preparation");
  expect(unload()).toBe(false);
  cancel(next);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

for (const refused of [false, true]) {
  it(`a departed confirmed ${refused ? "refusal" : "save"} leaves replacement exception intact`, async () => {
    const write = deferred();
    const { screen, writes } = await mount(write.promise);
    let modal = await open(screen, true);
    await field(modal, "target", "bar");
    save(modal);
    const confirmation = await preview(screen);
    confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
    await expect.poll(() => writes.length).toBe(1);
    screen.remove();
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
    modal = await open(screen, true);
    await field(modal, "zone", "terrace");
    if (refused) write.reject({ code: "route.station_inactive" });
    else write.resolve();
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(
      modal.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-zone]")!
        .value,
    ).toBe("terrace");
    expect(screen.shadowRoot!.textContent).not.toContain("This station is disabled");
    expect(unload()).toBe(true);
    cancel(modal);
    await choose("keep");
  });
}

it("the editor removed for preview cannot close the draft restored by preview Cancel", async () => {
  const { screen } = await mount();
  const old = await open(screen, true);
  await field(old, "zone", "terrace");
  save(old);
  const confirmation = await preview(screen);
  confirmation.querySelector<HTMLElement>("[data-test=cancel-routing]")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=exception-zone]"))
    .not.toBeNull();
  const restored = screen.shadowRoot!.querySelector("wt-modal")!;
  old.dispatchEvent(new CustomEvent("wt-close"));
  await screen.updateComplete;
  expect(restored.isConnected).toBe(true);
  expect(
    restored.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-zone]")!
      .value,
  ).toBe("terrace");
  expect(unload()).toBe(true);
  cancel(restored);
  await choose("keep");
});
it("input delivered while preview loads remains dirty after its older body is confirmed", async () => {
  let resolve!: (value: []) => void;
  const pending = new Promise<[]>((yes) => {
    resolve = yes;
  });
  const { screen, writes } = await mount(undefined, false, pending);
  const modal = await open(screen, true);
  await field(modal, "target", "bar");
  save(modal);
  await screen.updateComplete;
  await field(modal, "zone", "terrace");
  resolve([]);
  const confirmation = await preview(screen);
  confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=exception-zone]"))
    .not.toBeNull();
  const restored = screen.shadowRoot!.querySelector("wt-modal")!;
  expect(writes).toEqual([
    {
      id: "bread-rule",
      body: {
        zoneId: null,
        categoryId: null,
        productId: "bread",
        target: { kind: "station", stationId: "bar" },
      },
    },
  ]);
  expect(
    restored.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-zone]")!
      .value,
  ).toBe("terrace");
  expect(unload()).toBe(true);
  cancel(restored);
  await choose("keep");
});

it("a refused preview retains the exception's fields and dirty scope", async () => {
  let reject!: (reason: unknown) => void;
  const pending = new Promise<[]>((_yes, no) => {
    reject = no;
  });
  const { screen, writes } = await mount(undefined, false, pending);
  const modal = await open(screen, true);
  await field(modal, "target", "bar");
  save(modal);
  await screen.updateComplete;
  reject({ code: "route.station_inactive" });
  await expect.poll(() => screen.shadowRoot!.textContent).toContain("This station is disabled");
  expect(screen.shadowRoot!.querySelector("[data-test=routing-preview]")).toBeNull();
  expect(
    modal.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=exception-target]")!
      .value,
  ).toBe("bar");
  expect(unload()).toBe(true);
  cancel(modal);
  await choose("keep");
  expect(writes).toEqual([]);
});
it("a confirmed exception write stays nondismissible without a discard question", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const modal = await open(screen, true);
  await field(modal, "target", "bar");
  save(modal);
  const confirmation = await preview(screen);
  confirmation.querySelector<HTMLElement>("[data-test=confirm-routing]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  await screen.updateComplete;
  await confirmation.updateComplete;
  confirmation.querySelector<HTMLElement>("[data-test=cancel-routing]")!.click();
  await userEvent.keyboard("{Escape}");
  expect(confirmation.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect((await question()).open).toBe(false);
  expect(unload()).toBe(true);
  write.resolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
