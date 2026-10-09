import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import "./department-settings.js";
import "./department-page.js";
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      defaultServiceMode: "table_tab",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", defaultServiceMode: "prepay", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      defaultServiceMode: "prepay",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Terrace",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z3",
      name: "Same",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z4",
      name: "Other",
      departmentId: "d2",
      departmentName: "Deli",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
  ],
  floorZones: [],
  readiness: [],
  salePolicies: {
    departments: [
      {
        departmentId: "d1",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    ],
    zones: [
      {
        zoneId: "z1",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
        effective: {
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
      {
        zoneId: "z2",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: "on_request",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "on_request",
          printTradingName: false,
        },
      },
      {
        zoneId: "z3",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
    ],
  },
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};

class App extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<department-settings></department-settings
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a8-settings-leave-app", App);
let app: App;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(request?: DashboardRequest) {
  app = document.createElement("a8-settings-leave-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-settings")!;
  el.model = structuredClone(model);
  el.departmentId = "d1";
  el.api = new VenueServiceApi(
    request ??
      ((async (path) =>
        path.endsWith("/profiles")
          ? []
          : {
              departmentId: "d1",
              receivingProfileId: null,
              destinationDepartmentIds: [],
            }) as DashboardRequest),
  );
  await el.updateComplete;
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choice(value: "keep" | "discard") {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${value}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}

it("Cancel asks, Keep retains and Discard restores the whole form", async () => {
  const el = await mount();
  const change = async (value: string) => {
    el.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };
  expect(unload()).toBe(false);
  await change("Draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("keep");
  expect(
    (el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("discard");
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Restaurant");
  expect(unload()).toBe(false);
});
it("reconnect retains the draft against its original baseline", async () => {
  const el = await mount();
  el.shadowRoot!.querySelector("[name=tradingName]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Draft" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(unload()).toBe(true);
  el.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(el);
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("[name=tradingName]")! as HTMLElementTagNameMap["wt-input"])
      .value,
  ).toBe("Draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("keep");
  expect(unload()).toBe(true);
});

it.each(["read-before-write", "write-before-read"] as const)(
  "a non-transfer save stays committed when %s completes",
  async (order) => {
    let readSettings!: (value: unknown) => void,
      readProfiles!: (value: unknown) => void,
      write!: () => void;
    const submitted: unknown[] = [];
    const el = await mount(((path, method, body) => {
      if (method === "GET")
        return new Promise<unknown>((resolve) => {
          if (path.endsWith("/profiles")) readProfiles = resolve;
          else readSettings = resolve;
        });
      submitted.push(body);
      return new Promise<void>((resolve) => (write = resolve));
    }) as DashboardRequest);
    const name = el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"];
    name.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Saved name" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    const save = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
    save().click();
    await el.updateComplete;
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).not.toHaveProperty("transfers");
    const finishRead = async () => {
      readSettings({
        departmentId: "d1",
        receivingProfileId: "p1",
        destinationDepartmentIds: ["d2"],
      });
      readProfiles([{ id: "p1", name: "Restaurant desk" }]);
      await expect
        .poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]"))
        .not.toBeNull();
    };
    if (order === "read-before-write") {
      await finishRead();
      write();
    } else {
      write();
      await expect.poll(() => name.disabled).toBe(false);
      await finishRead();
    }
    await expect.poll(() => name.disabled).toBe(false);
    await el.updateComplete;
    expect(save().disabled).toBe(true);
    expect(save().variant).toBe("secondary");
    expect(unload()).toBe(false);
    let proceeded = false;
    expect(
      await app.leave.coordinator.request({
        scopes: "all",
        reason: "navigation",
        proceed: () => {
          proceeded = true;
        },
      }),
    ).toBe("proceeded");
    expect(proceeded).toBe(true);
    await app.updateComplete;
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    name.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "New draft" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
    await choice("discard");
    await el.updateComplete;
    expect(name.value).toBe("Saved name");
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.checked,
    ).toBe(true);
    expect(unload()).toBe(false);
  },
);
it("destination deactivation retains other drafts against their original baseline", async () => {
  const el = await mount((async (path) =>
    path.endsWith("/profiles")
      ? []
      : {
          departmentId: "d1",
          receivingProfileId: null,
          destinationDepartmentIds: ["d2"],
        }) as DashboardRequest);
  await expect.poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]")).not.toBeNull();
  const view = structuredClone(model);
  view.departments.push({
    id: "d4",
    name: "Cafe",
    tradingName: "Coffee",
    defaultServiceMode: "prepay",
    active: true,
  });
  el.model = view;
  await el.updateComplete;
  const name = el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"];
  name.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Name draft" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.checked,
  ).toBe(true);
  await el.updateComplete;
  const live = structuredClone(view);
  live.departments[1]!.active = false;
  el.model = live;
  await el.updateComplete;
  expect(name.value).toBe("Name draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("discard");
  await el.updateComplete;
  expect(name.value).toBe("Restaurant");
  expect(unload()).toBe(false);
  const bodies: unknown[] = [];
  el.api = new VenueServiceApi((async (_path, _method, body) => {
    bodies.push(body);
  }) as DashboardRequest);
  name.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Valid correction" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => bodies.length).toBe(1);
  expect((bodies[0] as { transfers: unknown }).transfers).toEqual({
    receivingProfileId: null,
    destinationDepartmentIds: [],
  });
});
