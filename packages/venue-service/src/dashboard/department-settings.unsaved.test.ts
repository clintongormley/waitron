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
async function mount() {
  app = document.createElement("a8-settings-leave-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-settings")!;
  el.model = structuredClone(model);
  el.departmentId = "d1";
  el.api = new VenueServiceApi((async (path) =>
    path.endsWith("/profiles")
      ? []
      : {
          departmentId: "d1",
          receivingProfileId: null,
          destinationDepartmentIds: [],
        }) as DashboardRequest);
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
