import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, setContentLanguages } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const model: VenueServiceView = {
  readiness: [{ code: "venue.default_station_missing" }],
  departments: [
    {
      id: "d1",
      name: "Restaurant and bar",
      tradingName: "Casa Delgado",
      defaultServiceMode: "table_tab",
      active: true,
    },
    {
      id: "d2",
      name: "Deli",
      tradingName: "Casa Delgado Deli",
      defaultServiceMode: "prepay",
      active: true,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Dining room",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
    },
  ],
  salePolicies: { departments: [], zones: [] },
  zoneMenus: [{ zoneId: "z1", menuId: "m1", displayOrder: 0, isDefault: true }],
  menus: [
    { id: "m1", name: "Casa Delgado", active: true },
    { id: "m2", name: "Deli takeaway", active: true },
  ],
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Deli counter" },
  ],
  devices: [],
  deviceZones: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
};

class VenueLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: VenueServiceApi;
  override render() {
    return html`<dashboard-venue-operations-screen
        .api=${this.api}
      ></dashboard-venue-operations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("venue-leave-test-app", VenueLeaveApp);
let app: VenueLeaveApp;
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
  let currentModel = structuredClone(model);
  const liveData = new LiveData();
  const record = async (...values: unknown[]) => {
    writes.push(values);
    await write;
  };
  app = document.createElement("venue-leave-test-app") as VenueLeaveApp;
  app.api = {
    liveData,
    load: async () => {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(currentModel);
    },
    createDepartment: record,
    updateDepartment: record,
    createZone: record,
    configureZone: record,
    replaceHours: record,
    allowMenu: record,
  } as unknown as VenueServiceApi;
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<VenueOperationsScreen>(
    "dashboard-venue-operations-screen",
  )!;
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[data-test=new-department]"))
    .not.toBeNull();
  return {
    screen,
    writes,
    refresh: async (next: VenueServiceView) => {
      const previous = reads;
      currentModel = next;
      liveData.invalidate([
        { type: "departments", id: "d1" },
        { type: "zone_service", id: "z1" },
      ]);
      await expect.poll(() => reads).toBeGreaterThan(previous);
      await screen.updateComplete;
    },
  };
}
function find(root: ParentNode, selector: string): HTMLElement | undefined {
  const own = root.querySelector<HTMLElement>(selector);
  if (own) return own;
  for (const child of root.querySelectorAll("*")) {
    if (child.shadowRoot) {
      const found = find(child.shadowRoot, selector);
      if (found) return found;
    }
  }
}
async function action(screen: VenueOperationsScreen, key: string) {
  const button = find(screen.shadowRoot!, `[data-test="${key}"]`)!;
  expect(button).toBeDefined();
  const menu = button.closest("wt-row-actions");
  menu?.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await screen.updateComplete;
}
async function field(screen: VenueOperationsScreen, name: string, value: string) {
  const host = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  expect(host).not.toBeNull();
  host.value = value;
  host.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  return question;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
const cases = [
  {
    label: "Add department",
    action: "new-department",
    field: "department-name",
    initial: "",
    edited: "Terrace",
    setup: [["trading-name", "Casa Terrace"]],
    want: [{ name: "Terrace", tradingName: "Casa Terrace", defaultServiceMode: "prepay" }],
  },
  {
    label: "Edit department",
    action: "edit-department-d1",
    field: "trading-name",
    initial: "Casa Delgado",
    edited: "Casa Terrace",
    setup: [],
    want: [
      "d1",
      { name: "Restaurant and bar", tradingName: "Casa Terrace", defaultServiceMode: "table_tab" },
    ],
  },
  {
    label: "Add zone",
    action: "new-zone",
    field: "new-zone-name",
    initial: "",
    edited: "Terrace",
    setup: [],
    want: [{ name: "Terrace", departmentId: "d1" }],
  },
  {
    label: "Configure zone",
    action: "edit-zone-z1",
    field: "zone-mode-z1",
    initial: "prepay",
    edited: "",
    setup: [],
    want: ["z1", { departmentId: "d1", serviceMode: null }],
  },
  {
    label: "Menu assignment",
    action: "new-assignment-z1",
    field: "assignment-order",
    initial: "1",
    edited: "02",
    setup: [],
    want: ["z1", "m2", { displayOrder: 2, makeDefault: false }],
  },
] as const;
async function open(screen: VenueOperationsScreen, key: string) {
  if (key.includes("zone") || key.includes("assignment")) {
    const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
    await tabs.updateComplete;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="zones"]')!.click();
    await screen.updateComplete;
  }
  if (key.includes("assignment")) await action(screen, "menus-tree-zone-z1");
  await action(screen, key);
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  expect(modal).not.toBeNull();
  await modal.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return modal;
}
for (const item of cases) {
  it(`${item.label} keeps edited values through native Escape and Cancel then discards without writing`, async () => {
    const { screen, writes } = await mount();
    const modal = await open(screen, item.action);
    await field(screen, item.field, item.edited);
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("keep");
    expect(
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${item.field}"]`)!
        .value,
    ).toBe(item.edited);
    modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
    await choose("discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
  it(`${item.label} clean and reverted submitted values close directly`, async () => {
    const { screen } = await mount();
    let modal = await open(screen, item.action);
    modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    modal = await open(screen, item.action);
    await field(screen, item.field, item.edited);
    await field(screen, item.field, item.initial);
    expect(unload()).toBe(false);
    modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect((await question()).open).toBe(false);
  });
  it(`${item.label} commits its exact submitted body before a failed refresh`, async () => {
    const { screen, writes } = await mount(undefined, true);
    const modal = await open(screen, item.action);
    for (const [name, value] of item.setup) await field(screen, name, value);
    await field(screen, item.field, item.edited);
    modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([item.want]);
    expect(unload()).toBe(false);
    expect((await question()).open).toBe(false);
  });
  it(`${item.label} retains a refused write as dirty`, async () => {
    const write = deferred();
    const { screen, writes } = await mount(write.promise);
    const modal = await open(screen, item.action);
    for (const [name, value] of item.setup) await field(screen, name, value);
    await field(screen, item.field, item.edited);
    modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
    await expect.poll(() => writes.length).toBe(1);
    write.reject({ code: "connection.failed" });
    await expect
      .poll(
        () =>
          modal.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="cancel-editor"]')!
            .disabled,
      )
      .toBe(false);
    modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
    await choose("keep");
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(unload()).toBe(true);
    expect(writes).toEqual([item.want]);
  });
}

it("a saved department keeps newer input dirty against the submitted snapshot", async () => {
  const write = deferred();
  const { screen, writes } = await mount(write.promise);
  const modal = await open(screen, "edit-department-d1");
  await field(screen, "trading-name", "Submitted name");
  modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
  await expect.poll(() => writes.length).toBe(1);
  await field(screen, "trading-name", "Newer name");
  write.resolve();
  await expect
    .poll(
      () =>
        modal.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="cancel-editor"]')!
          .disabled,
    )
    .toBe(false);
  expect(modal.isConnected).toBe(true);
  expect(unload()).toBe(true);
  modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  await choose("keep");
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="trading-name"]')!
      .value,
  ).toBe("Newer name");
  await field(screen, "trading-name", " Submitted name ");
  expect(unload()).toBe(false);
  expect(writes).toEqual([
    [
      "d1",
      {
        name: "Restaurant and bar",
        tradingName: "Submitted name",
        defaultServiceMode: "table_tab",
      },
    ],
  ]);
});
it("a live refresh preserves a zone's chosen draft and initial comparison", async () => {
  const { screen, refresh } = await mount();
  const modal = await open(screen, "edit-zone-z1");
  await field(screen, "zone-mode-z1", "ticket_then_pay");
  const updated = structuredClone(model);
  updated.zones[0]!.serviceModeOverride = "table_tab";
  await refresh(updated);
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="zone-mode-z1"]')!
      .value,
  ).toBe("ticket_then_pay");
  modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  await choose("keep");
  await field(screen, "zone-mode-z1", "prepay");
  expect(unload()).toBe(false);
});
it("a pending discard cannot close a replacement editor", async () => {
  const { screen, writes } = await mount();
  const modal = await open(screen, "edit-department-d1");
  await field(screen, "trading-name", "Draft");
  modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  expect((await question()).open).toBe(true);
  const departedSave = modal.querySelector<HTMLElement>('[data-test="save-editor"]')!;
  await action(screen, "edit-department-d2");
  const replacement = screen.shadowRoot!.querySelector("wt-modal")!;
  await replacement.updateComplete;
  expect((await question()).open).toBe(false);
  const oldChoice = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  oldChoice.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  departedSave.click();
  departedSave.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  expect(replacement.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="trading-name"]')!
      .value,
  ).toBe("Casa Delgado Deli");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
it("a disconnect aborts a pending question and removes unload protection", async () => {
  const { screen } = await mount();
  const modal = await open(screen, "new-zone");
  await field(screen, "new-zone-name", "Terrace");
  modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  expect((await question()).open).toBe(true);
  screen.remove();
  expect((await question()).open).toBe(false);
  expect(unload()).toBe(false);
});
it("equivalent assignment numbers revert, but invalid raw input remains dirty", async () => {
  const { screen } = await mount();
  await open(screen, "new-assignment-z1");
  await field(screen, "assignment-order", "01");
  expect(unload()).toBe(false);
  await field(screen, "assignment-order", "invalid");
  expect(unload()).toBe(true);
  await field(screen, "assignment-order", "1");
  expect(unload()).toBe(false);
});

it("assignment checkbox changes participate in Cancel and commit the existing request", async () => {
  const { screen, writes } = await mount();
  const modal = await open(screen, "new-assignment-z1");
  const checkbox = modal.querySelector<HTMLInputElement>('[name="assignment-default"]')!;
  checkbox.click();
  expect(unload()).toBe(true);
  modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  await choose("keep");
  expect(checkbox.checked).toBe(true);
  checkbox.click();
  expect(unload()).toBe(false);
  checkbox.click();
  modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(writes).toEqual([["z1", "m2", { displayOrder: 1, makeDefault: true }]]);
  expect(unload()).toBe(false);
});
it("a save aborts a pending discard without undoing its accepted body", async () => {
  const { screen, writes } = await mount();
  const modal = await open(screen, "edit-department-d1");
  await field(screen, "trading-name", "Saved name");
  modal.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
  expect((await question()).open).toBe(true);
  const q = await question();
  modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(q.open).toBe(false);
  q.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(writes).toEqual([
    [
      "d1",
      { name: "Restaurant and bar", tradingName: "Saved name", defaultServiceMode: "table_tab" },
    ],
  ]);
  expect(unload()).toBe(false);
});
it("a departed refusal leaves the replacement editor clean and unmarked", async () => {
  const write = deferred();
  const { screen } = await mount(write.promise);
  const modal = await open(screen, "edit-department-d1");
  await field(screen, "trading-name", "Refused name");
  modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
  await action(screen, "new-zone");
  const replacement = screen.shadowRoot!.querySelector("wt-modal")!;
  await replacement.updateComplete;
  write.reject({ code: "management.request_invalid", params: { field: "name" } });
  await expect
    .poll(
      () =>
        replacement.querySelector<HTMLElementTagNameMap["wt-button"]>(
          '[data-test="cancel-editor"]',
        )!.disabled,
    )
    .toBe(false);
  expect(
    replacement.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="new-zone-name"]')!.error,
  ).toBe("");
  expect(replacement.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(unload()).toBe(false);
});

it("a reconnected venue form protects its retained draft against the original baseline", async () => {
  const { screen } = await mount();
  await open(screen, "edit-department-d1");
  await field(screen, "trading-name", "Retained draft");
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="trading-name"]')!
      .value,
  ).toBe("Retained draft");
  expect(unload()).toBe(true);
  await field(screen, "trading-name", "Casa Delgado");
  expect(unload()).toBe(false);
});
