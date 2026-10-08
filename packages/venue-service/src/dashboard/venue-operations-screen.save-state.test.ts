import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, setContentLanguages } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const model: VenueServiceView = {
  readiness: [],
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
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Deli counter" },
  ],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
};

class VenueSaveStateApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: VenueServiceApi;
  override render() {
    return html`<dashboard-venue-operations-screen
        .api=${this.api}
      ></dashboard-venue-operations-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("venue-save-state-test-app", VenueSaveStateApp);

let mounted: HTMLElement | undefined;
afterEach(() => {
  mounted?.remove();
  mounted = undefined;
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** `leave: false` mounts the screen with no application above it, as a widget test does. */
async function mount(options: { write?: Promise<void>; leave?: boolean; refuse?: unknown } = {}) {
  const writes: unknown[] = [];
  const record = async (...values: unknown[]) => {
    writes.push(values);
    await options.write;
    if (options.refuse) throw options.refuse;
  };
  const api = {
    liveData: new LiveData(),
    load: async () => structuredClone(model),
    createDepartment: record,
    updateDepartment: record,
    createZone: record,
    updateZone: record,
    configureZone: record,
    loadDepartmentTransfers: async () => ({
      departmentId: "d1",
      receivingProfileId: null,
      destinationDepartmentIds: [],
      profiles: [{ id: "p1", name: "Restaurant desk" }],
    }),
    saveDepartmentTransfers: record,
    departmentRemovalImpact: async () => ({ zones: [] }),
    deactivateDepartment: async (...values: unknown[]) => {
      writes.push(["deactivate", ...values]);
    },
  } as unknown as VenueServiceApi;
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  let screen: VenueOperationsScreen;
  if (options.leave === false) {
    screen = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    screen.api = api;
    applyTokens(screen);
    document.body.append(screen);
    mounted = screen;
  } else {
    const app = document.createElement("venue-save-state-test-app") as VenueSaveStateApp;
    app.api = api;
    applyTokens(app);
    document.body.append(app);
    mounted = app;
    await app.updateComplete;
    screen = app.shadowRoot!.querySelector<VenueOperationsScreen>(
      "dashboard-venue-operations-screen",
    )!;
  }
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[data-test=new-department]"))
    .not.toBeNull();
  return { screen, writes };
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
async function open(screen: VenueOperationsScreen, key: string) {
  if (key.includes("zone")) {
    const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
    await tabs.updateComplete;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="zones"]')!.click();
    await screen.updateComplete;
  }
  const button = find(screen.shadowRoot!, `[data-test="${key}"]`)!;
  expect(button, key).toBeDefined();
  button.closest("wt-row-actions")?.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return modal;
}
async function field(screen: VenueOperationsScreen, name: string, value: string) {
  const host = screen.shadowRoot!.querySelector<HTMLElement & { value: string }>(
    `[name="${name}"]`,
  )!;
  expect(host, name).not.toBeNull();
  host.value = value;
  host.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
const saveButton = (screen: VenueOperationsScreen) =>
  screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="save-editor"]',
  )!;

/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(screen: VenueOperationsScreen) {
  await screen.updateComplete;
  const save = saveButton(screen);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const marked = (screen: VenueOperationsScreen) =>
  [...screen.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-modal [name]")]
    .filter((control) => control.error)
    .map((control) => control.getAttribute("name"));

const cases = [
  {
    label: "Transfers",
    action: "transfers-tree-department-d1",
    field: "receiving-profile",
    initial: "",
    edited: "p1",
    newer: "",
    setup: [],
  },
  {
    label: "Add department",
    action: "new-department",
    field: "department-name",
    initial: "",
    edited: "Terrace",
    newer: "Patio",
    setup: [["trading-name", "Casa Terrace"]],
  },
  {
    label: "Edit department",
    action: "edit-department-d1",
    field: "trading-name",
    initial: "Casa Delgado",
    edited: "Casa Terrace",
    newer: "Casa Patio",
    setup: [],
  },
  {
    label: "Add zone",
    action: "new-zone",
    field: "new-zone-name",
    initial: "",
    edited: "Terrace",
    newer: "Patio",
    setup: [],
  },
  {
    label: "Configure zone",
    action: "edit-zone-z1",
    field: "zone-mode-z1",
    initial: "prepay",
    edited: "",
    newer: "table_tab",
    setup: [],
  },
] as const;

describe.each(cases)("$label", (item) => {
  it("opens with Save quiet and disabled", async () => {
    const { screen } = await mount();
    await open(screen, item.action);
    expect(await saveState(screen)).toEqual(quiet);
  });

  it("one edit makes Save primary and enabled; typing the opened value back makes it quiet", async () => {
    const { screen } = await mount();
    await open(screen, item.action);
    await field(screen, item.field, item.edited);
    expect(await saveState(screen)).toEqual(ready);
    await field(screen, item.field, item.initial);
    expect(await saveState(screen)).toEqual(quiet);
  });

  // A host `.click()` reaches Save's listener even while its inner button is disabled, so this
  // presses the host: what it proves is that the handler itself sends nothing for an untouched form.
  it("a press that reaches Save's handler on the untouched window sends nothing and marks nothing", async () => {
    const { screen, writes } = await mount();
    const modal = await open(screen, item.action);
    saveButton(screen).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(writes).toEqual([]);
    expect(marked(screen)).toEqual([]);
    expect(modal.isConnected).toBe(true);
  });

  it("a committed save with newer input kept open draws Save as the newer input says", async () => {
    const write = deferred();
    const { screen, writes } = await mount({ write: write.promise });
    const modal = await open(screen, item.action);
    for (const [name, value] of item.setup) await field(screen, name, value);
    await field(screen, item.field, item.edited);
    saveButton(screen).click();
    await expect.poll(() => writes.length).toBe(1);
    await field(screen, item.field, item.newer);
    write.resolve();
    await expect.poll(() => saveButton(screen).variant).toBe("primary");
    await expect.poll(async () => (await saveState(screen)).disabled).toBe(false);
    expect(modal.isConnected).toBe(true);
    expect(await saveState(screen)).toEqual(ready);
    await field(screen, item.field, item.edited);
    expect(await saveState(screen)).toEqual(quiet);
  });
});

describe("with no application above the screen", () => {
  it("an edit still turns Save blue, and Cancel and Escape still close the window", async () => {
    const { screen, writes } = await mount({ leave: false });
    await open(screen, "edit-department-d1");
    expect(await saveState(screen)).toEqual(quiet);
    await field(screen, "trading-name", "Casa Terrace");
    expect(await saveState(screen)).toEqual(ready);
    screen.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-editor"]')!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    await open(screen, "edit-department-d1");
    await field(screen, "trading-name", "Casa Terrace");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("Edit department refused", () => {
  it("a refused save leaves Save enabled and primary", async () => {
    const { screen, writes } = await mount({
      refuse: { code: "department.name_taken", params: {} },
    });
    const modal = await open(screen, "edit-department-d1");
    await field(screen, "department-name", "Deli");
    saveButton(screen).click();
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => marked(screen)).toEqual(["department-name"]);
    expect(modal.isConnected).toBe(true);
    expect(await saveState(screen)).toEqual(ready);
  });
});

describe("the Disable confirmation", () => {
  it("is drawn danger, is enabled on open, and still disables", async () => {
    const { screen, writes } = await mount();
    await open(screen, "remove-tree-department-d1");
    expect(await saveState(screen)).toEqual({
      variant: "danger",
      disabled: false,
      innerDisabled: false,
    });
    saveButton(screen).click();
    await expect.poll(() => writes).toEqual([["deactivate", "d1"]]);
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  });
});

const nameCells = [
  {
    label: "department name",
    action: "department-name",
    name: "departmentName",
    initial: "Restaurant and bar",
    edited: "Terrace",
  },
  {
    label: "zone name",
    action: "zone-name",
    name: "zoneName",
    initial: "Dining room",
    edited: "Terrace",
  },
  {
    label: "trading name",
    action: "trading-name",
    name: "tradingName",
    initial: "Casa Delgado",
    edited: "Casa Terrace",
  },
] as const;
type NameCell = (typeof nameCells)[number];

async function settleCell(screen: VenueOperationsScreen) {
  await screen.updateComplete;
  const table = screen.shadowRoot!.querySelector<LitElement>("[data-test=policy-tree]")!;
  await table.updateComplete;
}
async function openCell(screen: VenueOperationsScreen, item: NameCell) {
  find(screen.shadowRoot!, `[data-test="edit-${item.action}"]`)!.click();
  await settleCell(screen);
  expect(find(screen.shadowRoot!, `[name="${item.name}"]`), item.name).toBeDefined();
}
async function editCell(screen: VenueOperationsScreen, item: NameCell, value: string) {
  const host = find(screen.shadowRoot!, `[name="${item.name}"]`)!;
  host.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settleCell(screen);
}
const cellButton = (screen: VenueOperationsScreen, test: string) =>
  find(screen.shadowRoot!, `[data-test="${test}"]`) as
    HTMLElementTagNameMap["wt-button"] | undefined;
async function cellSaveState(screen: VenueOperationsScreen, item: NameCell) {
  await settleCell(screen);
  const save = cellButton(screen, `save-${item.action}`)!;
  expect(save.localName).toBe("wt-button");
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}

describe.each(nameCells)("the inline $label editor", (item) => {
  it("opens with Save quiet and disabled, and Cancel secondary", async () => {
    const { screen } = await mount();
    await openCell(screen, item);
    expect(await cellSaveState(screen, item)).toEqual(quiet);
    const cancel = cellButton(screen, `cancel-${item.action}`)!;
    expect(cancel.localName).toBe("wt-button");
    expect(cancel.variant).toBe("secondary");
  });

  it("one edit makes Save primary and enabled; the opened value typed back with spaces makes it quiet", async () => {
    const { screen } = await mount();
    await openCell(screen, item);
    await editCell(screen, item, item.edited);
    expect(await cellSaveState(screen, item)).toEqual(ready);
    await editCell(screen, item, ` ${item.initial} `);
    expect(await cellSaveState(screen, item)).toEqual(quiet);
  });

  it("a press that reaches Save's handler on the untouched name sends nothing and marks nothing", async () => {
    const { screen, writes } = await mount();
    await openCell(screen, item);
    cellButton(screen, `save-${item.action}`)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settleCell(screen);
    expect(writes).toEqual([]);
    const input = find(screen.shadowRoot!, `[name="${item.name}"]`) as
      (HTMLElement & { error: string }) | undefined;
    expect(input).toBeDefined();
    expect(input!.error).toBe("");
  });

  it("a refused save leaves Save enabled and primary", async () => {
    const { screen, writes } = await mount({
      refuse: {
        code: item.name === "zoneName" ? "zone.name_taken" : "department.name_taken",
        params: {},
      },
    });
    await openCell(screen, item);
    await editCell(screen, item, item.edited);
    cellButton(screen, `save-${item.action}`)!.click();
    await expect.poll(() => writes.length).toBe(1);
    await settleCell(screen);
    const input = find(screen.shadowRoot!, `[name="${item.name}"]`) as
      (HTMLElement & { error: string }) | undefined;
    expect(input).toBeDefined();
    await expect.poll(() => input!.error).not.toBe("");
    expect(await cellSaveState(screen, item)).toEqual(ready);
  });

  it("with no application above the screen, an edit turns Save blue and Cancel and Escape close it", async () => {
    const { screen, writes } = await mount({ leave: false });
    await openCell(screen, item);
    expect(await cellSaveState(screen, item)).toEqual(quiet);
    await editCell(screen, item, item.edited);
    expect(await cellSaveState(screen, item)).toEqual(ready);
    cellButton(screen, `cancel-${item.action}`)!.click();
    await settleCell(screen);
    expect(find(screen.shadowRoot!, `[name="${item.name}"]`)).toBeUndefined();
    await openCell(screen, item);
    await editCell(screen, item, item.edited);
    find(screen.shadowRoot!, `[name="${item.name}"]`)!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await settleCell(screen);
    expect(find(screen.shadowRoot!, `[name="${item.name}"]`)).toBeUndefined();
    expect(writes).toEqual([]);
  });
});
